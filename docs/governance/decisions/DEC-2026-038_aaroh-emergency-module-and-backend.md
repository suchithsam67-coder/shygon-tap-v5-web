# DEC-2026-038: SHYGON AAROH emergency module, Tap column guard, and the open AAROH backend questions

| Field | Value |
|---|---|
| Decision ID | DEC-2026-038 |
| Title | Emergency contacts and alerts (migration 029); Tap column guard (030); provider, visitor alerts, modes, Privé |
| Date opened | 2026-10-19 |
| Domain | Product / Security / Data |
| Level | L3 (new tables holding third-party personal data; privileged functions; an authorization trigger) |
| **Accountable Owner (A)** | Repository owner (DEC-2026-018 Option B, one-person model) |
| Responsible (R) | Session A (AAROH backend), Claude Code: implementation and evidence only |
| Consulted (C) | Security Owner, Data Owner (the same person under DEC-018); counsel for Q9 (DEC-2026-017) |
| Informed (I) | Session B (AAROH frontend), the stabilisation session |
| State | **PROPOSED: HUMAN DECISION REQUIRED.** Implemented locally on `v6/aaroh-backend` so the decision can be taken on working, tested code. Nothing is applied, pushed or deployed |

## Priority

| Impact | Urgency | Irreversibility | Risk | Score | Final P |
|---|---|---|---|---|---|
| 3 | 1 | 2 | 3 | 9 | **P1**: decide before any production use of 029/030, and before the frontend ships an emergency control |

Decision deadline: 2026-10-21 (P1, 2 business days). Q6 (Privé) and Q7 (modes) can follow at P2.

## Question

The owner's AAROH backend brief of 2026-10-19 asks for a real emergency-contact system. Earlier records keep that work out of the current scope:
- the showroom lists "Emergency information" as Planned ("nothing like it is stored today");
- doc 10 puts emergency contact-only data in Phase 2;
- doc 07 rates emergency-data abuse High (T18).

Session A built it locally, to the threat model in docs 03, 04, 05 and 07. Which parts does the owner approve, and on which terms?

## Context and evidence

**OBSERVED** (local stack, `v6/aaroh-backend`):
- `npm run test:emergency` 43/43 (44 with the host-switch check);
- `test:rls-matrix` 1137/1137 (39 tables × 7 callers);
- `test:admin-contract` 15/15, which lists 029's relations and RPC as **PROPOSED, NOT APPROVED**;
- `test:db` and every existing suite green (`docs/v6/aaroh/backend-audit.md` §9).

**OBSERVED** (repository): SMS exists through MSG91 or Twilio (`netlify/lib/sms.mjs`); neither is configured on any host. DEC-2026-031 (providers) is PROPOSED.

**CONFIRMED** (locally, with a negative control): AB-1, AB-2 and AB-3. A Tap owner can clear `last_content_edit_at`, skipping the paid 14-day edit window. The owner can also write a reserved first address directly, and set server-managed columns. Production is **UNVERIFIED**: its `enforce_tap_edit_rules` body differs (V6-106 F-4). Production has 0 Taps (A14, 2026-10-18), so there is no exposure today.

**HYPOTHESIZED:** none relied on.

## Questions and options

**Q1. The emergency module (029) as built:**
- owner-initiated alerts by SMS to the owner's **verified** contacts;
- contact verification by a code the contact receives;
- tables closed to every client;
- every limit and retention period as in 029's header.

Options:
- **A (recommended):** approve as built.
- B: approve with changes (state them).
- C: hold. 029 moves to `supabase/proposed/`, like 027, and the frontend shows Planned.

**Q2. Visitor-initiated alerts** (a visitor on `/t/<slug>` alerts the owner's contacts; relay only). They are:
- owner opt-in, default off, with an acknowledgement;
- capped at 3 per owner per day, one per Tap per 15 minutes, one per visitor per Tap per day, and 50 per hour platform-wide;
- reported to the owner in-app every time; a reported alert turns them off.

They are additionally gated by the host switch `EMERGENCY_PUBLIC_ALERTS=on`, which is unset, so off everywhere.

Options:
- A: approve for production.
- **B (recommended):** keep it off (switch unset) until real-world owner alerts have run under supervision; decide again then.
- C: remove the code path.

The residual risk is unwanted alerts to the owner's contacts, bounded by the caps. No contact detail is ever revealed to the visitor.

**Q3. Provider for emergency SMS.**
- **A (recommended):** MSG91, with three DLT templates (`docs/v6/aaroh/provider-requirements.md` §3). India delivery is the compliant route. Its delivery receipts are not implemented, so statuses stay "sent".
- B: Twilio, with India DLT sender registration. Signed delivery receipts are already implemented.
- C: another provider, which needs an adapter.

This extends DEC-2026-031.

**Q4. A suspended account and owner alerts.**
- **A (recommended):** allow. Suspension moderates public content; an owner's alert to contacts who consented by verifying is a safety function. Visitor alerts already stop for a suspended account.
- B: refuse.

**Q5. Migration 030** (refuse client writes to `slug, username, last_content_edit_at, edit_window_started_at, provisioned_at, published_at, card_id, ui_plan_id`).
- **A (recommended):** approve. It is independent of 029 and can join the 020 + 028 early-fix track (DEC-2026-003 §3.1 conditions).
- B: reject.

**Q6. SHYGON Privé: conflicting instructions.**
- 2026-10-16: "Privé: outside the launch scope", removed from the store (DEC-2026-037 terms, relayed).
- 2026-10-19 brief: "SHYGON Privé should contain demo hotels and simulated guest-service workflows for this release."

Options:
- A: demo-only Privé for this release. Session A designs a `demo_*` schema clearly separated from production data; no hotel, PMS, booking or access-control integration.
- **B (recommended until clarified):** the 2026-10-16 decision stands; Privé stays out.

**Q7. Modes.** The owner's order is "Business and Info first, then Return-to-Owner". The schema has no mode entity, and "Info" is defined nowhere.
- A: one public profile per account stays the Business mode; Info is defined by the owner next.
- B: Session A proposes a `tap_modes` model (per-Tap mode list and visibility) for review.
- **A, then B, is recommended.**

**Q8. Contact numbers at rest.**
- **A (recommended for v1):** plain text in closed tables. RLS is on with no policies and no client grant; numbers are erased from alerts 7 days after completion; the database disk is encrypted by the host.
- B: application-level encryption (key outside the database, Supabase Vault or KMS), before launch.

Doc 03 proposed encryption for `sensitive_profile_data`.

**Q9. DPDP Act: contacts are third parties.**
- Consent is captured by the verification text, which names the owner and lets them ignore it.
- Retention is as in Q1.
- The Privacy Policy needs an emergency-contacts section (V6-074).

Counsel review is DEC-2026-017. **HUMAN ACTION REQUIRED.**

**Q10. Showroom copy.** If Q1 is approved, the "Emergency information" entry changes from Planned to available. Its wording ("nothing like it is stored today") is then false and must change.

Options:
- **A (recommended):** the owner approves the new copy.
- B: keep the feature hidden in the store.

## Decision

Q1 ____ Q2 ____ Q3 ____ Q4 ____ Q5 ____ Q6 ____ Q7 ____ Q8 ____ Q9 ____ Q10 ____

**Approved by:** ________ **Date:** ________

## Expected result vs observed result

To be filled at verification. Expected: the decided options hold on a fresh clone (`npm run ci`) and, after the DEC-2026-018 review, on production with the VERIFY ON LIVE queries in 029/030.
