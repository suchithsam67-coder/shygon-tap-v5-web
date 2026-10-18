# CODEX_HANDOFF — SHYGON TAP V5 / SHYGON AAROH V6

Prepared **2026-10-18**. Read-only audit. This package does not authorize code changes, migration changes, production access, or deployment.

Labels: `VERIFIED IN CURRENT CHECKOUT` · `VERIFIED BY CURRENT TEST` · `HISTORICAL RESULT` · `REPORTED INVESTIGATION FINDING` · `INFERENCE` · `UNVERIFIED`

Companion documents in this folder:
[CURRENT_STATE.md](CURRENT_STATE.md) · [ARCHITECTURE_MAP.md](ARCHITECTURE_MAP.md) · [PRODUCTION_DRIFT.md](PRODUCTION_DRIFT.md) · [MIGRATION_STATUS.md](MIGRATION_STATUS.md) · [TESTING_GUIDE.md](TESTING_GUIDE.md) · [NEXT_ACTIONS.md](NEXT_ACTIONS.md) · [CODEX_START_PROMPT.md](CODEX_START_PROMPT.md)

---

## 1. Read this first

1. **The checkout you are in is not the V6 work.** This worktree (`claude/shygon-v6-aaroh-handoff-ff45a6`, `8becea3`) is the V5 baseline. The rebaseline work is in `shygon-tap-v5-web-rebaseline` (branch `v6/rebaseline-2026-10-18`, `4d730c4`). Check `git worktree list` before doing anything. (VERIFIED IN CURRENT CHECKOUT)
2. **The fresh production baseline has not been supplied.** `000_live_baseline_2026-10-18.sql` does not exist in any checked-out worktree. (VERIFIED IN CURRENT CHECKOUT)
3. **The baseline intake script described in the request does not exist** in any checked-out worktree. Its described fixes cannot be verified. (VERIFIED IN CURRENT CHECKOUT, absence)
4. **Production has not been inspected.** All production-drift facts come from a local evidence CSV and reports. They are not re-verified. (REPORTED INVESTIGATION FINDING)
5. **No tests were run in this pass.** Historical results are labelled as such. (see TESTING_GUIDE)

---

## 2. Product vision (as documented in repo and request)

- **SHYGON Technologies** — company. The customer website and product lines are in this repo.
- **SHYGON TAP V5** — the existing conventional NFC card product (historically NTAG213, standard business / event cards). The customer website, header, footer, navigation, typography, colours, and animations must remain **intact** unless the owner approves otherwise. (Owner constraint, per request; the V5 website code is in `src/` at `8becea3`. VERIFIED IN CURRENT CHECKOUT for the code; the constraint itself is REPORTED from the request.)
- **SHYGON AAROH V6** — flagship NFC card family integrated with SHYGON OS. Intended as **one shared software platform with multiple physical card designs and configurable experiences**. Customer-oriented; organisations may buy universal IDs for employees. V5 and V6 launch together. **SHYGON Privé is not a separate launch product** (REPORTED from request; DEC-2026-035 records V6 scope as "a software platform; physical cards out" — VERIFIED IN CURRENT CHECKOUT, DECISIONS.md line 54).
- **SHYGON OS** — shared software and profile platform.
- **Design direction** (owner, REPORTED): premium black, champagne, ivory, royal blue where appropriate; elegant typography; tactile card textures; restrained animation; print-friendly designs. Card design memory: "textured, material, never flat; follow the design system." (VERIFIED as local memory notes; repo design assets are in `design-assets/` on `v6/aaroh-store`.)

### Implemented vs planned (honest split)

| Item | Status | Label |
|---|---|---|
| V5 customer website (store, profile page, auth, orders, account) | Implemented in `src/` | VERIFIED IN CURRENT CHECKOUT |
| Public Tap pages `/t/:username`, `/tap/:username` | Implemented (route exists; behaviour not traced) | VERIFIED IN CURRENT CHECKOUT (route); UNVERIFIED (behaviour) |
| Email/password auth, reset, password change | Implemented | VERIFIED IN CURRENT CHECKOUT |
| Admin authorization via `admin_users.user_id` | Implemented in edge function helper | VERIFIED IN CURRENT CHECKOUT |
| Suspension guard (020 + 028) | Prepared locally; **not applied to production** | VERIFIED IN CURRENT CHECKOUT (files); DECISIONS.md |
| AAROH V6 storefront (no-price, roadmap, printer-ready artwork) | On `v6/aaroh-stabilise` and `v6/aaroh-store` branches; not on this V5 checkout | VERIFIED IN CURRENT CHECKOUT (commit subjects) |
| V6 Stage 6 release candidate | Committed; release readiness recorded **NOT READY** | VERIFIED IN CURRENT CHECKOUT (commit subject `6d00f2f`) |
| Owner app: cinematic intro, returning reveal, replay, reduced motion, SHYGON OS dashboard, card pairing, active-mode selection, modular features | **Planned only** (AAROH multi-experience brief, paused 10-10) | REPORTED (local memory); UNVERIFIED in code |
| Live payments | **Deferred** per owner decision | VERIFIED IN CURRENT CHECKOUT (`payment-mode` function returns `test` / `live` / `unconfigured`; DECISIONS.md) |
| Physical cards / NFC `/d/<code>` + NTAG 424 DNA | **Planned**; cards deferred, not sold in RC (DEC-2026-035) | VERIFIED IN CURRENT CHECKOUT (DECISIONS.md) |

---

## 3. Architecture (summary — details in ARCHITECTURE_MAP.md)

- Frontend: Vite + React 19 + TypeScript + react-router v7 + Tailwind v4 + framer-motion. VERIFIED IN CURRENT CHECKOUT.
- Backend: Supabase (Postgres, Auth, Storage, Edge Functions), Netlify Functions, parallel `api/*.mjs`. VERIFIED IN CURRENT CHECKOUT.
- Payments: Razorpay handlers present; live activation deferred. VERIFIED IN CURRENT CHECKOUT.
- Auth: Supabase Auth client in `src/lib/supabase.ts`; session context in `src/lib/auth.tsx`. VERIFIED IN CURRENT CHECKOUT.
- Admin: `supabase/functions/_shared/admin.ts` checks `admin_users` by authenticated `user_id`. VERIFIED IN CURRENT CHECKOUT.
- Deployment: `vercel.json` and `netlify.toml` both present; live host is **UNVERIFIED** from repo alone. Live site `www.shygontech.com` **serves code not from this repo** per backlog V6-107 (REPORTED).

---

## 4. Repository structure (top level, V5 baseline `8becea3`)

`api/`, `netlify/` (functions, lib, tests), `public/`, `scripts/` (brand, ci), `src/` (components, pages, lib, services, styles, seo, data, hooks), `supabase/` (migrations 001–019 here, functions, tests, proposed, APPLY_ALL.sql), root docs (`PRODUCTION.md`, `LIVE_SUPABASE_STATE.md`, `RAZORPAY_SETUP.md`, `TEST_REPORT.md/.html/.pdf`, `V5_*.md`), `package.json`, `vite.config.ts`, `vercel.json`, `netlify.toml`.

Rebaseline branch adds `docs/` (governance, decisions, release, v6, shygon-os), `supabase/migrations/020–026, 028`, `supabase/baseline/`, `supabase/local/`, `supabase/tests/` (extended). VERIFIED IN CURRENT CHECKOUT.

Note: the V5 root contains `shygon-aaroh-v6-snapshot-2026-10-14.zip` (213 MB, tracked-or-untracked not checked). Do not open or extract it without a plan (memory: do not paste APPLY_ALL.sql; treat the zip as untrusted-by-default archive). VERIFIED IN CURRENT CHECKOUT (file present).

---

## 5. V5 / V6 constraints

| Constraint | Source | Label |
|---|---|---|
| Preserve V5 website layout, header, footer, navigation, typography, colours, components, buttons, cards, branding, animations | Request; memory "storefront theme sources" | REPORTED (owner) |
| Do not rebuild the website; do not turn it into native / Capacitor / React Native | Request | REPORTED (owner) |
| Admin interface is handled by another developer; do not create or replace it from storefront work | Request; team ownership | REPORTED (owner) |
| Do not create another Supabase project | Request | REPORTED (owner) |
| No new tables or RLS/grant changes without authorization | Request | REPORTED (owner) |
| No deletion of data or database objects | Request | REPORTED (owner) |
| Payment activation deferred unless owner decides | DECISIONS.md, DEC-2026-035 | VERIFIED IN CURRENT CHECKOUT |
| V6 scope: software platform; physical cards out of RC; Taps only after payment (D-6) | DEC-2026-035 | VERIFIED IN CURRENT CHECKOUT |

Where each rule is written: **architecture rules** → `docs/DECISIONS.md` and `docs/governance/decisions/` (rebaseline branch). **Contextual notes** → memory files (not repo). Distinguish them: the owner's written decisions in `docs/` are authoritative; memory notes are historical context.

---

## 6. Database constraints (summary)

- Do not apply any migration to production before DEC-2026-003 §3.1 conditions hold. (DECISIONS.md, "Not authorized" row)
- Migration 027 is reserved for the AAROH catalogue (DEC-2026-037). Not present on the rebaseline branch.
- Migrations 020 and 028 are prepared, not applied.
- Migration 025 must not be rebased until the fresh baseline comparison has been reviewed.
- Full detail: [MIGRATION_STATUS.md](MIGRATION_STATUS.md).

---

## 7. Team ownership (REPORTED from request; not in repo)

| Area | Owner | Notes |
|---|---|---|
| Frontend, website, profiles, customer UI | Owner (repository owner) | Current work in this repo |
| Backend, database, API, authentication, orders | Friend 1 | Migrations and functions overlap this team — coordinate before changing `supabase/migrations` or `supabase/functions` |
| Admin dashboard, admin application, analytics, admin UI | Friend 2 | Do not change admin UI from this repo; `supabase/functions/_shared/admin.ts` is shared |

Cross-team dependencies: migration changes (Friend 1), admin authorization helper (Friend 2 uses it), storefront data reads (owner). **Do not silently take over another developer's work.**

---

## 8. Migration status (summary)

| Item | Status | Label |
|---|---|---|
| 019 | Order-confirmation SMS in repo; **does not define** the slug functions the finding names | VERIFIED IN CURRENT CHECKOUT |
| 020 | Suspension guard; prepared, not applied | VERIFIED IN CURRENT CHECKOUT; DECISIONS.md |
| 025 | Public Tap privacy/analytics; rebase assessment required | VERIFIED IN CURRENT CHECKOUT (file); REPORTED (rebase) |
| 027 | Reserved for AAROH; absent on rebaseline | VERIFIED IN CURRENT CHECKOUT |
| 028 | Insert guard; prepared, not applied | VERIFIED IN CURRENT CHECKOUT |
| Seven production migrations (11–15 Oct) | Recorded in CSV; not in repo as files | VERIFIED IN CURRENT CHECKOUT (CSV) |

---

## 9. Baseline procedure

- Original baseline: `supabase/baseline/000_live_baseline.sql` (also `supabase/baseline/history/000_live_baseline_2026-09-30.sql`, identical SHA-256 `c12b46eb…0655`, 274,597 bytes). Capture **2026-09-30 20:24:52**. Server 17.6, pg_dump 18.6. VERIFIED IN CURRENT CHECKOUT.
- Must be preserved in Git history. VERIFIED IN CURRENT CHECKOUT (files tracked on the rebaseline branch, with history copy).
- Fresh baseline procedure (documented in request): `pg_dump 18.x`, server 17.6, schema-only, public only, `--no-owner`, `--verbose`, file `000_live_baseline_2026-10-18.sql`. **Not yet supplied.** The owner runs it locally with a secure password prompt; no credentials go into docs or chat. REPORTED (request).
- Validation checks required (from request): header and versions; schema-only content; no secrets; verbose markers; file size and checksum; function-definition hashes; compatibility with the test loader (`supabase/tests/baseline.sql`). Intake script: **absent**.

---

## 10. Production drift — headline

Confirmed by local evidence: the seven recorded migrations (names and versions) are present in `docs/governance/evidence/2026-10-18_production-schema-migrations.csv`. The baseline date correction is confirmed. Everything else (grants, function diffs, product-activation changes, the `tap_slug_*` definition source) is a **reported finding awaiting revalidation**. Details: [PRODUCTION_DRIFT.md](PRODUCTION_DRIFT.md).

---

## 11. Security concerns

| Concern | Status | Label |
|---|---|---|
| Suspension bypass: a customer can un-suspend own Tap/account (F1) | Fixed locally (020 + 028); not in production; DEC-2026-003 approved conditionally | VERIFIED IN CURRENT CHECKOUT (decision + files) |
| Production `shygontap_profiles` (4 published pages): no suspension, published by default, anyone can list all columns incl. `owner_id` | Reported; V6-107 | REPORTED INVESTIGATION FINDING (backlog text) |
| `shygontap_profiles` broader grants than intended | Reported | REPORTED INVESTIGATION FINDING |
| `tap_page_edit_state` callable by anon via defaults | Reported; anon grant not verified in CSV excerpt | REPORTED INVESTIGATION FINDING |
| Web3Forms public key in history (commit `9c8caa7`) | DEC-2026-020: approved public-key reuse; re-confirmation pending; full-history scan stays red | VERIFIED IN CURRENT CHECKOUT (DECISIONS.md) |
| Secret rotation | Approved by human (memory); release requirement per DEC-2026-035 D-1 | VERIFIED IN CURRENT CHECKOUT (DEC-2026-035 D-1) |
| Upgraded-zip deployment | DEC-2026-033 Q1/Q2 open; do not go live | REPORTED (memory) |

---

## 12. Test commands

See [TESTING_GUIDE.md](TESTING_GUIDE.md). **None were run in this pass.**

---

## 13. Current blockers

1. Fresh baseline `000_live_baseline_2026-10-18.sql` not supplied. (VERIFIED IN CURRENT CHECKOUT)
2. Intake script absent. (VERIFIED IN CURRENT CHECKOUT)
3. DEC-2026-025 (organisations timing) — PROPOSED, human decision required. (VERIFIED IN CURRENT CHECKOUT)
4. DEC-2026-028 (card lifecycle vocabulary) — PROPOSED, human decision required; blocks M1.3. (VERIFIED IN CURRENT CHECKOUT)
5. DEC-2026-020 — re-confirmation by named Security Owner pending; Security Owner is UNASSIGNED per DECISIONS.md. (VERIFIED IN CURRENT CHECKOUT)
6. DEC-2026-003 — §3.1 conditions (independent review, rotation, operator window) before any production application of 020/028. (VERIFIED IN CURRENT CHECKOUT)
7. Release readiness for V6 Stage 6: NOT READY, stopped at production gate awaiting owner. (VERIFIED IN CURRENT CHECKOUT, commit `6d00f2f` subject)
8. Live-site relationship (V6-107): deploying V5/V6 to that domain replaces a non-repo app. (REPORTED; memory "live-site-second-app" is local context)

---

## 14. Next actions

See [NEXT_ACTIONS.md](NEXT_ACTIONS.md).

---

## 15. Approval requirements

Require explicit owner approval before: running anything against production; applying any migration; running `db:push`; creating or modifying RLS, grants, or tables; deleting data or objects; deploying; committing or pushing; rebasing `v6/rebaseline-2026-10-18`; changing admin UI; changing `supabase/functions/_shared/admin.ts`.

---

## 16. Limits of this audit

- No production access. No live website request. No dependency install. No test execution.
- Several sibling worktrees were only inspected for `git status` / `git log`, not by content (see CURRENT_STATE §3).
- Decision-record bodies were read at the header and index level, not in full.
- The request's historical results (23/23, 48/48, 16/16, lint, audit) are **not** re-observed.
