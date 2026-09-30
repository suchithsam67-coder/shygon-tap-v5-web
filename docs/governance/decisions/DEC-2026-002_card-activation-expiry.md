# DEC-2026-002 — Should a card stop working 14 days after activation? (OQ-1)

| Field | Value |
|---|---|
| Domain / Level | Product / **L2** (changes physical-card behaviour → treat as irreversible, doc 13 §3.3) |
| **Accountable Owner** | Product Owner |
| Consulted | Data Owner, Security Owner, Principal Architect |
| State | PROPOSED — **blocks M1.1 lifecycle work** |
| Priority | I2 U2 Irr1 R2 = 7 → P1 · matrix P1 · **Final P1** (→ P0 if paying customers' cards are being auto-suspended) |

**Evidence (OBSERVED):** LIVE_SUPABASE_STATE.md — live `customer_activate_card` sets `activation_expires_at = now()+14 days`; `expire_tap_cards()` suspends expired cards; the doc itself flags this as "worth reviewing". The repo has no source for these live functions (drift F6).
**HYPOTHESIZED:** it was conflated with the 14-day *edit* interval.

**Option A — activation never expires** (card works until suspended/replaced). Simple; matches the "buy once" promise (V5_COMPLETE.md).
**Option B — keep a 14-day activation window with renewal.** Needs renewal UX, notifications and support; risk of silently dead cards.
**Option C — expiry as a paid-plan feature** (e.g., event badges expire at event end). Belongs to device kinds, not personal cards.

**Until decided:** Claude Code keeps current live behaviour behind the config `card_activation_expiry_days` (value = live behaviour) and must **not** change it (doc 12 §0 rule 11).
**Decision:** ________ **Approved by:** ________
