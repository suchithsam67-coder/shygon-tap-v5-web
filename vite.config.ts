import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, loadEnv, type Plugin, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import {
  injectHead,
  llmsTxt,
  prerenderedPages,
  renderHead,
  robotsTxt,
  shellMeta,
  sitemapXml,
} from './src/seo/build'

/**
 * Static SEO output, build only. The app is client-rendered, and search
 * engines and link-preview scrapers (WhatsApp, LinkedIn, X) mostly don't run
 * JavaScript, so each public page gets its own HTML file whose <head> already
 * carries that page's title, description, canonical, share image and JSON-LD.
 * The body is the same app shell; the page renders as usual once JS loads.
 *
 * Also writes sitemap.xml, robots.txt and llms.txt from the same data, so
 * none of them can drift from what the pages say.
 */
function seoPages(site: string): Plugin {
  let root = ''
  let outDir = ''
  return {
    name: 'shygon-seo-pages',
    apply: 'build',
    configResolved(config) {
      root = config.root
      outDir = path.resolve(config.root, config.build.outDir)
    },
    // The shell served for customer Taps and signed-in pages.
    transformIndexHtml(html) {
      return injectHead(html, renderHead(site, shellMeta(site), { canonical: false }))
    },
    closeBundle() {
      const pages = prerenderedPages(site)

      // Netlify and Vercel reach each file through an explicit rewrite; a page
      // without one would be answered by the 404 rule. Fail here, not in
      // production. vercel.json must carry every rewrite netlify.toml has.
      const toml = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8').replace(/\r\n/g, '\n')
      const unrouted = pages
        .filter((page) => page.file !== '404.html')
        .map((page) => `/${page.file.replace(/\.html$/, '')}`)
        .filter((route) => !toml.includes(`from = "${route}"\n  to = "${route}.html"`))
      if (unrouted.length) {
        throw new Error(`netlify.toml has no rewrite for: ${unrouted.join(', ')}`)
      }
      const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')) as {
        rewrites?: { source: string; destination: string }[]
      }
      const vercelRoutes = new Set((vercel.rewrites ?? []).map((r) => `${r.source} ${r.destination}`))
      const missing = [...toml.matchAll(/from = "(\/[^"]*)"\n {2}to = "(\/[^"]+\.html)"\n {2}status = 200/g)]
        .map(([, from, to]) => `${from.replace(/\/\*$/, '/:path*')} ${to}`)
        .filter((rule) => !vercelRoutes.has(rule))
      if (missing.length) {
        throw new Error(`vercel.json is missing rewrites that netlify.toml has: ${missing.join(', ')}`)
      }

      const template = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8')
      for (const page of pages) {
        const file = path.join(outDir, page.file)
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, injectHead(template, renderHead(site, page.meta)))
      }
      const today = new Date().toISOString().slice(0, 10)
      fs.writeFileSync(path.join(outDir, 'sitemap.xml'), sitemapXml(site, today))
      fs.writeFileSync(path.join(outDir, 'robots.txt'), robotsTxt(site))
      fs.writeFileSync(path.join(outDir, 'llms.txt'), llmsTxt(site))
    },
  }
}

/**
 * Dev only: serves the server functions from `npm run dev`, so checkout, the
 * PIN lookup and the card OTP flow work locally instead of 404ing. Production
 * is untouched (Netlify runs netlify/functions, Vercel runs api/, both the
 * same handlers). The Razorpay keys in .env must be TEST keys.
 */
function devFunctions(serverEnv: Record<string, string>): Plugin {
  const allowed = new Set(['check-delivery', 'card-otp', 'create-order', 'verify-payment', 'razorpay-webhook']);
  return {
    name: 'shygon-dev-functions',
    apply: 'serve',
    configureServer(server) {
      // Server-side variables (service key, SMS provider) for the functions,
      // in this dev process only. Never reaches the browser bundle.
      for (const [key, value] of Object.entries(serverEnv)) {
        if (!(key in process.env)) process.env[key] = value
      }
      server.middlewares.use(async (req, res, next) => {
        const match = req.url?.match(/^\/api\/([a-z-]+)(?:\?|$)/)
        if (!match || !allowed.has(match[1])) return next()
        try {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          const headers = new Headers()
          for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === 'string') headers.set(key, value)
          }
          const request = new Request(`http://localhost${req.url}`, {
            method: req.method,
            headers,
            body: chunks.length && req.method !== 'GET' ? Buffer.concat(chunks) : undefined,
          })
          const mod = await server.ssrLoadModule(`/netlify/functions/${match[1]}.mjs`)
          const response: Response = await mod.default(request)
          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (error) {
          res.statusCode = 500
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: `Dev function failed: ${(error as Error).message}` }))
        }
      })
    },
  }
}

// https://vite.dev/config/
/**
 * Refuses to produce a bundle whose canonical site URL is not a real public
 * origin.
 *
 * `VITE_SITE_URL` is the address baked into every printed QR and into the
 * public Tap link a customer shares. A card is not reprintable once it is in
 * someone's wallet, so a build carrying `http://localhost:5173` — which is a
 * perfectly reasonable value to have in a local `.env` — is not a bug to find
 * in review. It is a bug that has to be impossible to ship.
 *
 * Staging is still allowed: any https origin passes. Only localhost and plain
 * http are refused, and only when actually building.
 */
function assertPublishableSiteUrl(raw: string | undefined) {
  const value = raw?.trim();
  if (!value) return; // Unset is the safe default — see src/lib/site.ts.

  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`VITE_SITE_URL is not a valid URL: ${value}`);
  }

  const host = url.hostname.toLowerCase();
  const isLocal =
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '[::1]' ||
    host.endsWith('.local') ||
    host.endsWith('.localhost') ||
    /^127\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^10\./.test(host);

  if (isLocal || url.protocol !== 'https:') {
    throw new Error(
      [
        '',
        '  Refusing to build: VITE_SITE_URL is not a public https origin.',
        '',
        `    VITE_SITE_URL = ${value}`,
        '',
        '  This value is compiled into the bundle and becomes the address on every',
        '  printed QR code and shared Tap link. A card cannot be reprinted once it',
        '  has shipped, so this must never reach a deploy.',
        '',
        '  Fix: unset VITE_SITE_URL (it defaults to https://shygontech.com), or set',
        '  it to the https origin this deploy is actually served from.',
        '',
        '  Building a local preview on purpose? Prefix the command with',
        '  ALLOW_LOCAL_SITE_URL=1 — that bundle is for `vite preview` only and must',
        '  not be deployed.',
        '',
      ].join('\n'),
    );
  }
}

export default defineConfig(async ({ command, mode }) => {
  const plugins: PluginOption[] = [react(), tailwindcss()];
  try {
    // Optional local-only dev plugin; it is not in the repo on every machine.
    // @ts-expect-error — untyped JS module, resolved at runtime when present.
    const m = await import('./.vite-source-tags.js');
    plugins.push(m.sourceTags());
  } catch {
    // Absent is the normal case. The build does not depend on it.
  }

  const env = loadEnv(mode, process.cwd(), ['VITE_', 'NEXT_PUBLIC_']);

  // Only on `vite build` — the dev server is free to point wherever it likes.
  if (command === 'build' && !process.env.ALLOW_LOCAL_SITE_URL) {
    assertPublishableSiteUrl(env.VITE_SITE_URL);
  }

  // Same rule as src/lib/site.ts: https origin, no trailing slash.
  const rawSite = (env.VITE_SITE_URL || 'https://shygontech.com').trim().replace(/\/+$/, '');
  plugins.push(seoPages(/^https?:\/\//i.test(rawSite) ? rawSite : `https://${rawSite}`));
  if (command === 'serve') {
    // Every .env key, but only for the dev-time function runner above.
    const all = loadEnv(mode, process.cwd(), '');
    const serverOnly = Object.fromEntries(
      Object.entries(all).filter(([key]) => !key.startsWith('VITE_') && !key.startsWith('NEXT_PUBLIC_')),
    );
    plugins.push(devFunctions(serverOnly));
  }

  const processEnvDefines: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    processEnvDefines[`process.env.${key}`] = JSON.stringify(value);
  }

  return {
    plugins,
    envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
    define: {
      ...processEnvDefines,
      // Stamped once, at build time — see src/lib/version.ts.
      __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    },
    build: {
      // Never ship source maps: they publish the unminified source.
      sourcemap: false,
      rollupOptions: {
        output: {
          /**
           * Keep the dependencies that never change out of the chunk that
           * changes on every deploy, so a returning visitor re-downloads only
           * the app code.
           *
           * A function, not the `{ react: ['react-dom'] }` shorthand: that
           * only matched react-dom's package entry, so `react-dom/client` (what
           * main.tsx imports, ~130 KB) and `scheduler` landed in the per-deploy
           * entry chunk and were re-downloaded after every release.
           */
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|cookie|set-cookie-parser)[\\/]/.test(id)) {
              return 'react';
            }
            if (/[\\/]node_modules[\\/]@supabase[\\/]/.test(id)) return 'supabase';
            return undefined;
          },
        },
      },
    },
  };
})
