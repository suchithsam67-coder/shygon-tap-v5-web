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
| State | **PROPOSED (draft), ON HOLD for the owner's review.** Docs only. Nothing is built, keyed, personalised or deployed. **Owner, 2026-10-25, in session:** "I'll review DEC-2026-043 first. Hold contract v0.10 and migration 036 until I answer Q1-Q7 and the threat model (T-1 to T-7) is folded in." Until both are done, Session A writes no contract v0.10, no migration 036 and no `/api/verify`. **The threat model is folded in (2026-10-25, revision 2):** T-1 to T-7 come from ChatGPT's draft (unverified) and the coordinator's check (§8). Two claims were checked by Session A against vendor documents. Q8 and Q9 are new questions arising from it |

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
- **The URL:** `https://<host>/d/<code>?p=<PICCData, 32 hex>&m=<SDMMAC, 16 hex>`. The parameter names are placeholders, fixed in contract v0.10.
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

### P-7. Data, migration 036 [PROPOSED; not written]
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

### P-8. Endpoint and switch [PROPOSED; contract v0.10]
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
| Q5 | Does 036 add `public_code` to `cards`, or wait for the M1 device model? | Add it in 036 (≥ 64-bit, unique, never reused), aligned with doc 08 |
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
  - contract v0.10 (`/api/verify`);
  - migration 036 as in P-7;
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
