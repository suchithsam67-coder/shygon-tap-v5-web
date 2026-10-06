// The local stack's web host (V6, D-4): the built site and the server
// functions on one origin, routed the way netlify.toml routes them.
//
//   /api/*  →  /.netlify/functions/*  →  netlify/functions/<name>.mjs (the real handlers)
//   static files from the build, with netlify.toml's redirects (rewrites,
//   301s and the 404 rule) and its security headers
//   /__sim/razorpay/*  the Razorpay stand-in's browser side (local stack only)
//
// The production CSP is kept, with two local substitutions so it can work
// over http on 127.0.0.1: the Supabase origins become the local gateway, and
// upgrade-insecure-requests is dropped. Everything else it forbids, it still
// forbids here, so a CSP regression fails the end-to-end journeys too.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** The [[redirects]] and the "/*" [[headers]] of netlify.toml. */
export function parseNetlifyToml(text) {
  const redirects = [];
  const headers = {};
  const blocks = text.replace(/\r\n/g, '\n').split(/\n(?=\[)/);
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.startsWith('[[redirects]]')) {
      const field = (name) => block.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, 'm'))?.[1]?.trim();
      redirects.push({
        from: JSON.parse(field('from')),
        to: JSON.parse(field('to')),
        status: Number(field('status') ?? 301),
        force: field('force') === 'true',
      });
    } else if (block.startsWith('[[headers]]') && /for\s*=\s*"\/\*"/.test(block)) {
      const values = blocks[i + 1]?.startsWith('[headers.values]') ? blocks[i + 1] : '';
      for (const [, key, value] of values.matchAll(/^\s*([A-Za-z-]+)\s*=\s*(".*")\s*$/gm)) headers[key] = JSON.parse(value);
    }
  }
  return { redirects, headers };
}

function match(rule, pathname) {
  if (/^https?:/.test(rule.from)) return null;
  if (rule.from.endsWith('/*')) {
    const prefix = rule.from.slice(0, -1);
    return pathname.startsWith(prefix) ? { splat: pathname.slice(prefix.length) } : null;
  }
  return pathname === rule.from ? { splat: '' } : null;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

/**
 * @param {object} options
 * @param {string} options.root        repository root
 * @param {string|null} options.distDir built site, or null for functions only
 * @param {string} options.appUrl      this host's own origin
 * @param {string} options.gatewayUrl  the local Supabase gateway
 * @param {object} options.sim         the Razorpay stand-in
 */
export function createAppHost({ root, distDir, appUrl, gatewayUrl, sim, log = () => {} }) {
  const rules = parseNetlifyToml(fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8'));
  const gateway = new URL(gatewayUrl);
  const securityHeaders = { ...rules.headers };
  if (securityHeaders['Content-Security-Policy']) {
    securityHeaders['Content-Security-Policy'] = securityHeaders['Content-Security-Policy']
      .replace(/https:\/\/\*\.supabase\.co/g, gateway.origin)
      .replace(/wss:\/\/\*\.supabase\.co/g, `ws://${gateway.host}`)
      .replace(/;\s*upgrade-insecure-requests/, '');
  }
  const modules = new Map();

  async function runFunction(name, request, response, body, url) {
    const file = path.join(root, 'netlify', 'functions', `${name}.mjs`);
    if (!/^[a-z][a-z0-9-]*$/.test(name) || !fs.existsSync(file)) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'Function not found' }));
      return;
    }
    if (!modules.has(name)) modules.set(name, import(pathToFileURL(file).href));
    const handler = (await modules.get(name)).default;
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') headers.set(key, value);
    }
    const fnRequest = new Request(url, {
      method: request.method,
      headers,
      body: body.length && !['GET', 'HEAD'].includes(request.method) ? body : undefined,
    });
    const fnResponse = await handler(fnRequest, {});
    const out = {};
    fnResponse.headers.forEach((value, key) => {
      out[key] = value;
    });
    response.writeHead(fnResponse.status, out);
    response.end(Buffer.from(await fnResponse.arrayBuffer()));
    log(`${request.method} ${url.pathname} ${fnResponse.status}`);
  }

  function serveFile(response, file, status = 200, method = 'GET') {
    const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...securityHeaders });
    response.end(method === 'HEAD' ? undefined : fs.readFileSync(file));
  }

  function staticFile(pathname) {
    if (!distDir) return null;
    const decoded = decodeURIComponent(pathname);
    const file = path.normalize(path.join(distDir, decoded));
    if (!file.startsWith(path.normalize(distDir))) return null;
    try {
      if (fs.statSync(file).isFile()) return file;
    } catch {
      /* not a file */
    }
    return null;
  }

  async function simRoute(request, response, body, url) {
    const send = (status, value, type = 'application/json') => {
      response.writeHead(status, { 'content-type': type });
      response.end(typeof value === 'string' ? value : JSON.stringify(value));
    };
    if (url.pathname === '/__sim/razorpay/checkout.js') return send(200, sim.checkoutScript(appUrl), 'text/javascript');
    if (url.pathname === '/__sim/razorpay/pay' && request.method === 'POST') {
      return send(200, await sim.payFromBrowser(JSON.parse(body.toString('utf8') || '{}')));
    }
    if (url.pathname === '/__sim/razorpay/state') {
      return send(200, { orders: [...sim.orders.values()], payments: [...sim.payments.values()], deliveries: sim.deliveries });
    }
    return send(404, { error: 'unknown simulator route' });
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, appUrl);
    try {
      const body = await readBody(request);
      if (url.pathname.startsWith('/__sim/')) return await simRoute(request, response, body, url);
      if (url.pathname.startsWith('/.netlify/functions/')) {
        return await runFunction(url.pathname.slice('/.netlify/functions/'.length), request, response, body, url);
      }
      const file = staticFile(url.pathname);
      for (const rule of rules.redirects) {
        const hit = match(rule, url.pathname);
        if (!hit) continue;
        // A file at the path wins over a non-forced rule, as on Netlify.
        if (file && !rule.force) continue;
        const target = rule.to.replace(':splat', hit.splat);
        if (rule.status === 301 || rule.status === 302) {
          response.writeHead(rule.status, { location: target + url.search });
          return response.end();
        }
        if (target.startsWith('/.netlify/functions/')) {
          return await runFunction(target.slice('/.netlify/functions/'.length), request, response, body, url);
        }
        const rewritten = staticFile(target);
        if (rewritten) return serveFile(response, rewritten, rule.status, request.method);
        break;
      }
      if (file) return serveFile(response, file, 200, request.method);
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('Not found');
    } catch (error) {
      log(`app-host: ${error?.stack ?? error}`);
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'local host error' }));
    }
  });

  return { server, securityHeaders };
}
