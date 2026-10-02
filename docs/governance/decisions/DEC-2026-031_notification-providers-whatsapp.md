# DEC-2026-031: Notification providers, including the new WhatsApp channel

| Field | Value |
|---|---|
| Domain / Level | Architecture (provider choice, doc 13 §3.1) / L2; Data consulted (DPDP processors) |
| **Accountable Owner** | Principal Architect: **UNASSIGNED — HUMAN ACTION REQUIRED** |
| Consulted | Security Owner, Data Owner, Product Owner (cost), Release Owner |
| State | **PROPOSED — HUMAN DECISION REQUIRED** |
| Priority | I1 U1 Irr1 R1 = 4 → P2 · matrix P2 · **P2** · deadline 2026-10-16, and before M1.6 |
| Extends | OQ-8 (email provider) |

**Question:**
1. Which email provider? (OQ-8 recommends Amazon SES ap-south-1.)
2. Is **WhatsApp**, which is in the owner brief but not in doc 06, a SHYGON OS channel? If so, via which provider?
3. When does push arrive? (Doc 06: Phase 5.)

**Evidence (OBSERVED):**
- **In-app:** exists (`notifications` + realtime).
- **SMS:** exists (`netlify/lib/sms.mjs`: MSG91 or Twilio; DLT templates in India).
- **Admin push:** exists (Expo tokens).
- **Email:** none.
- **WhatsApp:** none. It needs the WhatsApp Business Platform: approved message templates, user opt-in, a business verification, per-conversation cost and a data processor agreement.

**Options:**
- **Email:** A) SES · B) Resend · C) other.
- **WhatsApp:**
  - A) defer to a later milestone (interface ready, no adapter);
  - B) adopt via a provider such as Twilio (already integrated for SMS) or MSG91 WhatsApp, for opted-in security and transactional categories only.
- **For every option:**
  - provider adapters behind `NotificationProvider`;
  - bodies carry no private data;
  - security categories are locked on;
  - cost circuit-breaker.

**Decision:** ________ **Approved by:** ________ **Date:** ________
