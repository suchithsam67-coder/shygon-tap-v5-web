# DEC-2026-001 — Rotate possibly exposed Supabase service-role key and Razorpay secrets

| Field | Value |
|---|---|
| Domain / Level | Security / **L3** |
| **Accountable Owner** | Security Owner (to be named; the Founder holds it until then) |
| Consulted | Data Owner (DB contents), Release Owner (env update + redeploy) |
| State | PROPOSED |
| Priority | I3 U3 Irr1 R2 = 9 → P1 · matrix P0 · **Final P1** (reason: no customer data on last evidence, no misuse evidence, owner-controlled distribution). **Escalate to P0** on any trigger in doc 13 §1.1. |
| Deadline | Today |

**Question:** Rotate the Supabase service-role/secret key, the Razorpay key secret and the Razorpay webhook secret now?

**Evidence (OBSERVED):** PRODUCTION.md §8.3 (Razorpay secret in plaintext in an earlier file version; `.env` distributed in project ZIPs). TEST_REPORT.md §2.1 (live service-role key installed in local `.env`; `.env.bak-*` kept). The 2026-09-29 ZIP contains no secrets.
**UNKNOWN:** who received earlier ZIPs; whether the Razorpay key was live or test; current production data volume; whether rotation already happened.

**Option A — rotate now (recommended).** Benefits: closes the exposure regardless of scope. Risks: brief checkout/webhook outage if env updates are missed (mitigated: update Netlify + Vercel + Supabase Edge secrets, redeploy, then test the payment path in test mode). Cost: ~1 hour. Reversibility: n/a (new keys).
**Option B — investigate first, rotate if exposure confirmed.** Benefits: no change effort. Risks: continued exposure while investigating. Reversibility: poor if the key is misused.

**Decision:** ________ **Approved by:** ________ **Verification:** payment test-mode order + webhook signature test + OTP test pass after rotation; old keys confirmed revoked.
