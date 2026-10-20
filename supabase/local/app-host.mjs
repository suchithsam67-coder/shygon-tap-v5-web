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
import zlib from 'node:zlib';
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

/** What the hosts compress: text. Images and fonts are already compressed. */
const COMPRESSIBLE = /\.(html|m?js|css|json|webmanifest|svg|txt|xml)$/i;

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
      // [headers.values] is indented under its [[headers]] in netlify.toml, so it
      // is part of this block; a flush-left one would start the next block.
      const at = block.indexOf('[headers.values]');
      const values = at >= 0 ? block.slice(at) : blocks[i + 1]?.startsWith('[headers.values]') ? blocks[i + 1] : '';
      for (const [, key, value] of values.matchAll(/^\s*([A-Za-z-]+)\s*=\s*(".*")\s*$/gm)) headers[key] = JSON.parse(value);
      if (Object.keys(headers).length === 0) throw new Error('netlify.toml: the "/*" [[headers]] block has no values');
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
 * @param {object} [options.control]   the SMS stand-in and the host switches,
 *                                     for /__sim/sms/* and /__sim/switches (browser E2E)
 */
export function createAppHost({ root, distDir, appUrl, gatewayUrl, sim, control = null, log = () => {} }) {
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

  // Text is sent brotli-compressed when the browser accepts it, as Netlify and
  // Vercel do, so what a journey or a performance check downloads matches
  // production. Compressed once per file version.
  const compressed = new Map();
  function brotli(file) {
    const { mtimeMs } = fs.statSync(file);
    const cached = compressed.get(file);
    if (cached?.mtimeMs === mtimeMs) return cached.body;
    const body = zlib.brotliCompressSync(fs.readFileSync(file), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } });
    compressed.set(file, { mtimeMs, body });
    return body;
  }

  function serveFile(request, response, file, status = 200) {
    const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    const headers = { 'content-type': type, 'cache-control': 'no-store', vary: 'accept-encoding', ...securityHeaders };
    const compress = /\bbr\b/.test(request.headers['accept-encoding'] ?? '') && COMPRESSIBLE.test(file);
    if (compress) headers['content-encoding'] = 'br';
    response.writeHead(status, headers);
    if (request.method === 'HEAD') return response.end();
    response.end(compress ? brotli(file) : fs.readFileSync(file));
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
    if (control && (url.pathname.startsWith('/__sim/sms/') || url.pathname === '/__sim/switches')) {
      return controlRoute(request, body, url, send);
    }
    return send(404, { error: 'unknown simulator route' });
  }

  /**
   * Browser E2E control of the SMS stand-in and the host switches (Session B,
   * B-4). Loopback callers only; the stack never runs outside a developer's
   * machine or CI, and none of this exists in a deployed build.
   *   POST /__sim/sms/provider   { provider: 'twilio' | 'msg91' | null, receipts?: boolean }
   *   POST /__sim/sms/queue      { scenarios: ['accept' | 'reject' | 'error' | 'busy' | 'timeout' | 'network', ...] }
   *   GET  /__sim/sms/last-code?to=<E.164>   the latest verification code texted to that number
   *   GET  /__sim/sms/messages   provider, to, sid and scenario of every message (no bodies)
   *   POST /__sim/sms/deliver    { sid, status }  a signed receipt (Twilio status, or an MSG91 code)
   *   POST /__sim/switches       { EMERGENCY_PUBLIC_ALERTS?: boolean, RESCUE_RELAY?: boolean }
   */
  async function controlRoute(request, body, url, send) {
    const remote = request.socket.remoteAddress ?? '';
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return send(403, { error: 'loopback only' });
    const input = request.method === 'POST' ? JSON.parse(body.toString('utf8') || '{}') : {};
    const { sms } = control;
    if (url.pathname === '/__sim/sms/provider' && request.method === 'POST') {
      if (![null, 'twilio', 'msg91'].includes(input.provider ?? null)) return send(400, { error: 'provider: twilio, msg91 or null' });
      control.useSms(input.provider ?? null, { receipts: input.receipts !== false });
      return send(200, { provider: input.provider ?? null, receipts: input.receipts !== false });
    }
    if (url.pathname === '/__sim/sms/queue' && request.method === 'POST') {
      const allowed = new Set(['accept', 'reject', 'error', 'busy', 'timeout', 'network']);
      const scenarios = Array.isArray(input.scenarios) ? input.scenarios : [];
      if (!scenarios.every((s) => allowed.has(s))) return send(400, { error: `scenarios: ${[...allowed].join(', ')}` });
      sms.queue(...scenarios);
      return send(200, { queued: scenarios.length });
    }
    if (url.pathname === '/__sim/sms/last-code' && request.method === 'GET') {
      const to = url.searchParams.get('to');
      const message = [...sms.messages].reverse().find((m) => m.to === to || m.to === to?.replace(/^\+/, ''));
      const code = message?.provider === 'msg91' ? message.vars?.otp : /code: (\d{6})/.exec(message?.body ?? '')?.[1];
      return code ? send(200, { code }) : send(404, { error: 'no code sent to that number' });
    }
    if (url.pathname === '/__sim/sms/messages' && request.method === 'GET') {
      return send(200, sms.messages.map(({ provider, to, sid, scenario, at }) => ({ provider, to, sid, scenario, at })));
    }
    if (url.pathname === '/__sim/sms/deliver' && request.method === 'POST') {
      const message = sms.messages.find((m) => m.sid === input.sid);
      if (!message) return send(404, { error: 'unknown message' });
      const result = message.provider === 'msg91'
        ? await sms.deliverMsg91(input.sid, input.status, { secret: control.msg91DlrSecret })
        : await sms.deliver(input.sid, input.status);
      return send(200, result);
    }
    if (url.pathname === '/__sim/switches' && request.method === 'POST') {
      for (const name of ['EMERGENCY_PUBLIC_ALERTS', 'RESCUE_RELAY']) {
        if (typeof input[name] === 'boolean') control.setSwitch(name, input[name]);
      }
      return send(200, control.switches());
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
          response.writeHead(rule.status, { location: target + url.search, ...securityHeaders });
          return response.end();
        }
        if (target.startsWith('/.netlify/functions/')) {
          return await runFunction(target.slice('/.netlify/functions/'.length), request, response, body, url);
        }
        const rewritten = staticFile(target);
        if (rewritten) return serveFile(request, response, rewritten, rule.status);
        break;
      }
      if (file) return serveFile(request, response, file, 200);
      // Like the hosts, the "/*" headers apply to every response, not only to files.
      response.writeHead(404, { 'content-type': 'text/plain', ...securityHeaders });
      response.end('Not found');
    } catch (error) {
      log(`app-host: ${error?.stack ?? error}`);
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'local host error' }));
    }
  });

  return { server, securityHeaders };
}
