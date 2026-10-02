# DEC-2026-001: Potential credential exposure (SEC-1): Supabase service-role key and Razorpay secrets

> Repository copy of the pack's seeded record. The unchanged original is `docs/shygon-os/templates/decisions/DEC-2026-001_credential-exposure-rotation.md`.
> Updated 2026-09-30 with the repository owner's triage instruction and the metadata observed during the M0.0 session.
> **No secret value appears in this record, and none may ever be added.** That rule also covers chat, git, docs, CI logs, issue trackers and commit messages.

| Field | Value |
|---|---|
| Decision ID | DEC-2026-001 |
| Domain / Level | Security / **L3** |
| **Accountable Owner** | Security Owner: **UNASSIGNED — HUMAN ACTION REQUIRED** (OQ-16 / DEC-2026-018) |
| Consulted | Data Owner (DB contents) and Release Owner (env update + redeploy). Both UNASSIGNED. |
| State | **OPEN — HUMAN ACTION REQUIRED** |
| Priority | **P0 triage (provisional)** until the exposure history is established. The pack's classification was I3 U3 Irr1 R2 = 9 → P1 · matrix P0 · Final P1 (doc 13 §1.1). See the priority change below. |
| Deadline | Immediate |
| Credential rotation | **NOT DONE.** Assume this until a human explicitly confirms otherwise. |
| doc 12 §2A gate ("any work at all") | **WAIVED FOR M0.3 ONLY** by the repository owner, 2026-10-02, in session. See "Waiver" below. Rotation remains required. |
| Production data | **UNKNOWN — HUMAN CONFIRMATION REQUIRED.** It has not been inspected, and must not be inspected just to answer this question. |

## Priority change (G§76)

| Previous | New | Evidence | Reason | Directed by | Time |
|---|---|---|---|---|---|
| P1 (pack, doc 13 §1.1) | P0 triage (provisional) | OBSERVED: a ZIP in the project root has a `.env` entry | The exposure history is not established; treat as P0 until it is (G§19) | Repository owner (session instruction) | 2026-09-30 |

## Question
Rotate the Supabase service-role credential and the Razorpay secrets, and establish whether any credential-bearing archive ever left the local machine.

## Evidence
Labels: OBSERVED / HYPOTHESIZED / CONFIRMED (G§67).

**OBSERVED (pack, 2026-09-29)**
- PRODUCTION.md §8.3: an earlier version of that file held the Razorpay key secret in plaintext, and `.env` was "distributed inside the project ZIPs".
- TEST_REPORT.md §2.1: a live-project service-role key was installed in the local `.env`, and a `.env.bak-*` copy was kept.
- The ZIP audited on 2026-09-29 contained no secrets.

**OBSERVED (Claude Code session b1fac27f-3d40-49cc-ab76-f2750f9eb560, 2026-09-30, metadata only)**
1. `.claude (2).zip` (134,906,145 bytes) is in the project root. Its entry list includes `.env`. **The `.env` inside the ZIP was not opened.**
2. The ZIP's file-system times are created 2026-09-02 22:21 and last written 2026-09-02 22:22 (local time).
3. The ZIP has no Mark-of-the-Web (Zone.Identifier) stream. This does not prove it was never uploaded or shared.
4. The project folder is outside the OneDrive sync root, and "Documents" is not redirected to OneDrive. No Dropbox or Google Drive client was found.
5. The folder was not a git repository before 2026-09-30. The local repository created that day excludes `.env`, `.env.*` (except `.env.example`) and `*.zip`. It has no remote and nothing has been pushed.
6. The working-tree `.env` has never been committed. It defines a Supabase service-role key variable plus Razorpay key-secret and webhook-secret variables. The Razorpay key id has the test-mode prefix. Only variable names and value shapes were read.
7. The parent folder `shygon tech/` contains 14 other project ZIPs. Their contents were not inspected.
8. gitleaks 8.30.1 found no Supabase or Razorpay secret in any tracked file of the baseline commit. It had one unrelated finding (see DEC-2026-020).
9. No `.env.bak-*` file exists in the working tree.

**HYPOTHESIZED**
- None about sharing. The " (2)" in the file name is **not** evidence that the ZIP was shared (owner instruction).

**UNKNOWN — HUMAN CONFIRMATION REQUIRED**
- Did this ZIP, or any other ZIP containing `.env`, leave the local machine: uploaded, shared, emailed, committed elsewhere, or put on a shared drive?
- Has a production/live credential ever been in a ZIP? That means the live project's Supabase service-role key or an `rzp_live_` Razorpay secret.
- Has the Supabase service-role credential been rotated since 12 Sep 2026?
- Does production hold real customer data?

## Required human actions (HUMAN ACTION REQUIRED; Claude Code performs none of these)
1. Rotate the Supabase service-role credential.
2. Rotate any Razorpay credentials that may have been exposed: the key secret and the webhook secret.
3. Determine whether any production/live credential has ever existed in the ZIP. Check the other project ZIPs in `shygon tech/` too.
4. Review the relevant provider access/audit logs where available (Supabase, Razorpay).
5. Move the ZIP out of the repository/project working directory into controlled private storage.
6. Preserve the original artifact if it is needed as evidence, but do not inspect or redistribute its secrets.

After rotating (PB-4):
- Update the Netlify, Vercel and Supabase Edge secrets, then redeploy.
- Verify with a test-mode payment, a webhook signature test and an OTP test.
- Confirm the old keys are revoked.

## Escalation to a confirmed P0 (doc 13 §1.1)
Any one of these confirms a P0:
- a ZIP containing `.env` was shared outside owner control;
- a live Razorpay key is unrotated;
- production holds customer data and the service-role key is unrotated;
- there is unexplained activity in the Supabase or Razorpay logs.

## Options (from the pack)
**Option A: rotate now (recommended).**
- Benefits: closes the exposure whatever its scope.
- Risks: a brief checkout/webhook outage if an env update is missed. Mitigation: update the Netlify, Vercel and Supabase Edge secrets, redeploy, then test the payment path in test mode.
- Cost: about 1 hour.
- Reversibility: n/a (new keys).

**Option B: investigate first, rotate only if exposure is confirmed.**
- Benefits: no change effort.
- Risks: the exposure continues while investigating.
- Reversibility: poor if the key is misused.

## Waiver of the doc 12 §2A rotation gate (2026-10-02)
| Field | Value |
|---|---|
| What is waived | Only the doc 12 §2A first row ("Any work at all — blocked until DEC-2026-001 rotation completed"), and only for milestone **M0.3**, as scoped in `docs/shygon-os/M0_3_IMPLEMENTATION_SCOPE.md` |
| Waived by | Repository owner, in session, 2026-10-02 |
| What is NOT waived | **Rotation itself:** it remains required and NOT DONE, and this record stays OPEN. **G-PAY:** live payments still need rotation done (M1 plan §34). M0.4 onward, M1, any production migration apply, any deployment, and the G2 launch gate. |
| Conditions | 1. Live payments stay OFF (Razorpay test mode only; no `rzp_live_`). 2. No credential from `.env`, `.env.*` or any ZIP is read, loaded or used. All work runs on local PGlite and on clean clones without `.env`. 3. No production access, migration apply or deployment by Claude Code. 4. Nothing produced in M0.3 is applied to production until the owner has rotated, or explicitly extends this waiver in writing. |
| Expires | When M0.3 is reported complete, or earlier if the owner withdraws it |
| Risk accepted | Development continues while the exposure history of `.claude (2).zip` and the other project ZIPs is unestablished. M0.3 adds no new use of any credential. |

## Decision
- **Decision:** ________ (HUMAN ACTION REQUIRED)
- **Approved by:** ________
- **Rotation completed (date, by whom, which credentials; no values):** ________
- **Verification evidence:** ________
