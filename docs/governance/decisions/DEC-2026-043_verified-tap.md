# DEC-2026-043: Verified Tap (SUN at `/d/<code>`; chip MIFARE DESFire EV3 since amendment A-1, was NTAG 424 DNA)

> **Amended 2026-11-11 (A-1, §12).** The owner decided on 2026-11-10: "use desfare only, update it everywhere". The chip is **MIFARE DESFire**, and Verified Tap needs **EV3**. Where §1–§11 say NTAG 424 DNA about AAROH's chip, §12 supersedes them. They stay as written, as the record of what was decided then. Where they cite NTAG 424 DNA documents (AN12196, NT4H2421Gx) for the SUN scheme, they still apply: NXP calls EV3's SUN "compatible with NTAG DNA" (§12.1). The owner approved D-1 to D-4 on 2026-11-12 (§12.7).

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
| State | **APPROVED FOR THE LOCAL BUILD ONLY (2026-10-31), and built locally (§11).** Q2, Q3 and Q7 stay open; real keys, chips and hosting are not approved. History: PROPOSED (draft), ON HOLD for the owner's review. Docs only. Nothing is built, keyed, personalised or deployed. **Owner, 2026-10-25, in session:** "I'll review DEC-2026-043 first. Hold contract v0.10 and migration 036 until I answer Q1-Q7 and the threat model (T-1 to T-7) is folded in." Until both are done, Session A writes no contract v0.11, no migration 037 and no `/api/verify`. **Renumbered 2026-10-26:** Lost mode (U2, DEC-2026-041 A-1) took migration 036 and contract v0.10, so this record now uses 037 and v0.11. The hold is unchanged. **The threat model is folded in (2026-10-25, revision 2):** T-1 to T-7 come from ChatGPT's draft (unverified) and the coordinator's check (§8). Two claims were checked by Session A against vendor documents. Q8 and Q9 are new questions arising from it |

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
- **Per-chip keys.** Each chip's keys are diversified from a master key and a per-chip input (AN10922), so one extracted chip key does not expose any other chip.
- **The usual input, the UID, does not work for the meta-read key** when PICC data is encrypted: the server must decrypt before it knows the UID. The threat model cites AN12196 for this, and an independent SUN decoder documents the same (§10). P-5 states how SHYGON resolves it.
- **The counter** increments on the first read of the file in a session. Later reads in the same session can repeat the same value (threat model, citing the datasheet §9.3; INFERRED). One physical tap can therefore arrive more than once.
- **What the MAC covers.** It covers the configured dynamic range, not necessarily the static host and path before it. A writable NDEF file could be pointed at another site, so P-6 requires write-locking.
- **What a copy can do.** A copied URL or a cloned static tag can replay at most a value that has already been seen. A rewritten tag cannot produce a valid MAC.

## 4. The proposal [PROPOSED]

### P-1. What "verified" means, and what it never means
- **It proves:** the chip holds a key SHYGON issued for that code, and this read is newer than any accepted before.
- **It does not prove:** who holds the card. It never signs anyone in, never unlocks an owner action, never grants access or payment (A0). It adds nothing to what the profile shows.

### P-2. URL and identifiers
- **The URL:** `https://<host>/d/<code>?p=<PICCData, 32 hex>&m=<SDMMAC, 16 hex>`. The parameter names are placeholders, fixed in contract v0.11.
- **`<code>`:** the device's public code, at least 64 bits and unguessable, as in doc 08.
  - Never the card id, which may be sequential.
  - Never the activation code, which is a secret.
- **The UID** is used only inside verification. It is compared with the one registered at personalisation and never returned, logged or shown.

### P-3. The server checks only on request from the page, never on a plain page load
- `GET /d/<code>?p&m` serves the page and checks nothing.
- The page's script then calls `POST /api/verify` with `{ op: 'tap.verify', code, p, m }`, and that call consumes the counter.
- Why: link-preview services and browser prefetch fetch URLs without running scripts (INFERRED; the threat model agrees and cites Slack's and Apple's documentation on preview fetching, not checked here; T-5), so they no longer use up a genuine owner's tap.
- A preview that does run scripts can still consume a counter. That is why P-4 shows a re-used counter as "already checked", never as a fake.
- **Threat model T-5 compared.** It proposes an explicit "Verify tap" button. P-3 solves the same problem without the extra click, and the coordinator agrees. The button remains a fallback if real-phone tests (P-9) show script-running previews consuming counters.
- **Page hygiene on `/d/`** (from the threat model, adopted):
  - `Referrer-Policy: no-referrer` and `Cache-Control: no-store`;
  - after the check, `p` and `m` are removed from the address bar (`history.replaceState`), so a copied address carries no SUN values;
  - no third-party script;
  - no query string in host logs, analytics or traces for `/d/`;
  - generic preview metadata (no per-card title or image);
  - the counter accepted atomically per device (P-7), so a late `n` after `n+1` is calm, never a warning.

### P-4. Verdicts and what the page may say
The wording is a draft for the owner and must follow the claims register.

| Verdict | When | Wording, option 1 (Session A) | Wording, option 2 (threat model) |
|---|---|---|---|
| `genuine` | the MAC is valid and the counter is above the last accepted one | "Genuine SHYGON AAROH" (+ edition and number, U4) | "Verified tap. This card's secure tap was accepted." (+ "No. 037 of 100, Chapter 1") |
| `already_checked` | the MAC is valid but the counter is not higher (a re-opened or shared link, a repeat read in one session, a preview that ran scripts) | "This tap was already checked. Tap the card again to check it." | "We couldn't confirm this tap as new. Please tap the card again." |
| `not_confirmed` | the MAC or decryption fails, or the UID differs from the registered one | "This could not be confirmed as a genuine SHYGON AAROH." | "We couldn't verify this tap. Please tap the card again or contact SHYGON support." |
| `not_verified` | no `p` and `m` (a QR, a typed or shared link, a legacy `/t/` card) | nothing about authenticity; the page works as usual | "This is a SHYGON page opened from an older card or QR link. It isn't a Verified Tap." |
| `unavailable` | the server, the key service or the database cannot decide (an outage, a timeout, after a restore until reconciled) | "Verification is temporarily unavailable." | "Verification is temporarily unavailable. This tap hasn't been marked as verified. Please try again shortly." |
| `needs_service` | the device is at its counter limit, or its key version is retired | "This card needs service. Please contact SHYGON." | (the same) |
| (unchanged) | an unknown code, or a suspended, lost, replaced or retired device | the doc 08 §4 lifecycle answers, before any verdict; no owner data | (the same) |

- **Never "fake" or "counterfeit".** A failure is always worded as "could not confirm" or "could not verify", never as an accusation.
- **Fail closed.** Any doubt gives `unavailable` or `not_confirmed`, never `genuine`.
- **A stolen card still taps as `genuine`.** That is why the page never says "owner verified", or anything about who is holding the card or where. When the owner reports the card lost or stolen, the lifecycle answer replaces every verdict (doc 08 §4, `lost`).
- Every verdict sits inside the existing public page. None of them changes what the profile shows or hides.

### P-5. Keys [PROPOSED; custody is Q2 and diversification is Q8; T-1 folded in]
- **Separate key domains.** Separate master keys by purpose (meta-read and file-read) and by cohort (an edition or chapter, a key epoch). A leak then stays inside one domain.
- **Diversification (Q8):**
  - **D-a (recommended):** both keys diversified by the device's internal id, as doc 08 §2 already prescribes ("derived from KMS master + `device_id`"). The server learns the device id from `/d/<code>` before decrypting anything, so even the meta-read key can be per chip. After decryption, the UID is checked against the record (P-7) and binds the chip to the code.
  - **D-b:** the NXP-typical scheme. One meta-read key per epoch, and only the file-read key diversified by the UID that decryption recovers. It does not need the code first, but every chip in the epoch shares the meta-read key. A leak of it reveals UIDs and counters, but cannot forge a MAC.
- **What the encrypted UID buys.** Under either scheme, `/d/<code>` already names the device in every URL, much like `/t/<slug>` today. The encryption therefore adds integrity (the MAC and the UID binding), but little privacy. The page and the claims must not suggest anonymity.
- **Per-chip keys are derived on demand** (AN10922) and never stored.
- **Each device records its key epoch.** A new production batch or chapter gets a new epoch. A chip cannot be re-keyed without its current key and a writer, so old chips keep their epoch for life.
- **Masters exist only on the server side.** Never in the browser, a log, a test fixture or git. Tests use only NXP's published example vectors.
- **Custody options for production:**
  - (a) host environment secrets: simplest, no cost, as strong as host access;
  - (b) envelope encryption under a cloud KMS, decrypted at start-up: the plaintext master still sits in function memory, but the stored copy is useless without the KMS;
  - (c) an HSM or crypto service that keeps the whole chain inside: strongest. **Checked 2026-10-25:**
    - AWS KMS `GenerateMac` accepts only the HMAC-SHA-2 algorithms [OBSERVED in AWS's API reference], so it cannot compute AES-CMAC; the threat model says the same of Google Cloud KMS (unverified here);
    - AWS Payment Cryptography does generate AES-CMAC (ISO 9797-1 algorithm 5) [OBSERVED in its user guide];
    - SUN also needs AN10922 diversification, the session-key derivation and an AES decryption, all inside the service so no key ever leaves it. That is **unverified**. An NXP MIFARE SAM AV3 is the other candidate the threat model names.
  - **Fallback:** if the whole chain cannot stay inside, (c) degrades to (b).
- **Recommendation:** (a) for local and preview with test-only keys; (b) for production. Re-evaluate (c) only once a provider is shown to keep the whole chain inside. The owner decides cost and provider (Q2).
- **Rotation for sold cards** (threat model, adopted):
  - rotating a master on the server alone breaks every card under it;
  - keep old versions for cards already sold, personalise new cards under a new version, and record each card's version;
  - re-keying a card is a physical session with its old key, or the card is retired.
- **Compromise response:**
  - one card's key: that card is retired (`needs_service`), and no other card is affected;
  - a master: every card in its domain is retired or physically re-keyed, and the incident process (doc 13) runs.

### P-6. Personalisation [PROPOSED; T-3 folded in]
- **A controlled encoding station,** not a customer tool, does six things:
  1. sets the chip's keys from the epoch masters (P-5);
  2. configures SDM to a written configuration record, byte for byte: offsets, counter on, encrypted PICCData, the MAC input range, access rights. AN12196's examples are illustrative only;
  3. writes the NDEF URL;
  4. **write-locks the NDEF file and the configuration.** This is a requirement, because the MAC does not cover the static host (§3);
  5. reads the chip back and verifies one tap end to end;
  6. records `(code, UID, epoch, configuration version)` in a signed manufacturing manifest (doc 08 §5).
- **Who runs it is Q3:** an in-house station, or an audited bureau. A bureau would use a SAM or HSM that derives card keys without exporting the master.
- **Keys reach the station** only through a controlled ceremony or an authenticated encrypted channel, with an expiry. Never by e-mail, chat, spreadsheet, USB or database export. Temporary factory keys are erased afterwards.
- **What the station logs:** batch, edition and serial, key version, station and operator, time, configuration version, the read-back result. The UID is logged only in the protected manufacturing record. Keys, full SUN URLs and the decrypted UID are never logged.
- **Batch validation and release:**
  - every chip decrypts and MACs correctly; its counter advances; an old URL is refused by a staging verifier;
  - the NDEF destination is right, and an unauthorised write fails;
  - the counts reconcile with the manifest;
  - SHYGON samples every batch, keeps a reference set, and destroys rejects;
  - the manifest is imported by an admin-only function.

### P-7. Data, migration 037 [PROPOSED; not written]
- **A closed table per device** (RLS on, no policy, service role only, like 029–034): `(device, key_epoch, uid_hmac, last_counter, last_verified_at, failure counts)`.
  - `uid_hmac` is an HMAC of the UID under a server pepper, so the table never holds a raw UID.
- **One server-only function** accepts a counter atomically: it updates only where `last_counter < new` and reports which of the four verdicts applies, race-free.
- **An append-only verification log:** verdict, device and time only. No UID, no address, no parameter values. Retention follows the analytics rule (025).
- **A database restore rolls the counter back** (threat model): every URL accepted since the backup would verify again.
  - The highest accepted counter per device must therefore also be recorded outside the restore boundary: an append-only external acceptance log (Q2 and the release track decide where).
  - After any restore, verification answers `unavailable` until the two are reconciled.
- **An insider with database access** cannot forge a MAC: no key is in the database. They could, however, change a device's mapping, state or counter.
  - Production writes to these tables go only through the server function. Staff have no write role, and the external acceptance log makes a counter rewind detectable.
- **Lookup order:**
  1. `code` → device (unknown code: the neutral answer);
  2. its key version and keys (D-a: derived from the device id);
  3. decrypt and check the MAC;
  4. compare `uid_hmac` with the decrypted UID;
  5. accept the counter atomically;
  6. the verdict.

  No step reveals to the caller which check failed.
- **Open dependency:** where the public code lives. Today's `cards` table has no `public_code` (doc 08 proposes one). Q5 decides whether 036 adds it or waits for the device model (M1).

### P-8. Endpoint and switch [PROPOSED; contract v0.11]
- **`POST /api/verify`** (`tap.verify`), with a host switch `VERIFIED_TAP` that is unset (off) by default, like `CONNECT_PUBLIC`.
- **Rate limits** use the trusted visitor digest (B-9, `TRUSTED_CLIENT_IP_HEADER`). Errors use the usual `{ error: { code, message } }`.
- **No parameter value** is ever echoed back.

### P-9. Platforms [INFERRED; T-2 folded in; real-phone tests still required]
- **Android** dispatches NDEF web links with no app while NFC is on. What happens depends on the device state and installed apps. The threat model's claims about Android 16 and 17 changes are unverified.
- **iPhone XS and later** read NDEF URL tags in the background with no app. Per the threat model (citing Apple), this is unavailable:
  - while Wallet or Apple Pay, the Camera or another NFC session is active;
  - in Airplane Mode;
  - before the first unlock after a restart.
- **Never promise "any phone" or "a fresh URL on every tap".** The counter is per read session (§3).
- The datasheet's "iOS 11 needs an app" dates from 2019. Background reading should carry the dynamic URL like any other, but **this must be tested on real phones**: at least one current iPhone and two Androids, with the card's metal or transparent construction (doc 08 §7). That is a human test.

### P-10. Legacy and the other pillars
- `/t/<slug>` and every existing card are untouched; legacy NTAG21x cards remain `not_verified`. `/t/` never enters the verdict path.
- **Edition provenance (U4)** shows edition and number only after `genuine`, and only with an authoritative device-to-edition record. It is phrased as a record of the card, never of a person.
- Modes (A2) decide what the page shows. The verdict never does.

### P-11. Limits, stated plainly (threat model, adopted)
- **A copied URL** is a bearer value until it is first verified: whoever opens it first gets `genuine`. Rate limits and P-3 narrow that race; nothing removes it.
- **A live NFC relay** passes verification. The verdict never claims proximity, presence or identity.
- **A stolen card** passes verification until it is reported (P-4).
- **The UID** is never shown, logged, put in analytics, or sent to the browser.
- **MAC comparison** is constant-time, with rate limits per visitor digest and per device, and with alerts on repeated failures. Every failure returns the same shape and similar timing.
- **Counter limit:** the chip's optional SDM read limit stays off unless there is a business reason (Q9). The 24-bit counter allows about 16.7 million reads. At the end comes `needs_service`, never wraparound.

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
| Q4 | The verdict wording in P-4: option 1 ("Genuine SHYGON AAROH") or option 2 ("Verified tap. This card's secure tap was accepted.") | Option 2 for launch: it claims less, needs no counsel sign-off on "genuine", and fits the claims register. Option 1 only after counsel review (DEC-2026-017) |
| Q5 | Does 037 add `public_code` to `cards`, or wait for the M1 device model? | Add it in 037 (≥ 64-bit, unique, never reused), aligned with doc 08 |
| Q6 | Printed QR on the card back: doc 08 says yes, the 2026-10-18 design says no by default | Card design decides. A QR only ever yields `not_verified` |
| Q7 | Which batch or edition is the first with NTAG 424 DNA, and is the inlay feasible in the metal and transparent cards (doc 08 §3 cost note)? | Ask the card manufacturer before any order |
| Q8 (new, revision 2) | Key diversification (P-5): D-a (both keys per chip, by device id) or D-b (meta-read key per epoch, file-read key per chip by UID)? | D-a: it follows doc 08 and leaves no shared key in a cohort. The station must implement the same input exactly (P-6), so confirm it with whoever personalises (Q3) |
| Q9 (new, revision 2) | Turn the chip's SDM read-counter limit on? | Off, unless there is a business reason to cap a card's life |

## 7. Tests the build must pass (the U1 gate, local stack)

Merged with the threat model's 24 cases (T-7). Its numbers are given in brackets.

1. A fresh tap gives `genuine`, then `already_checked` for the same URL [1, 5].
2. Counter gaps are accepted; a lower counter is refused [6, 7].
3. A copied URL replayed is `already_checked`.
4. A bit flipped in `p` or `m`, corrupted ciphertext, or a changed counter with an old MAC is `not_confirmed`, with no detail [2, 3, 4].
5. The wrong key version, another chip's keys, or an unknown key version fails closed. Old cards verify under their old version, new cards under the new one [15, 20].
6. A valid MAC with a UID that differs from the registered one is `not_confirmed` [16].
7. Missing, malformed, wrong-length, duplicate or oversized parameters are refused safely [14]. Missing parameters alone are `not_verified`.
8. An unknown code, and a suspended, lost or replaced device, give the lifecycle answers with no verdict [15].
9. The counter at 0xFFFFFF, and at a set SDM limit, gives `needs_service`, never wraparound [13].
10. Concurrent `n` and `n+1`: serialised and atomic. Exactly one `genuine` per counter, and a late `n` is calm [8].
11. A plain GET, prefetch, refresh, back and forward, and duplicate delivery consume nothing. Preview bots get generic metadata [9, 11, 12].
12. An explicit verify advances the counter exactly once. A retry is idempotent, with calm wording [10].
13. With the switch off, nothing is consumed.
14. A database failure mid-transaction never gives `genuine` and never half-advances the counter [18].
15. After a simulated restore, verification is `unavailable` until reconciled with the external acceptance log [19].
16. A key-service timeout or outage gives `unavailable`, never a positive verdict [23].
17. Rate limits stop invalid-MAC floods without blocking ordinary visitors [22].
18. Canary scans: no UID, key, `p` or `m` value, and no query string, in any response, log, trace, analytics event or referrer [21].
19. The edition line appears only for a valid, new, registered device with a consistent mapping [24].
20. `/t/` never reaches the verdict path [17].
21. NXP's published AN12196 example vectors reproduce exactly (OpenCode's crypto core, re-run in this suite).
22. The admin-contract EXECUTE gate shows exactly the new reader's approved roles.

**Not testable here:** real phones (P-9), real chips, KMS. These are human or hosted steps.

## 8. Threat-model inputs (FOLDED IN, revision 2, 2026-10-25)

**Source:**
- ChatGPT's U1 threat model (GPT-4), pasted by the owner, verbatim and **unverified**;
- the coordinator's check.

Both files are in the coordination worktree: `.claude/worktrees/shygon-os-coordination-8036ce/coordination/GPT-4_result.md` and `2026-10-25_round2-chatgpt-review.md`. Its NXP section numbers are to be verified against the documents.

**Checked by Session A** [OBSERVED in vendor documents, 2026-10-25]:
- AWS KMS `GenerateMac` is HMAC-only;
- AWS Payment Cryptography offers AES-CMAC.

The meta-read-key point is supported by an independent SUN decoder's documentation (secondary source).

| # | Topic | Status | Where |
|---|---|---|---|
| T-1 | Key custody, key domains, rotation, compromise response | Folded in. Recommendation unchanged: (b) for production; (c) narrowed | P-5, Q2, Q8 |
| T-2 | iPhone and Android behaviour | Folded in. Real-phone tests are still a human step | P-9 |
| T-3 | Personalisation workflow, NDEF write lock, logging, batch release | Folded in | P-6, Q3 |
| T-4 | Wording per verdict | Folded in as option 2, plus `unavailable` and `needs_service` | P-4, Q4 |
| T-5 | Previews and prefetch consuming the counter | Folded in. P-3 kept, with the page-hygiene list; the "Verify tap" button kept as a fallback | P-3 |
| T-6 | Counter limit and end of life | Folded in | P-11, Q9, test 9 |
| T-7 | Test cases | Merged: 22 tests covering all 24 of the threat model's | §7 |
| (extra) | Database restore, insider, stolen card, live relay, timing, UID tracking, URL leaks | Folded in | P-4, P-7, P-11 |

## 9. What approval would unlock, and what it would not

- **Unlocks (local only):**
  - contract v0.11 (`/api/verify`);
  - migration 037 as in P-7;
  - the server function on the local stack with `VERIFIED_TAP` off;
  - OpenCode's crypto core taken after review, and the tests in §7.
- **Does not unlock:**
  - creating real keys;
  - personalising chips;
  - any production or hosted change;
  - any public claim.
- Those need Q2, Q3, Q7 and Q8 answered, the release track, and the DEC-2026-018 cool-off.

## 10. References

- NXP AN12196 (NTAG 424 DNA features and hints: SDM, SUN, the session keys).
- NXP AN10922 (symmetric key diversification).
- The NTAG 424 DNA datasheet (NT4H2421Gx).
- RFC 4493 (AES-CMAC).
- [AWS KMS GenerateMac API reference](https://docs.aws.amazon.com/kms/latest/APIReference/API_GenerateMac.html): `MacAlgorithm` accepts only HMAC_SHA_224 / 256 / 384 / 512.
- [AWS Payment Cryptography: Generate MAC](https://docs.aws.amazon.com/payment-cryptography/latest/userguide/generate-mac.html): CMAC (ISO 9797-1 algorithm 5) with AES keys.
- [nfc-sun-decoder](https://github.com/johnnyb/nfc-sun-decoder): a diversified key cannot decrypt the SUN metadata (a secondary source for the meta-read-key point).
- The threat model and the coordinator's check (§8).
- Repository: doc 07, doc 08 §2–§7, `M1_SECURITY_MODEL.md` (A1 = authenticated chip, OQ-2), the differentiation plan §4–§6, B-9 (client address), DEC-2026-039 A-1 (host-switch pattern).

## 11. Local build approved and built (2026-10-31)

**Approval** [OBSERVED in session, 2026-10-31]. The owner answered "Approve local build" to Session A's question, "Approve Verified Tap's local build on my DEC-2026-043 recommendations?". That question proposed the local build only, on these answers:

| # | Answer |
|---|---|
| Q1 | option A |
| Q4 | option 2 ("Verified tap") |
| Q5 | a device public code in 037 |
| Q6 | left to card design |
| Q8 | D-a: both keys diversified by the device id |
| Q9 | counter limit off |
| Q2, Q3, Q7 | **stay open** until the supplier answers (`coordination/GPT-7_result_checked.md`) |

The build uses test-only keys, `VERIFIED_TAP` stays off, and nothing is hosted. The hold recorded in the State row is lifted for the local build only.

**Q5 as built, a deviation the owner should confirm:**
- The public code lives in the closed table `tap_device_auth` (its primary key), **not as a column on `cards`**.
- Why: four frozen admin functions (`admin_get_customer`, `admin_get_order`, `admin_get_tap`, `admin_update_card`) return whole `cards` rows with `to_jsonb(c)`. A new column would silently change the Admin APK's frozen return shapes (doc 12 §2).
- The code row is never deleted (`card_id` is set to null when its card goes), so a code is never reused.
- Moving the code onto `cards` remains possible if the owner prefers. It would need a frozen-contract decision for those four functions.

**Built** (local; readiness report §21):
- **`c466dde`:** OpenCode's crypto core (OC-3, `6c7f8db`), cherry-picked after Session A's review, with `test:sun` 27/27.
- **`037_verified_tap.sql`:**
  - `tap_device_auth`, closed: code, card, key epoch, `uid_hmac`, last counter, retirement;
  - `tap_verify_events`, closed and append-only, with 90-day retention;
  - four service-only functions: register, lookup with rate limits, the atomic result, purge.
- **`/api/verify`** (`netlify/functions/verify.mjs`, `api/verify.mjs`), behind `VERIFIED_TAP`.
- **`test:verified-tap`:** 17 checks.
- **Contract:** AAROH-API v0.11, §10d.

**Settled details:**
- The URL parameters are `e` (PICC data) and `c` (SDMMAC). These replace the `p` / `m` placeholders in P-2 and P-3.
- The MAC input is empty, the AN12196 default. OpenCode's notes record that the padding inside `e` is outside the MAC. That is not malleable: all 128 single-bit flips are refused.
- D-a's input is the 16 bytes of `cards.id`.
- `uid_hmac` = HMAC-SHA256(`VERIFY_UID_PEPPER`, the UID in lowercase hex). The personalisation station must compute it the same way.

**§7 coverage:**

| Tests | Status |
|---|---|
| 1–13, 16–20, 22 | covered by `test:verified-tap` and the gates (RLS matrix 1615, admin-contract, rollbacks) |
| 21 | covered by `test:sun` |
| 14: a database failure part-way through a transaction | **not executable on PGlite** |
| 15: a restore rolling the counter back | **not built.** The external acceptance log waits for Q2 |

**Exception E-1: the secret scan. APPROVED by the owner in session on 2026-11-01 ("Approve E-1"), and applied:** the 14 fingerprints are in `.gitleaksignore` under a comment citing this section.
- **The findings.** gitleaks reports seven `generic-api-key` findings in `netlify/tests/sun.mjs`, at lines 54, 72, 130, 137, 182, 306 and 351. Each is a **published standard test vector**, not a secret:
  - the RFC 4493 §4 example key;
  - AN10922 §2.2.1's example key (twice);
  - AN12196 §3.4.2.2's example ciphertexts (three lines);
  - an AN12196 session-key example.
- **Where they appear.** In commit `c466ddee68d1bcb4a25266e44cfba5af856ac75e` (this branch) and `6c7f8db58f3af5af45c1222bc6ff3681be612981` (`opencode/u1-sun-crypto`).
- **The proposed fix.** The repository's rule (`.gitleaksignore`) needs an APPROVED decision per fingerprint. Proposed: add the 14 fingerprints, `<commit>:netlify/tests/sun.mjs:generic-api-key:<line>` for both commits and all seven lines, under "E-1: published NXP / IETF test vectors".
- **Done.** The fingerprints were added after the owner's approval. `npm run test:secrets` no longer reports them; only the known V6-014 finding remains.

## 12. Amendment A-1 (2026-11-11): the chip is MIFARE DESFire EV3, not NTAG 424 DNA

**The decision** [OBSERVED]:
- **The owner, 2026-11-10:** "use desfare only, update it everywhere".
  - The store session recorded it in `ea13379` on `v6/aaroh-store` (print package and manufacturing hand-off) and relayed it to Session A.
  - It replaces "NTAG 424 DNA" in the owner's 2026-10-16 decision (§2) and answers OQ-2 (DEC-2026-015).
- **In this session, 2026-11-11:** the owner answered "Start DESFire change" to "Start the DESFire change next (amend DEC-2026-043, then a crypto review)?".
- **Unchanged:**
  - Q1 option A, the verdicts and their wording (Q4), D-a (Q8), the counter limit off (Q9);
  - the A0 rule: a tap proves the object, never the person;
  - every legacy path (`/t/`, V5 cards).

**State of this amendment:**
- The chip change itself, and the sweep in §12.6, follow the owner's instruction.
- §12.3 to §12.5 were PROPOSED. The owner **APPROVED D-1 to D-4 on 2026-11-12** (§12.7).
- Nothing is keyed, personalised, ordered or deployed. The release stays BLOCKED.

### 12.1 What NXP's public documents say [OBSERVED 2026-11-11, read from NXP's own PDFs]

| Fact | Source |
|---|---|
| Only EV3 has Secure Dynamic Messaging: "Secure Dynamic Messaging: EV1 No, EV2 No, EV3 Yes". SDM is "a new feature that was introduced with MIFARE DESFire EV3" | MF3D(H)x3 short data sheet Rev 3.1 (2024-01-11), Table 1; AN12752 Rev 1.4 (2023-07-24), §7.5 |
| EV3's SUN is mirrored as text into the NDEF message, "compatible with NTAG DNA" | Short data sheet §2.1.6 |
| SDM sits on a Standard Data File created with SDM enabled (FileOption bit 6). Its settings: mirror offsets for the VCUID, SDMReadCtr, PICCData, the MAC input, encrypted file data and the MAC, plus an SDMReadCtrLimit. Three extra access rights: SDM Meta Read (encrypts the PICCData), SDM File Read and SDM Counter Retrieval. Each takes an application key number, free (0xE) or never (0xF) | AN12752 §5.2 (Table 7), §5.2.1 (Table 8) and its SDM access-rights section |
| A 7-byte UID, with an optional Random ID: a 3-byte random number at anticollision, chosen by SetConfiguration | Short data sheet §7.4 and Table 5 |
| Ciphers: single DES, 2KTDEA, 3KTDEA and AES-128. No LRP is listed for EV3 | Short data sheet Table 1 |
| FormatPICC at PICC level deletes every application and file | Short data sheet Table 5 |
| Memory of 2, 4, 8 or 16 kB; 17 pF (MF3Dx3) or 70 pF (MF3DHx3) input capacitance; sawn wafer, MOA4 or MOA8 | Short data sheet §2 and ordering information |
| Common Criteria EAL5+ (hardware and software); NFC Forum Type 4 Tag certified | Short data sheet §1 and §2.1.6 |
| The SDM details are in the full data sheet, DS4870xx, which NXP issues only through its secure-files portal. Those details are the byte layouts, the session keys and the truncation. AN12753 also cites AN12757 ("MIFARE DESFire EV3 Features and hints"), which was not found in public | AN12752 §8 [1]; AN12753 references |

### 12.2 Crypto review of what is built [Session A, 2026-11-11]

| Built piece | On DESFire EV3 | Change now |
|---|---|---|
| `netlify/lib/sun.mjs`: AES-CMAC (RFC 4493) and AN10922 diversification | AN10922 is NXP's DESFire-family method. The suite's own AN10922 vector diversifies "UID ‖ DESFire AID ‖ system id" | none |
| PICCData decryption (AES-128-CBC, zero IV; tag `0xC7`, UID 7 bytes, counter 3 bytes LSB first); session key from SV2 = `3CC300010080` ‖ UID ‖ counter; truncation to the 8 odd-indexed bytes | **INFERRED identical**: from "compatible with NTAG DNA" and the matching settings and access rights in §12.1. **Not confirmed byte for byte**: the public documents do not give the layouts | none; gates G-1 and G-2 |
| `acceptCounter` and the 24-bit limit `0xFFFFFF` | INFERRED: the read-counter mirror is "LSB first", but its width and its end behaviour are not stated in public | none; G-1 |
| AES only | EV3 offers AES-128 application keys | none. The SDM keys must be AES keys (§12.4) |
| 037 (`tap_device_auth`, `tap_verify_events`, the four functions), `/api/verify`, D-a by `cards.id`, `uid_hmac` | independent of the chip | header comments only |
| 041's possession proof (a server HMAC after a genuine tap) | independent of the chip | a header comment only |
| `test:sun` 27, `test:verified-tap` 17, `test:card-lifecycle` 9 | they prove the AN12196 scheme with NXP's NTAG 424 DNA vectors. No EV3 vector is public | labels only; G-2 adds an EV3 vector |

**Result:** no code change is justified now.
- Verified Tap on EV3 rests on NXP's statement that its SUN is compatible. That remains INFERRED until G-1 and G-2 pass.
- If G-1 finds a difference, it becomes a code change through this decision, with tests first.

### 12.3 Gates before any real key or chip [APPROVED 2026-11-12 as D-4]

- **G-1. The EV3 data sheet.** The adult authorised signatory (F-2), never the founder, obtains DS4870xx under NXP's terms. Alternatively, the personalisation bureau (Q3) confirms it in writing. Then check it against `sun.mjs`, item by item:
  - the PICCData tag byte and layout;
  - CBC with a zero IV;
  - the SV2 constant and its byte order;
  - the MAC truncation;
  - the counter's width, and what happens at `0xFFFFFF` and at a set limit;
  - what the mirrored UID (the VCUID) is when Random ID is on.
- **G-2. A real EV3 known answer.** Personalise one EV3 sample to the configuration record (P-6) with test keys and read it once.
  - Its `e`, `c`, test keys and counter become a fixed vector in `test:sun`.
  - A staging verifier accepts it exactly once.
  - The sample's keys stay test-only. The sample is then kept as a reference or destroyed.
- **G-3. Real phones** (P-9, unchanged). At least one current iPhone and two Androids, with the card's metal or transparent build and the chosen inlay.

### 12.4 What personalisation adds on DESFire (P-6) [APPROVED 2026-11-12 as D-4]

NTAG 424 DNA arrives with its NDEF application and files already in place. A blank DESFire EV3 holds nothing until the station creates it, and it has a card-level master key that NTAG 424 DNA does not have. P-6 therefore adds the following.
1. **Change the PICC master key** from its transport value to a diversified key, in its own key domain (D-a).
   - Why: a card left on the transport key can be formatted (FormatPICC) and rebuilt by anyone with a writer, with the URL pointing anywhere.
   - Such a card cannot produce a valid MAC, but it could send a visitor to another site.
2. **PICC key settings:** creating or deleting an application needs the PICC master key. Formatting is turned off if the configuration offers it (G-1 confirms the option).
3. **One AAROH application** holds the NFC Forum Type 4 NDEF structure: the capability container and the NDEF file.
   - It has AES-128 keys only.
   - The NDEF file is created with SDM enabled.
   - SDM Meta Read and SDM File Read use separate application keys (the P-5 key domains).
   - SDM Counter Retrieval needs a key; it is never free.
4. **Write lock:** the NDEF file's Write and ChangeAccessRights rights go to a server-held key or to never, so no customer tool can rewrite the URL. This is P-6 step 4 in DESFire terms.
5. **Random ID off** for V01 (D-3), unless G-1 shows that SDM still mirrors the real UID.
6. **Batch validation adds three checks:** an unauthenticated FormatPICC fails, an unauthenticated CreateApplication fails, and an unauthenticated NDEF write fails.

The configuration record (P-6 step 2) is written byte for byte against DS4870xx (G-1).

### 12.5 Questions for the owner [APPROVED 2026-11-12, §12.7]

| # | Question | Recommendation |
|---|---|---|
| D-1 | Which DESFire generation? | **EV3.** It is the only generation NXP documents with SDM. On EV1 or EV2, AAROH falls back to option B: a static `/d/<code>` with no authenticity claim. A later generation only once its data sheet shows SDM |
| D-2 | Memory and capacitance? | **2 kB**, unless a second application (doc 08's Phase 5 door access) should share the chip; then 4 kB. 17 pF or 70 pF is the inlay maker's antenna choice for the metal and transparent builds (Q7). The adult signatory confirms both with the inlay maker |
| D-3 | Random ID? | **Off** for V01 |
| D-4 | Adopt G-1 to G-3 and §12.4 as conditions before any real key or chip? | **Yes** |

Q2 (key custody), Q3 (who personalises) and Q7 (inlay feasibility) stay open, now on EV3 terms. For Q3, a bureau that already personalises EV3 with SDM, or a station built on an NXP MIFARE SAM AV3 (P-5), fits best.

### 12.6 What this amendment changed in the repository

- **Labels and comments only. No logic, SQL statement, schema or API shape changed:**
  - `netlify/lib/sun.mjs` and `netlify/functions/verify.mjs`;
  - the three test suites' headers;
  - the header comments of 037 and 041, and `APPLY_ALL.sql` rebuilt from them.
- **Documents:**
  - contract AAROH-API **v0.15.1** (wording only, with a CHANGELOG row);
  - the capability matrix, the differentiation plan and the U1 crypto notes;
  - the backlog (V6-127, and V6-133 for these gates);
  - `docs/DECISIONS.md` (DEC-2026-015 answered; this amendment);
  - SHYGON OS docs 00, 01, 02, 04, 07, 08 (the chip table reworked) and 11;
  - the migrations README;
  - readiness report §27.
- **Left to their owners, and told:**
  - Session B: `e2e/verified-tap.spec.ts`, `frontend-audit.md`.
  - The coordinator (`coord/v01-scope`): `docs/shygon-os/v01/` (the inventory's Verified Tap row, risk R-16, the technical architecture's chip line).
  - The store session already changed the print package (`ea13379`).
- **Not changed:** NTAG21x mentions (V5's legacy cards), and the competitor research that names NTAG 424 DNA.

### 12.7 Approval of D-1 to D-4 (2026-11-12) [OBSERVED in session]

The owner answered "Approve D-1 to D-4" to Session A's question, "Approve D-1 to D-4 (EV3, 2 kB, Random ID off, adopt the gates)?".

| # | Answer |
|---|---|
| D-1 | **MIFARE DESFire EV3** |
| D-2 | **2 kB.** The adult signatory still confirms two things with the inlay maker (Q7): the input capacitance (17 pF or 70 pF) and whether the metal and transparent builds can carry the inlay. A second application on the chip (doc 08's Phase 5) would need a new decision and more memory |
| D-3 | **Random ID off** |
| D-4 | **G-1 to G-3 and §12.4 are conditions** before any real key or chip |

**What this unlocks:** nothing physical. It fixes two things:
- what the adult signatory asks the inlay maker and the personalisation bureau for: EV3, 2 kB, SDM, and the §12.4 configuration;
- what must pass before any key or chip exists.

**Still open:**
- Q2 (key custody), Q3 (who personalises) and Q7 (inlay fit);
- G-1 to G-3.

No order, key, personalisation or hosting is approved. The release stays BLOCKED.
