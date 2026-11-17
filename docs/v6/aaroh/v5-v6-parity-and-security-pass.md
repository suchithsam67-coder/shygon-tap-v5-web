# V5→V6 parity and a frontend security pass (Session B, 2026-11-16)

Asked by the coordinator after the owner's "if everything abt v5 is completed then start v6 software building". V5 reference: `shygon-tap-website` audit branch `audit/2026-11-15`, commit `17ecb99`. V6: this branch at `85bbb7e`. All verdicts below are OBSERVED in the code unless marked.

## 1. V5 fixes, checked against V6

| V5 fix | V6 verdict | Change here |
|---|---|---|
| **B-6, security headers on both hosts:** `X-Frame-Options: SAMEORIGIN`, CSP `frame-ancestors 'self'`, `Permissions-Policy: camera=(), microphone=(), geolocation=()` | **Already in V6, and stricter**, on both hosts: `X-Frame-Options: DENY`, `frame-ancestors 'none'` inside a full CSP, and the same Permissions-Policy plus `browsing-topics=()` and `payment=(self "https://api.razorpay.com")`. Nothing in V6 uses an iframe of its own pages, the camera, the microphone, geolocation or Web NFC (the card is read by the phone's own NFC, not by a page), so none of these breaks a feature. If V6 ever frames its own pages (for example an editor preview), `DENY` / `'none'` would have to become `SAMEORIGIN` / `'self'` | None |
| **Netlify `/admin` rules before the `/*` catch-all** | **Does not apply:** V6 serves no `/admin`; the admin app is its own repository (F-28). The catch-all is the last of the 48 Netlify rules; Vercel has no catch-all rewrite. The same mistake can still happen to any future rule, so the build now refuses it | **Guard added:** `rulesAfterCatchAll` (`src/seo/build.ts`); the build fails if any rule follows `from = "/*"` (`vite.config.ts`). Checked both ways: today's file builds; a file with `/admin` appended fails with "these rules come after the /* catch-all and never match: /admin" |
| **Sign-up phone-taken check** moved from `supabase.rpc('phone_available')` to a rate-limited `/api/phone-check` | **Does not apply as built:** V6's sign-up asks for name, email and password only; the phone is added in Settings and verified there (T-11, v0.13); sign-in is by email. Nothing in V6 calls `phone_available`. V5 also has phone sign-in (`/api/phone-login`); V6 does not. Session A told (no endpoint needed; it names any it builds) | None. **Question for the owner:** should V6 take a phone at sign-up, or allow phone sign-in, as V5 does? |
| **The customer APK must never contain `dist/admin`** (`scripts/app-sync.mjs`, `npm run app:sync`) | **Does not apply:** V6 has no Capacitor app (no `capacitor.config`, no `android/`, no Capacitor packages, no app scripts). If V6 adds one, the same guard comes with it | None |

## 2. Frontend security pass (part of T-29)

No clear defect found; nothing changed.

| Check | Result |
|---|---|
| HTML built from data (`dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`) | **None** in `src/` |
| `target="_blank"` without `rel` | **None:** all 23 links carry `rel="noreferrer"` or `rel="noopener…"` (`noreferrer` implies `noopener`) |
| `window.open` | One, in `src/components/ContactSection.tsx`, to a fixed WhatsApp link without `noopener`. **Dead code:** its only user, `src/pages/Home.tsx`, is not routed (left from the corporate site, like `ProjectConsultation.tsx`). **Removed on 2026-11-17** with the rest of the dead corporate-site components (Home.tsx and the 15 components only it used, plus FeaturedProducts.tsx), at the coordinator's request |
| Redirects or `next=` parameters that accept other origins | **None:** no page reads a redirect target from the address. Sign-in returns to `location.state.from`, which only this app's own code sets (history state cannot be set by a link from another site). `mailto:` in the same dead component encodes its fields |
| Public pages that render owner-hidden fields | **None found.** The public Tap calls only the published public functions (the contract test fails on anything else). `get_public_profile` (035) returns phone, WhatsApp and email only when the Tap shows them; a Tap in Lost mode carries no profile at all; a card that is not active opens no Tap (v0.15). The account-level `profiles.show_phone` / `show_whatsapp` / `show_email` flags appear on no V6 page (only the data export reads them) |

## 3. Not part of this pass

- The owner's wording gates stay open (T-11, T-13, T-08/T-09, T-15).
- V6-123 and V6-014: diagnosed separately (2026-11-16), not changed.
- The V5 audit's `tap_profiles.suspended_at` / `last_content_edit_at` finding is the backend's (the coordinator raises it with Session A).
