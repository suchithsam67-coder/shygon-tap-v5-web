# DEC-2026-035: SHYGON V6 release scope and working decisions

| Field | Value |
|---|---|
| Domain / Level | Product + Release + Security / **L3** (it authorizes RLS, payment and identity work) |
| **Accountable Owner** | Repository owner (one-person model, DEC-2026-018) |
| State | **APPROVED** in session, 2026-10-05 (D-1, D-2 and the four Stage 2 prerequisites). **Amendment A-1, 2026-10-06:** run mode, D-4, D-10, test dependencies. D-3, D-7, D-8, D-9, D-11 and the new D-12 are **OPEN** (see below) |
| Evidence | `docs/v6/stage-1-audit.md` (commit `47ba691`); backlog `docs/v6/backlog.md` |
| Related | DEC-2026-001 (the waiver extension), DEC-2026-018, DEC-2026-022, DEC-2026-024, DEC-2026-029, DEC-2026-034 (amended by N-1) |

## Question
What is SHYGON V6, and which Stage 1 decisions bind the V6 stages?

## Decisions (repository owner, 2026-10-05, in session)

**Stage 1 audit: approved.** The objective is the **SHYGON software platform, production-ready as V6 within one week**. Not a perfect architecture, and not the whole future SHYGON OS.

| # | Decision | Recorded effect |
|---|---|---|
| **D-1** | Extend the M0.3 credential-rotation waiver to V6 development and release-candidate work | Recorded in DEC-2026-001, "Extension". No rotation during implementation unless explicitly authorized. Rotation stays a **release requirement**. The procedure is prepared in `docs/runbooks/RUNBOOK-secrets.md`. No secret printed or committed. No control weakened. The waiver is temporary |
| **D-2** | **V6 = the software platform release.** The audit's "V5 + SEO" recommendation is rejected. **The physical card / manufacturing release is not part of V6** | Scope: SHYGON ID, authentication, profiles, SHYGON TAP software, public Tap, privacy, Tap lifecycle, customer dashboard, admin foundation, payments, fulfilment, entitlements, notifications, analytics, security, RLS, auditability, SEO, accessibility, observability |
| **N-1** | **V6 migrations take numbers 022 onward** | **Amends DEC-2026-034 Q3**, which kept 022–028 for `fix/upgraded-zip` (C0) and 029+ for commerce: that branch renumbers if it is ever integrated, and commerce follows V6. Doc 12 M0.4's `022_policy_role_cleanup` is superseded by the V6 numbering. The DEC-2026-034 file lives on branch `governance/dec-2026-034-commerce-scope`; update it there when that branch is next touched |
| **D-6** | **O-14: a Tap exists only after payment** | Clients can no longer insert `tap_profiles` rows. Taps come only from payment provisioning, the fulfilment safety net (server) or an administrator (L3 RLS change, local first) |
| **D-5 / cards** | **Card-specific items are deferred to the card release, and the V6 release candidate does not sell physical cards** | I-4 (V6-003), O-7 (V6-011), F3 (V6-034), F4 + O-3 (V6-035) and I-5 (V6-019) leave V6. In V6, card products are not purchasable, so nobody pays for a card that cannot be activated. Digital experiences and add-ons stay on sale |
| **Privacy** | **Privacy hardening, no tier model** | Server-enforced per-field public/private visibility (extending today's toggles), no leaks on the public Tap (golden-tested), salted analytics hashing, an account data export and deletion flow, updated privacy docs. Trusted/organization tiers wait for DEC-2026-025 |

## Still open (raised in the Stage 1 audit §10; not answered yet)
- **D-3, governance mapping.** Interim working rule, unchanged from M0.3: V6 L3 changes are implemented, tested and committed locally on `v6/*` branches. The DEC-2026-018 24-hour cool-off and checklist apply **before approval or application**, not before local implementation.
- **D-4, E2E environment.** Needed before Stage 3 so that Stage 5 can run.
- **D-7, secret-scan gate** on `9c8caa7`.
- **D-8, admin scope.** Interim reading of D-2's "admin foundation": the DB/edge admin layer plus auditability. No new admin UI.
- **D-9, the customer-facing SHYGON ID** (raised in Stage 2). D-2 puts "SHYGON ID" first. Today the only per-account code is the internal `customers.customer_id` (`CUST-` + 10 hex digits, or the 021 fallback), which customers never see. What the SHYGON ID shown to a customer is (that code, or a new format) is a product decision. Nothing is surfaced until it is made.
- **O-15** (raised in Stage 2; `docs/DECISIONS.md`): any active admin reads every support ticket, message and notification through `is_admin()`. Tightening it is an L3 policy change for the admin-foundation stage.

## Amendment A-1 (repository owner, 2026-10-06, in session)

The owner wrote **"complete software"** after the Stage 2 report, then answered four questions in session. Recorded as given:

| # | Question | Owner's answer | Recorded effect |
|---|---|---|---|
| Run mode | How to run Stages 3–6 (reading "complete software" as: Stage 2 approved, carry on) | **Run 3 to 6 back-to-back** | Each stage gets its own commit and `docs/v6/stage-<n>-report.md`. Work stops at the production gate, or earlier for anything on the Shared Rules' "ask me" list. No push, deploy, live database or live payments |
| **D-4** | Where the three end-to-end journeys run (this machine has no Docker, WSL or Supabase CLI) | **No-Docker local stack** | `supabase/local/`: real Postgres (PGlite: live baseline + 020 onward + a catalogue fixture), a Supabase-compatible gateway (the PostgREST and Auth subset the app uses; Realtime accepts and stays quiet), the real server functions, and a Razorpay stand-in. Playwright drives the installed Edge. The database, RLS, grants, triggers and functions are real; the HTTP layers and Razorpay are stand-ins. Nothing leaves the machine |
| **D-10** | What a new customer buys in the RC (ADR-V6-01) | **Digital-first** (option A) | The entry purchase is a Business, Premium or GOAT experience. Payment creates the Tap page as a draft. Card pages say "coming soon", with no checkout and no waitlist form. Card offers are removed from the structured data. The server refuses card orders by itself (`CARD_SALES_ENABLED`) |
| Test deps | Add test-only dev dependencies (a lockfile change) | **Yes** | Vitest, Testing Library, jsdom, Playwright (driving the installed browser), and axe-core for the Stage 6 accessibility checks |

**Opened 2026-10-06 (Stage 3):**
- **D-11, privacy by default for the login email.** Provisioning copies the account's login email into the new Tap's public email field, switched on, so it is public as soon as the owner publishes. CONFIRMED in `supabase/tests/public-tap.mjs`, where a characterisation test records it. Since migration 025 the owner can hide it. Should a new Tap start with that field empty? Recommended: yes. It is a product and privacy call, so it was not changed.
- **D-12, account deletion (Stage 4, V6-072).** A customer's deletion request is a `privacy` support ticket, handled by hand with `docs/runbooks/RUNBOOK-account-deletion.md`, which follows the published Privacy Policy (deleted within 30 days; orders and payment records kept up to 8 years). Stage 4 found that the live schema cascades an account delete into the customer's orders and payments (V6-090). Migration 026 makes it `RESTRICT`. Needed from the owner:
  - (a) approve the procedure (anonymise, rather than delete, a sign-in that has orders) and 026;
  - (b) where the deletion register lives, and who may run the deletion;
  - (c) O-17: whether deleted Tap addresses are reserved, so old links and QR codes cannot open someone else's Tap. A reserved address may contain a name.
- **Audit fix, owner to confirm.** A high advisory published after the Stage 1 audit, `source-map-js` < 1.2.2 (GHSA-68fv-2mgg-jv7q), reached the build through Tailwind and PostCSS and turned the `npm audit --audit-level=high` gate red. It was fixed with `npm audit fix`: `source-map-js` 1.2.1 → 1.2.2 in the lockfile only. No other existing package changed version (checked). Precedent: DEC-2026-021.

## Unchanged
- No production apply, deployment, push, live payment or credential rotation without explicit authorization.
- 020 and 021 remain unapplied (DEC-2026-018).
- Frozen contracts (doc 12 §2) change only with a recorded decision and contract tests.
