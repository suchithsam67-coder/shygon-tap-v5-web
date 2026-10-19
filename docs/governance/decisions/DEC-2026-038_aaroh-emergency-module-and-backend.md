# DEC-2026-038: SHYGON AAROH emergency module, Tap column guard, and the open AAROH backend questions

| Field | Value |
|---|---|
| Decision ID | DEC-2026-038 |
| Title | Emergency contacts and alerts (029); Tap column guard (030); Return-to-Owner relay (031); provider, visitor alerts, Emergency Profile, modes, Privé, Connect/Verify order |
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

### Added 2026-10-19, after the owner's master requirements and backend brief (same day)

**Q11. Emergency Profile / Emergency Tap: what is it?** The sources disagree, and the master requirement says "do not silently invent emergency behaviour":
- doc 04 §4.1: a responder deliberately triggers a purpose-bound **release** of an owner-approved emergency payload, default off, rate-limited, with owner notification and audit;
- doc 07 T18: relay a callback rather than reveal numbers; no medical data;
- showroom: "emergency details that you approve, shown only in an emergency flow".

Built so far: 1a (owner SOS) and 1b (a visitor alert relay, off). **No information view exists.**

Options:
- A: none beyond 1b.
- **B (recommended):** a view showing only owner-approved, non-contact fields (for example a first name and "has emergency contacts on SHYGON — alert them"), with alerting through the 1b relay. No number ever shown.
- C: specify other fields.

A public page that shows contact numbers to anyone who taps is excluded by every source.

**Q12. Return-to-Owner relay as built** (migration 031, `/api/rescue`, `test:rescue` 18/18). It follows doc 03/05/07 (T6):
- owner opt-in;
- the finder token is stored as a hash;
- links are stripped;
- the limits are doc 05's;
- auto-quiesce after 3 unanswered messages;
- block and report; no message text in notifications;
- 90-day retention;
- host switch `RESCUE_RELAY` (off).

Options:
- **A (recommended):** approve, and turn the switch on with the first production release that includes it.
- B: approve with changes.
- C: hold.

Not built: the lost or found item lifecycle (card registry), a bot check (no Turnstile key), and a text to the owner (unverified phone, F4).

**Q13. Order for Connect and Verify.** The master requirements list "real consent and connection flows" and "real verification" as required behaviour. The architecture designs them (doc 03 `connections`, `consent_grants`, `credentials`, `verification_records`). They depend on organisations (DEC-2026-025), and DEC-037 says an AAROH card is not a credential. The owner's 2026-10-16 order puts them after Return-to-Owner.

Options:
- **A (recommended):** next stage = the consent ledger (`consent_grants`) plus Connect requests, decisions and revocations. Verify waits for issuers.
- B: another order.

**Q6 update.** Three briefs on 2026-10-19 ask for a demo-only Privé, against the 2026-10-16 "outside the launch scope". **The recommendation changes to A (demo-only) if the owner confirms.** Session A will not build it until then.

## Decision

Q1 ____ Q2 ____ Q3 ____ Q4 ____ Q5 ____ Q6 ____ Q7 ____ Q8 ____ Q9 ____ Q10 ____ Q11 ____ Q12 ____ Q13 ____

**Approved by:** ________ **Date:** ________

## Expected result vs observed result

To be filled at verification. Expected: the decided options hold on a fresh clone (`npm run ci`) and, after the DEC-2026-018 review, on production with the VERIFY ON LIVE queries in 029/030.
