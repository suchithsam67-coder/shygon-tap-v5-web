# DEC-2026-044: Owner data export (JSON + vCard), Version 01 task T-10

| Field | Value |
|---|---|
| Decision ID | DEC-2026-044 |
| Title | What an AAROH owner can download about themselves, what is left out, and how the server builds it |
| Date opened | 2026-11-03 |
| Domain | Privacy (the right of access; third parties' data); Security (a privileged reader of one account's data); Product (the Settings → Your data page) |
| Level | **L3**: new privileged database functions that read every AAROH table for one account. DEC-2026-018: a 24-hour cool-off and the checklist before any real database |
| **Accountable Owner (A)** | The repository owner (the founder), who holds every product role (DEC-2026-018 Option B). Counsel confirms the privacy-notice wording (F-20 is "F + C"); that does not block the local build |
| Responsible (R) | Session A (backend): the server export, its migration, contract and tests. Session B (frontend): the download page |
| Consulted | The coordination session (V01 task registry T-10); Session B |
| State | **APPROVED FOR THE LOCAL BUILD, 2026-11-03.** The owner, in Session A's session: "Approve T-10 build", answering "Approve building T-10 locally on DEC-2026-044's recommended answers?". Q1–Q6 are therefore as recommended (§5). Local only: nothing is applied, pushed or deployed. Counsel's review of the privacy-notice wording still applies before release. History: PROPOSED 2026-11-03 (`bec5580`) |

Labels: **OBSERVED** (in this repository or a decision record), **INFERRED** (reasoned, not tested), **PROPOSED**.

## 1. Question

Version 01 promises that the owner "can export their data" (`docs/shygon-os/v01/SHYGON_AAROH_VERSION_01_COMPLETE_SCOPE.md` §2.3). What goes into that export, what stays out because it belongs to someone else or is a security value, and how is it built so that nothing new can be added to an account without the export noticing?

## 2. What is already decided or built [OBSERVED]

- **Scope.** F-1 approved the V01 scope on 2026-11-02 ("Approve F-1", relayed by the coordinator with the founder's words). That scope includes "Data export (JSON + vCard)" for V01 (F-20's V01 part, recommended default: "a basic owner export (JSON + vCard) in V01").
- **Acceptance criterion** (`SHYGON_OS_ACCEPTANCE_CRITERIA.md` §5): "Export includes it; deletion removes it (or the legal reason it's kept is documented)."
- **The export that exists today (V6-072, `src/services/privacy.ts`)** runs in the browser and reads what row-level security lets the owner read: profile, Tap, orders, order items, entitlements, cards, notifications, support tickets and messages, account events.
  - It **misses every AAROH table**. Those tables are closed to client roles by design (029, 031–034, 037): modes and Info, Emergency, Return to Owner, Connect and its consent ledger, Privé demo requests, Verified Tap. Opening them to the browser would weaken RLS, which is not allowed.
  - It uses `select('*')`, so whatever column RLS allows comes along. On `cards` that includes `activation_code` and `card_uid`, the chip's serial number. Verified Tap keeps the UID out of every answer and stores only a keyed digest (037).
- **Deletion** (`docs/runbooks/account-deletion.sql`, `test:account-deletion` 9) removes or anonymises every AAROH table for an account and keeps orders for tax law. This is the list the export must match.

## 3. Options

| Option | What | Assessment |
|---|---|---|
| **A (recommended)** | One server operation, `POST /api/account {op:'owner.export'}`. It calls two service-only database functions (migration 038): one checks the limit and records the export, the other builds the whole export from explicit field lists in one read. Session B points the existing "Download your data" button at it | One consistent snapshot. The field lists live next to the schema, so the database gates (rollbacks, admin-contract, golden) cover them. A new test fails whenever a table linked to an account is neither exported nor excluded with a reason. No table is opened to the browser |
| B | Extend the browser export | Impossible without opening the closed AAROH tables to client roles. Rejected |
| C | Build the export in the Netlify function from several service-role reads (no migration) | Works, but each read sees a different moment. The field lists sit far from the schema, and none of the database gates checks them |

## 4. The proposed design (option A) [PROPOSED]

### 4.1 The rule for every field

1. **Everything about the owner that the owner can already see** in their dashboard or through their own API calls is in.
2. **Another person's personal data is out**, even where the dashboard shows part of it. This covers finders, Connect counterparts, emergency contacts, visitors and staff (Q2–Q4).
3. **Security values are out**: tokens and their hashes, OTP and code hashes, idempotency keys, keyed digests, card activation codes, chip UIDs, the Verified Tap UID digest and counter, and internal lease or retry fields.

Every section carries counts where content is left out, so the owner can see that something exists.

### 4.2 Sections (format `shygon-account-export/2`)

| Section | From | In | Out (why) |
|---|---|---|---|
| `account` | `profiles`, `customers` | name, contact fields, privacy switches, company, job title, notification choices, the customer ID, dates, suspension date and reason | — |
| `tap` | `tap_profiles` | every field the owner edits (address, display fields, links, theme, plan, add-ons), status and dates | `suspended_by` (a staff account id: rule 2) |
| `modes` | `tap_mode_state`, `info_pages`, `tap_mode_audit` | active and previous mode, version, changed date; the Info record; the audit (field names only, as stored) | `last_idempotency_key`, `last_result` (rule 3) |
| `cards` | `cards`, `tap_device_auth` | card id, type, edition (design, number, of, chapter), nickname, status, dates; the Verified Tap code, key epoch, last verified and retired dates | `activation_code`, `card_uid`, `uid_hmac`, `last_counter` (rule 3) |
| `orders` | `orders`, `order_items`, `order_status_history`, `entitlements` | as the dashboard shows them, with payment status and Razorpay references | the admin-only payment ledger and admin notes (staff records; each order already carries its amount and status) |
| `emergency` | `emergency_settings`, `emergency_contacts`, `emergency_events`, `emergency_event_recipients`, `emergency_audit` | settings; each contact's name, relationship, channel, verified date and **last 4 digits** (as the dashboard shows); each alert's initiator, status, dates and per-contact delivery status | full contact numbers (Q4); `visitor_digest`; provider ids, errors and attempts; challenge code hashes |
| `returnToOwner` | `rescue_settings`, `rescue_threads`, `rescue_messages`, `rescue_blocks`, `rescue_audit` | settings and hint; each thread's status and dates; **the owner's own replies**; a count of finder messages per thread; a count of active blocks | finder message text (Q2); finder token hash and digest; idempotency and client keys |
| `connect` | `connect_settings`, `connections`, `consent_grants`, `connect_audit` | settings; each connection's role (requested / received), status and dates, and the note when the owner wrote it; **the owner's own consent grants in full** (scope, purpose, version, granted, expiry and revocation); grants the owner received, without the grantor's identity | the other person's account, Tap, name and shared fields (Q3); a note written by the other person |
| `prive` | `prive_demo_requests`, `prive_demo_request_events` | the owner's demo requests and their steps (marked demo) | idempotency keys |
| `notifications`, `support`, `accountEvents` | `notifications`, `support_tickets`, `support_messages`, `account_events` | as today | staff identities on support replies (the reply text stays: it was sent to the owner) |
| `excluded` | — | a fixed list naming each category left out and why, in plain words | — |

Not in the export, as today: **visitor analytics** (`tap_events`; these are records about the people who opened the Tap, which the analytics page summarises), the Verified Tap verification log (`tap_verify_events`; visitors' digests) and every admin table.

### 4.3 The vCard (Q5)

A vCard 3.0 (the version phone contact apps import most reliably) of the owner's **own Business profile**. It has their name, headline or job title, company, the fields their privacy switches show publicly (phone, email, website, social links) and their Tap address. Text is escaped as RFC 6350 requires (`\`, `,`, `;`, line breaks). If the Tap has no published address, the URL line is left out.

### 4.4 Operation, limits and audit

- **`POST /api/account`, `{ op: 'owner.export' }`.** The answer is 200 `{ export, vcard }` with `cache-control: no-store`; `vcard` is `null` when there is no Tap. Errors: 401 `unauthenticated` (before anything else); 400 `invalid_request` / `unknown_op` (inherited names included); 405; 429 `rate_limited` with `retryAfter`; 500 `internal`. The account comes only from the verified token.
- **Limit:** 5 exports per account per 24 hours (Q6). Each section is capped at 2,000 rows, newest first, with `truncated: true` if the cap is reached. That is far above any real account today [INFERRED].
- **Audit:** one `account_events` row (`event_type 'data_export'`, the detail holding only the format and row counts), so the owner sees the export in their account history. One log line `account.exported` holds counts, never content. The limit counts these rows.
- **Suspended accounts can still export** (Q6): the right of access does not end with a suspension.

### 4.5 Migration 038 (no new table)

- `account_export_begin(p_user uuid)`: VOLATILE. It checks the limit and writes the `account_events` row. It returns `{ ok }` or `{ ok:false, code:'rate_limited', retryAfter }`.
- `account_export(p_user uuid)`: STABLE, so it reads one snapshot. It returns the whole export as `jsonb`, built only from the explicit field lists in §4.2 (never `*` or `to_jsonb(row)`).
- Both are `SECURITY DEFINER`, `SET search_path TO 'public', 'pg_temp'`, revoked from PUBLIC, anon and authenticated, and granted only to `service_role`. The admin-contract client-execute gate stays at "66 as on live + 3 approved".
- Rollback: drop both functions; the `data_export` rows in `account_events` are left as history.

### 4.6 Tests (`test:account-export`, in `ci`)

1. **Export parity gate.** It walks the database's foreign keys from every table that holds an account link (user, customer, Tap, card, order, thread, connection, event…). Every table it reaches must be listed in the test's map as exported, excluded with a reason, or admin-only. A new table fails the gate until someone classifies it. The deletion procedure is checked against the same map: every exported table must be cleared or anonymised by `account-deletion.sql`, or carry a documented legal reason to keep it (orders).
2. **The owner's own values round-trip:** a seeded account with data in every section finds each value in the export.
3. **Canaries never appear:** another account's data; finder message text; the other side's Connect fields; full contact numbers; visitor digests; OTP, code and token hashes; activation codes; card UID; `uid_hmac`; idempotency keys; staff ids.
4. **Limits and audit:** the sixth export in 24 hours gets 429 with `retryAfter`; one `account_events` row per export, with no content.
5. **Access:** 401 before anything; inherited `op` names give 400 `unknown_op`; neither function is executable by a client role.
6. **vCard:** escaping; private fields absent; no URL line without a published address.
7. **After deletion:** the export holds no AAROH section.

### 4.7 What changes for Session B

The "Download your data" button calls `owner.export` instead of reading tables in the browser. It saves two files: the JSON, and a `.vcf` when `vcard` is not null. It shows the 429 wait time calmly. The browser export and its `select('*')` go away. Customer wording goes to the owner at Session B's gate (F-19).

## 5. Questions for the owner

| # | Question | Recommendation |
|---|---|---|
| Q1 | How is the export built? | **A**: one server operation and migration 038 |
| Q2 | Return to Owner: do finders' messages go into the owner's export? | **No.** Include thread status and dates, the owner's own replies and a count of finder messages. Leave out finders' words: they may hold the finder's own number or address, and a file copy outlives the 90-day retention. *Alternative:* include everything the inbox shows |
| Q3 | Connect: how much of the other person is in it? | **None.** Include the owner's side (role, status, dates, their own note), their own consent grants in full, and received grants without the grantor's identity. *Alternative:* add the other person's display name as the app shows it |
| Q4 | Emergency contacts: full numbers? | **No.** Include name, relationship, verified date and the last 4 digits, as the dashboard shows |
| Q5 | vCard: which fields? | **The public ones only**, following the owner's privacy switches, because a vCard is made to be shared. *Alternative:* every field |
| Q6 | Limits and suspension | **5 per 24 hours; allowed while suspended** |

Counsel (F-20, F-23) reviews the privacy-notice wording about the export and the third-party exclusions before release. That does not block a local build.

## 6. Not affected

No table is opened to a client role. No host switch is added; the export is useful as soon as it is deployed, and needs no provider. No earlier operation changes. Account deletion is unchanged: the parity gate only checks it.

## 7. What the owner approves

To build locally: "Approve T-10 local build" (Q1–Q6 as recommended), or the answers that differ. Session A then writes migration 038, `/api/account` (+ the Vercel adapter), contract v0.12 and `test:account-export`, runs the full gates, commits locally and tells Session B. Nothing is applied, pushed or deployed.

## 8. As built (2026-11-03, local)

Built on `v6/aaroh-backend` to §4 with Q1–Q6 as recommended; readiness report §23 has the evidence. Nothing is applied, pushed or deployed.

- **Migration 038** has two service-only functions:
  - `account_export_build(p_user)`, STABLE: the whole export from one snapshot;
  - `account_export_request(p_user)`: the limit, the build, the vCard fields and the `account_events` row, under a per-account advisory lock. It is one call, not the two sketched in §4.5, so the audit row can carry the row counts.
- **`/api/account` `owner.export`** (+ the Vercel adapter), and `netlify/lib/vcard.mjs`. Contract AAROH-API v0.12, §4a.
- **Differences from the §4 sketch, each on the side of less data:**
  - `taps` is a list (one Tap per account in v1), so none is ever dropped.
  - Orders are matched by `user_id` or `customer_id`; in the baseline, `orders.customer_id` is the auth user.
  - Left out besides §4.2: the order status-history `note` (written by staff), notification `metadata` (internal routing), the card's programming URLs (`nfc_url`, `qr_code_url`), and the `detail` of the Emergency, Return to Owner and Connect audits (provider ids and refusal codes). Each audit row keeps its actor, action and time.
- **`test:account-export` 12, in `ci` and `ci.yml`.** It includes the export-parity gate: 47 linked tables; 33 exported, 5 excluded with a reason, 10 staff-only.
  - Negative control [OBSERVED]: a copy of 038 that leaked the activation code and the finders' words, and added an unclassified table, failed 3 checks (the canaries, the round trip, the classification).
  - Found before commit: the row cap's `text[] || 'name'` read the name as an array literal. The cap test caught it, and `array_append` fixed it.
- `test:security` now includes `/api/account` in the inherited-name check (5 functions).
