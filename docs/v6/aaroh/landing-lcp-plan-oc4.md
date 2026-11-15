# OC-4 (V01 T-14): landing page largest paint under 4 s, plan and measured results (for the owner's gate)

Session B (frontend), 2026-11-01/02. It follows OpenCode's job on `opencode/landing-hero-lcp` (base `f0e6d6f`; commits `8824dac`, `79d3859`), checked by the coordinator.

## Built 2026-11-15: the landing opens on its real hero (largest paint about 2.1 s)

Decided in this session by the user, after the measurements below were repeated on today's branch:
- **Option A, the hero without its fade:** yes. Alone it barely helped (6.5–6.7 s; without the preload 5.4–5.7 s; with production caching 5.2–5.9 s), because the hero image waits for three rounds of JavaScript.
- **The 4 s landing test stays a hard gate** (Q-P3: yes).
- **The 14-second paint (the hero turning to the next edition): kept as designed** (Q-P2).
- **The exact static hero**, chosen over a card-first loading screen and over a report-only test. B, C, D and E were not chosen; the image preload is dropped (the static HTML carries the images).

What was built:
- At build time, the page step renders the landing's real `Header` and `Hero` (`LandingStaticTop` in `ShygonTap.tsx`) with React's server renderer, in a throwaway Vite server with a stand-in database client (`src/seo/landingStatic.tsx`, `src/seo/supabaseStub.ts`). It writes them into `shygontap.html` in place of the loading screen, as `#landing-static` beside an empty `#root`, and links the two stylesheets the live page loads for them (`vite.config.ts`). Only `/shygontap` changes; every other page keeps the loading screen.
- In the browser, React's loading screens stay out of the way while the copy is there (`BrandLoader`), and the live landing removes it in the same frame it renders, before paint (`src/lib/staticLanding.ts`, `ShygonApp`'s layout effect). The live hero does not play its entrance again.
- The copy lies over `#root` instead of pushing it down, so the live page arrives exactly where the copy was. Its card paints at full size from the start (no scale-in on the first load), so the live card, the same size, is not a later largest paint.
- Two lines guard browser-only reads for that render: the header's cart count (`localStorage`) and the theme (`document`). On the light theme the copy's toggle follows the page's theme.

Measured, the perf test, three runs each:

| | Landing largest paint | Layout shift | Public Tap |
|---|---|---|---|
| Local stack (no-store) | 2.07–2.13 s | 0 | 1.61–1.75 s |
| Production-style caching (a measuring proxy) | 2.18–2.26 s | 0 | — |

The full landing (everything below the hero, and the hero's controls) still arrives with the JavaScript, at about 4.7 s on that phone; until then its links work as plain links and its buttons do nothing.

Checked by `e2e/landing-static.spec.ts`: without JavaScript the header and hero are there and the card is requested at high priority; with it, the copy is replaced once, and the header, the title, the tagline, the first button and the card stage are at the same pixels before and after, at 1280 px and at 390 px.

---

## Result of building steps 1–3 (2026-11-02): they do not reach 4 s

Built and measured (three runs each, same slow phone). Nothing is committed.

| What | Hero's largest paint | Notes |
|---|---|---|
| Today (no preload) | ≈ 5.5 s | entry bundle done at 0.55 s |
| + hero image preload (step 2), local stack | ≈ 6.6 s | **worse**: each face downloads twice |
| + hero image preload, production-style caching | ≈ 4.95 s | each face downloads once, done by 1.75 s |
| + step 3, every route chunk preloaded | ≈ 6.4–7.0 s | **worse**: 27 files share the line from the start; the 11 kB entry takes 2.6 s |
| + only the 3 large chunks preloaded | ≈ 6.8 s | worse, for the same reason |
| image preload + the hero reveal without its fade (experiment, CSS injected in the test browser only) | ≈ 4.2–4.6 s | still over 4 s |

What the measurements showed:
- **The double download** OpenCode saw comes from the local stack's `Cache-Control: no-store`. Chrome does not reuse a preloaded response that may not be stored. With the hosts' default (`public, max-age=0, must-revalidate`, served by a test server in the scratchpad) each face downloads once. So the image preload helps on the real hosts but makes the local perf test worse, unless the local host (`supabase/local/app-host.mjs`, Session A's) sends the hosts' header for static files.
- **The page is limited by bandwidth, not by the chain of requests.** At 1.6 Mb/s everything the landing needs (about 650 kB: JavaScript, two hero faces, 12 font files, card SVGs) takes about 3.3 s just to arrive. Preloading code only reorders that, and anything started early delays the entry bundle and React. Step 3 is taken out.
- **The hero's reveal hides the paint.** Its wrapper animates `revealScale 1s .12s both` (opacity 0 → 1 over a second). The browser does not count a transparent paint, so the counted paint lands well into the fade, after a 0.5 s render on the slowed CPU. Without the fade: about 0.5–0.7 s sooner. Changing it is a design change.
- **The hero enters the page at about 3.7 s,** after the third round of chunks (24 small files, mostly icons, about 0.9 s over the local stack's six HTTP/1.1 connections) and the render.

What is left in the working tree (uncommitted): the merge of `opencode/landing-hero-lcp` (staged), the hero image preload in `/shygontap`'s HTML only (`src/seo/build.ts`, `vite.config.ts`), and one shared `AAROH_HERO_SIZES` (`src/data/aaroh.ts`, `AarohHero.tsx`). Build, lint, `test:seo` and `test:bundle` (86,095 B) pass.

Options that remain, each needing the owner's decision:
- **A. The hero reveal without its fade** (scale only), a small motion change: about −0.6 s.
- **B. The local host sends the hosts' cache header for static files** (Session A's file), so the preload is measured as it behaves in production: about −0.5 s.
- **C. Fewer small chunks on the landing** (group the icons): helps most on the local stack's HTTP/1.1; it costs the public Tap some extra icon code.
- **D. Do not load `supabase` (52 kB) before the landing renders:** a structural change to the account app.
- **E. AVIF faces:** about a third less image data.
Most likely to reach 4 s: A and B together measured 4.2–4.6 s (the last row above), so one of C or E is also needed for the last 0.3–0.6 s.

---

The original plan follows, kept as written.

## Where the time goes (measured)

Local stack (brotli, like the hosts; no CDN), the perf test's slow phone: slow 4G at 150 ms and 1.6 Mb/s, 4× slower CPU, desktop Edge, on `249c8d9`. Three runs, all within about 0.2 s of each other (run 2 shown):

| Time | What happens |
|---|---|
| 0.2 – 1.1 s | the entry bundle (11 kB) and React (69 kB) download |
| 1.1 – 1.9 s | only now: `AccountApp` (25 kB, the signed-in app shell the landing lives in) and `supabase` (52 kB) |
| 1.9 – 3.1 s | only now: `ShygonTap` (15 kB) and 23 more small chunks (icons and shared modules) |
| 3.2 s | the page renders the hero, and its two card faces are requested, together with 14 card-design SVGs (about 200 kB) and 7 more font files |
| ≈ 5.6 s | the hero's back face finishes and paints: **the largest paint** (budget 4 s) |

So the hero is late for two reasons:
1. its download cannot start until three rounds of JavaScript have arrived one after another;
2. it then shares the connection with everything else the page asks for at the same moment.

OpenCode's diagnosis matches. Its two commits make the test measure the true final paint (before, it stopped early, at text) and load both hero faces at high priority. Merged alone, the landing test turns red: 5.1 to 5.9 s.

**Also found: the largest paint can move to about 14 s.** About 9.6 s after the hero appears it turns to the next edition (Aureate), whose images are a little larger on screen. The browser then records a new, later largest paint, on every run. Lab tools stop measuring earlier, but a real visitor who reads the hero without scrolling would be recorded at about 14 s.

## The plan (in order; each step measured with the same script, three runs)

| Step | Change | Files | Visible change |
|---|---|---|---|
| 1 | Merge `opencode/landing-hero-lcp` (a merge, not a cherry-pick): the honest measurement and high priority for both faces | `e2e/performance.spec.ts`, `AarohCard.tsx` | none |
| 2 | **Preload the two hero faces in the landing's own HTML** (`/shygontap` only, from the build's SEO step): `rel=preload as=image fetchpriority=high`, with `imagesrcset`/`imagesizes` identical to the `<img>`. That way the browser asks for exactly the file the page will use, so nothing downloads twice. The hero's `sizes` moves into `src/data/aaroh.ts`, so the page and the preload share one value | `src/seo/build.ts`, `vite.config.ts` (the SEO plugin), `src/data/aaroh.ts`, `AarohHero.tsx` | none |
| 3 | **Start the landing's code at once**: `rel=modulepreload` for `AccountApp`, `supabase`, `ShygonTap` and their static imports, plus their CSS, in `/shygontap`'s HTML. The list is read from the build's own chunk graph, never kept by hand. The three rounds of JavaScript then download side by side from about 0.2 s | `vite.config.ts` (the SEO plugin) | none |
| 4 | Only if steps 2–3 still miss: keep the 14 card SVGs and the late fonts out of the hero's way (find which section asks for them at load, and defer them until after the hero) | `ShygonTap.tsx` | none on screen |

**Expected:** the faces arrive while the code is still loading, so the hero paints as soon as it renders: roughly 2.5–3.5 s instead of about 5.6 s. That is an estimate; steps 2 and 3 are measured before anything is committed. The public Tap must stay under 2.5 s (today 1.3–1.9 s) and its entry bundle under 90,000 B (today 86,104 B): none of these steps touches either.

## Not recommended now

- **Merging the icon chunks** (`manualChunks`): it would also make the public Tap download every icon the app uses. And on the real hosts (HTTP/2), many small files cost far less than on the local stack (HTTP/1.1, six connections).
- **AVIF faces:** the WebP faces are 72–78 kB; AVIF might save about a third. That would add an image pipeline change for less than the steps above. Revisit after measuring.
- **Fewer font weights:** that changes the type, so it is a design decision. The landing loads 12 files (two families, latin-ext subsets for symbols like ₹).

## Separate, release track (not part of the 4 s test)

- **Caching on the real hosts.** `netlify.toml` and `vercel.json` set only the security headers. Hashed files in `/assets/` are therefore revalidated on every repeat visit; the local stack's `no-store` is local only. Marking them `immutable` is standard, but `/assets/` also holds unhashed images (`/assets/aaroh/`, `/assets/cards/`) that must not be. The clean way is to give the hashed files their own folder first. That is a deploy setting: it needs the owner's release approval and a check of what the hosts actually send.

## Questions for the owner

- **Q-P1.** Approve steps 1–3 (and 4 only if needed)? None changes what the page looks like.
- **Q-P2.** The 14-second paint: keep the hero turning as designed (recommended for now: it is a field-data risk, not a lab failure), or start the next edition's turn only after the visitor interacts?
- **Q-P3.** Should the landing perf test stay a hard gate at 4 s, or be reported only until step 3 lands? Recommended: a hard gate, with steps 1–3 landing together so it is never red on the branch.

Measurement script: the Session B scratchpad's `landing-waterfall.mjs` (it runs against a local stack and prints each run's waterfall).
