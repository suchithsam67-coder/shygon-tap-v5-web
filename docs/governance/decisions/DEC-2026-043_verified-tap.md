# DEC-2026-043: Verified Tap (NTAG 424 DNA SUN at `/d/<code>`)

| Field | Value |
|---|---|
| Decision ID | DEC-2026-043 |
| Title | How SHYGON AAROH proves on every tap that a card is genuine, and what it may say about it |
| Date opened | 2026-10-25 |
| Domain | Security (keys, a new public endpoint); Product (what the page says); Operations (chip personalisation) |
| Level | **L3**: new closed tables, a new public endpoint, key custody. DEC-2026-018: a 24-hour cool-off and the checklist before any real database |
| **Accountable Owner (A)** | The repository owner, who holds every role (DEC-2026-018 Option B) |
| Responsible (R) | Session A (backend). The pure crypto core is being written by OpenCode on `opencode/u1-sun-crypto` (coordinator, 2026-10-25) and comes to Session A as a hand-off |
| Consulted | Session B (frontend: the verdict page); the coordination session; ChatGPT's U1 threat model (pending, §8) |
| State | **PROPOSED (draft), ON HOLD for the owner's review.** Docs only. Nothing is built, keyed, personalised or deployed. **Owner, 2026-10-25, in session:** "I'll review DEC-2026-043 first. Hold contract v0.10 and migration 036 until I answer Q1-Q7 and the threat model (T-1 to T-7) is folded in." Until both are done, Session A writes no contract v0.10, no migration 036 and no `/api/verify` |

Labels: **OBSERVED** (in this repository or a decision record), **INFERRED** (from public vendor documents or reasoning, not tested here), **PROPOSED**, **PENDING** (waits for an input named in §8).

## 1. Question

New AAROH cards carry NTAG 424 DNA chips that put a fresh, signed value in the URL on every tap. What exactly should the server check, what may the page say about the result, where do the keys live, and how are chips personalised, so that "genuine" means something and nothing else is weakened?

## 2. What is already decided [OBSERVED]

- **The owner, 2026-10-16** (recorded in the coordination notes, not yet in a DEC file): new cards encode `/d/<code>` on **NTAG 424 DNA**, with a signed per-tap counter verified on the server. Legacy `/t/<slug>` keeps working.
- **Doc 08 (`docs/shygon-os/08_TAP_LIFECYCLE_HARDWARE.md`):**
  - §2, three identifiers that are never confused:
    - the chip UID: readable, cloneable, **never used for routing or trust**;
    - the public code in `/d/<code>`: unguessable, at least 64 bits;
    - the device key: secret, derived server-side from a master key.
  - §3: NTAG 424 DNA is recommended for new batches (decision OQ-2 is open).
  - §5: batch issuance with a manufacturing manifest, the UID captured at encoding, and a QR fallback printing the same `/d/<code>`.
  - §6: legacy cards are never broken.
- **Doc 07 (threat model), the A0 rule:** never authenticate by tap. A genuine chip proves the object, never the person holding it.
- **Differentiation plan (`docs/v6/aaroh/differentiation-plan.md`):**
  - pillar A1 and phase U1;
  - the claims register: no "unclonable", no "first" or "only".
- **Card design memory (2026-10-18):** the AAROH back carries no printed QR by default. Doc 08's QR fallback conflicts with that, so Q6 asks the owner.

## 3. How SUN works [INFERRED from NXP AN12196, AN10922 and the NTAG 424 DNA datasheet; RFC 4493]

- **What the chip adds on every read.** The NDEF URL gets two values in fixed positions, set at personalisation:
  - `PICCData`, 16 bytes encrypted with the chip's **SDM meta-read key**: the chip UID and a 24-bit read counter that the chip increments on every read;
  - `SDMMAC`, 8 bytes: a truncated AES-CMAC under a session key derived from the chip's **SDM file-read key**, the UID and the counter.
- **How the server checks it.** The server, holding the keys, decrypts `PICCData` and derives the session key. It recomputes the MAC, compares it in constant time, and accepts only a counter higher than the last one it accepted for that chip.
- **Per-chip keys.** Each chip's keys are diversified from a master key and the chip's UID (AN10922), so one extracted chip key does not expose any other chip.
- **What a copy can do.** A copied URL or a cloned static tag can replay at most a value that has already been seen. A rewritten tag cannot produce a valid MAC.

## 4. The proposal [PROPOSED]

### P-1. What "verified" means, and what it never means
- **It proves:** the chip holds a key SHYGON issued for that code, and this read is newer than any accepted before.
- **It does not prove:** who holds the card. It never signs anyone in, never unlocks an owner action, never grants access or payment (A0). It adds nothing to what the profile shows.

### P-2. URL and identifiers
- **The URL:** `https://<host>/d/<code>?p=<PICCData, 32 hex>&m=<SDMMAC, 16 hex>`. The parameter names are placeholders, fixed in contract v0.10.
- **`<code>`:** the device's public code, at least 64 bits and unguessable, as in doc 08.
  - Never the card id, which may be sequential.
  - Never the activation code, which is a secret.
- **The UID** is used only inside verification. It is compared with the one registered at personalisation and never returned, logged or shown.

### P-3. The server checks only on request from the page, never on a plain page load
- `GET /d/<code>?p&m` serves the page and checks nothing.
- The page's script then calls `POST /api/verify` with `{ op: 'tap.verify', code, p, m }`, and that call consumes the counter.
- Why: link-preview services and browser prefetch fetch URLs without running scripts (INFERRED; **PENDING T-5**), so they no longer use up a genuine owner's tap.
- A preview that does run scripts can still consume a counter. That is why P-4 shows a re-used counter as "already checked", never as a fake.

### P-4. Verdicts and what the page may say
The wording is a draft for the owner and must follow the claims register.

| Verdict | When | Page wording (draft) |
|---|---|---|
| `genuine` | the MAC is valid and the counter is above the last accepted one | "Genuine SHYGON AAROH" (+ edition and number, U4) |
| `already_checked` | the MAC is valid but the counter is not higher (a re-opened or shared link, or a preview that ran scripts) | "This tap was already checked. Tap the card again to check it." Neutral, never "fake" |
| `not_confirmed` | the MAC or decryption fails, or the UID differs from the registered one | "This could not be confirmed as a genuine SHYGON AAROH." No accusation |
| `not_verified` | no `p` and `m` (a QR, a typed or shared link) | Nothing about authenticity; the page works as usual |
| (unchanged) | an unknown code, or a suspended, lost, replaced or retired device | the doc 08 §4 lifecycle answers, before any verdict; no owner data |

- Every verdict sits inside the existing public page. None of them changes what the profile shows or hides.

### P-5. Keys [PROPOSED; custody choice is Q2, **PENDING T-1**]
- **Two master keys per key epoch:** one for meta-read, one for file-read.
- **Per-chip keys are derived on demand** (AN10922) and never stored.
- **Each device records its key epoch.** A new production batch or chapter gets a new epoch. A chip cannot be re-keyed without its current key and a writer, so old chips keep their epoch for life.
- **Masters exist only on the server side.** Never in the browser, a log, a test fixture or git. Tests use only NXP's published example vectors.
- **Custody options for production:**
  - (a) host environment secrets: simplest, no cost, as strong as host access;
  - (b) envelope encryption under a cloud KMS, decrypted at start-up: the plaintext master still sits in function memory, but the stored copy is useless without the KMS;
  - (c) an HSM or KMS that computes AES-CMAC itself: strongest, but cost and provider support are unverified.
- **Recommendation:** (a) for local and preview with test-only keys; (b) for production. The owner decides cost and provider (Q2).

### P-6. Personalisation [PROPOSED; **PENDING T-3**]
- **A controlled encoding station,** not a customer tool, does five things:
  1. sets the chip's keys from the epoch masters;
  2. configures SDM: positions, counter on, encrypted PICCData;
  3. writes the NDEF URL;
  4. locks the configuration;
  5. records `(code, UID, epoch)` in a signed manufacturing manifest (doc 08 §5).
- **Who runs it is Q3:** in-house, or a supplier that would then hold the keys.
- **Reconciliation:** the batch's manifest is imported by an admin-only function. Every chip is test-tapped before shipping.

### P-7. Data, migration 036 [PROPOSED; not written]
- **A closed table per device** (RLS on, no policy, service role only, like 029–034): `(device, key_epoch, uid_hmac, last_counter, last_verified_at, failure counts)`.
  - `uid_hmac` is an HMAC of the UID under a server pepper, so the table never holds a raw UID.
- **One server-only function** accepts a counter atomically: it updates only where `last_counter < new` and reports which of the four verdicts applies, race-free.
- **An append-only verification log:** verdict, device and time only. No UID, no address, no parameter values. Retention follows the analytics rule (025).
- **Open dependency:** where the public code lives. Today's `cards` table has no `public_code` (doc 08 proposes one). Q5 decides whether 036 adds it or waits for the device model (M1).

### P-8. Endpoint and switch [PROPOSED; contract v0.10]
- **`POST /api/verify`** (`tap.verify`), with a host switch `VERIFIED_TAP` that is unset (off) by default, like `CONNECT_PUBLIC`.
- **Rate limits** use the trusted visitor digest (B-9, `TRUSTED_CLIENT_IP_HEADER`). Errors use the usual `{ error: { code, message } }`.
- **No parameter value** is ever echoed back.

### P-9. Platforms [INFERRED; **PENDING T-2**]
- **Android** reads NDEF URL tags in the background and opens them.
- **iPhone XS and later** read NDEF URL tags in the background.
- The datasheet's "iOS 11 needs an app" dates from 2019. Background reading should carry the dynamic URL like any other, but **this must be tested on real phones**: at least one current iPhone and two Androids, with the card's metal or transparent construction (doc 08 §7). That is a human test.

### P-10. Legacy and the other pillars
- `/t/<slug>` and every existing card are untouched; legacy NTAG21x cards remain `not_verified`.
- Edition provenance (U4) shows edition and number only after `genuine`.
- Modes (A2) decide what the page shows. The verdict never does.

## 5. Options

| Option | What | For | Against |
|---|---|---|---|
| **A (recommended)** | Build U1 as in §4: local stack first, `VERIFIED_TAP` off, then the release track | The owner's 2026-10-16 decision; pillar A1; no change for legacy cards | Keys, personalisation and phone tests are real work and cost (Q2, Q3) |
| B | `/d/<code>` without SUN: a static code only, no authenticity claim | Cheap; can ship sooner | A copied or rewritten tag cannot be told apart; A1 dropped |
| C | Defer U1 until the device model (M1 `public_code`, `auth_mode`) exists | One model, built once | Delays A1 and A5 |

## 6. Questions for the owner (each with a recommendation)

| # | Question | Recommendation |
|---|---|---|
| Q1 | Option A, B or C? | A |
| Q2 | Key custody for production: (a), (b) or (c) in P-5, and which provider? | (b), provider by cost; test-only keys locally |
| Q3 | Who personalises the chips: in-house station, or a supplier given the keys? | In-house, or a supplier under contract with per-batch epochs |
| Q4 | The verdict wording in P-4 | As drafted. Legal or counsel review of "genuine" (DEC-2026-017) |
| Q5 | Does 036 add `public_code` to `cards`, or wait for the M1 device model? | Add it in 036 (≥ 64-bit, unique, never reused), aligned with doc 08 |
| Q6 | Printed QR on the card back: doc 08 says yes, the 2026-10-18 design says no by default | Card design decides. A QR only ever yields `not_verified` |
| Q7 | Which batch or edition is the first with NTAG 424 DNA, and is the inlay feasible in the metal and transparent cards (doc 08 §3 cost note)? | Ask the card manufacturer before any order |

## 7. Tests the build must pass (the U1 gate, local stack)

1. A fresh tap gives `genuine`, then `already_checked` for the same URL.
2. Higher counters after a lower one: accepted in order; an older one is refused.
3. A copied URL replayed is `already_checked`.
4. A bit flipped in `p` or `m` is `not_confirmed`.
5. The wrong key epoch, or another chip's keys, is `not_confirmed`.
6. A valid MAC with a UID that differs from the registered one is `not_confirmed`.
7. Missing parameters are `not_verified`.
8. An unknown code, and a suspended, lost or replaced device, give the lifecycle answers with no verdict.
9. Counter at 0xFFFFFF behaves as **PENDING T-6**.
10. Two verifies of the same tap at the same moment: exactly one is `genuine` (atomic acceptance).
11. A plain GET consumes no counter.
12. With the switch off, nothing is consumed.
13. Rate limits apply.
14. Canary scans: no UID, key, `p` or `m` value in any response, log or the verification log.
15. NXP's published AN12196 example vectors reproduce exactly. That is OpenCode's crypto core, re-run in this suite.
16. The admin-contract EXECUTE gate shows exactly the new reader's approved roles.

**Not testable here:** real phones (P-9), real chips, KMS. These are human or hosted steps.

## 8. Threat-model inputs (PENDING: ChatGPT's U1 draft via the coordinator)

| # | Topic | Status |
|---|---|---|
| T-1 | Key custody: environment, Vault or KMS; rotation; compromise response | PENDING |
| T-2 | iOS and Android background reading behaviour | PENDING (plus real-phone tests) |
| T-3 | The personalisation workflow and who holds keys | PENDING |
| T-4 | Page wording per verdict | PENDING (owner + counsel, Q4) |
| T-5 | Link previews and prefetch consuming the counter (false `already_checked` for genuine owners) | PENDING. P-3 is Session A's proposed mitigation |
| T-6 | Counter roll-over and chips near end of life | PENDING |
| T-7 | The test-case list (cross-check with §7) | PENDING |

## 9. What approval would unlock, and what it would not

- **Unlocks (local only):**
  - contract v0.10 (`/api/verify`);
  - migration 036 as in P-7;
  - the server function on the local stack with `VERIFIED_TAP` off;
  - OpenCode's crypto core taken after review, and the tests in §7.
- **Does not unlock:**
  - creating real keys;
  - personalising chips;
  - any production or hosted change;
  - any public claim.
- Those need Q2, Q3 and Q7 answered, the release track, and the DEC-2026-018 cool-off.

## 10. References

- NXP AN12196 (NTAG 424 DNA features and hints: SDM, SUN, the session keys).
- NXP AN10922 (symmetric key diversification).
- The NTAG 424 DNA datasheet (NT4H2421Gx).
- RFC 4493 (AES-CMAC).
- Repository: doc 07, doc 08 §2–§7, `M1_SECURITY_MODEL.md` (A1 = authenticated chip, OQ-2), the differentiation plan §4–§6, B-9 (client address), DEC-2026-039 A-1 (host-switch pattern).
