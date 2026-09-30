# DEC-2026-022: M0.3 scope conflict (F1 + F3 + F4 vs F1 + F2)

> G§11 decision record (template: `docs/governance/DECISION_RECORD.md`). Written because two instructions conflict materially (doc 12 §0 rules 8 and 11; G§69–70).
> **Claude Code has not chosen between the positions, and has implemented neither.** Until this is decided, F1, F3 and F4 are verify-only: no RLS, auth or card-routing change, no `/d/:code`, no `tap_routes`, no verified-contact redesign (owner instruction, 2026-09-30).

| Field | Value |
|---|---|
| Decision ID | DEC-2026-022 |
| Title | What does milestone M0.3 contain? |
| Date opened | 2026-09-30 |
| Domain | Architecture / Product (scope) / Security |
| Level | **L3**. It sets the order of security remediation and may change behaviour visible on physical cards, which doc 13 §3.3 treats as irreversible. |
| Original owner | UNASSIGNED |
| Escalated to | — |
| **Accountable Owner (A)** | **UNASSIGNED — HUMAN ACTION REQUIRED.** The Founder names the single A. Doc 12 §0 rule 11 routes architecture ambiguity to the Principal Architect; scope and priority are a Product Owner decision type (doc 13 §3.1). |
| Did accountability change on escalation? (G§2.3) | No |
| Responsible (R) | Claude Code (implements the chosen scope after approval) |
| Consulted (C) | Security Owner (F1/F4 are RLS/auth, L3); Product Owner (card semantics); Data Owner (baseline). All UNASSIGNED. |
| Informed (I) | QA Owner, Release Owner (UNASSIGNED) |
| State | **OPEN — HUMAN DECISION REQUIRED** |

## Priority (G§13–15)
| Impact 0–3 | Urgency 0–3 | Irreversibility 0–3 | Risk 0–3 | Score | Score → P | Matrix → P | **Final P** |
|---|---|---|---|---|---|---|---|
| 2 | 2 | 2 | 2 | 8 | P1 | P1 | **P1** |

Decision deadline: 2026-10-02 (P1 ≤ 2 business days, using the doc 13 §4 / GAP-4 proposal; 2026-10-02 is a public holiday in India).
In practice it is needed before M0.3 starts. M0.3 is also blocked by M0.2 (no live schema baseline yet).

## Question
Which findings does M0.3 remediate, and in what form?

## Context & evidence (OBSERVED: what each source says)

| Source | M0.3 scope | F2 | F3 | F4 |
|---|---|---|---|---|
| **Position A: the owner's "M0.2 → M0.3 Implementation Specification" (2026-09-30)** | F1 + F3 + F4 (§3, §5–§10) | Not automatic. Secondary finding, goes to `SECURITY_REMEDIATION_BACKLOG.md` (§11) | Verify, then implement "only the approved minimal fix". Do not build the full `/d/:code` / `tap_routes` architecture unless separately approved (§7). `/t/:slug` behaviour changes only if explicitly approved in M0.3 (§2). | Verify, then design a "secure factor-binding strategy" with its own test list (§9–§10) |
| **Position B: the approved pack, doc 12 §3** | M0.3 = "Close verified findings F1, F2" (migrations `020` F1 guard triggers, `021` admin notes table) | In M0.3 | **M1.2** "Resolver & routes (fixes F3)": `resolve_tap()`, `tap_routes`, `/d/:code`. Its acceptance says "F3 test (card suspended ⇒ device URL unavailable) passes; `/t/<slug>` unchanged". | **M1.3** "Verified contacts & step-up (fixes F4)": `contact_methods`, a generalised OTP service, a 72 h cool-down, `step_up_tokens` |
| Antigravity audit §17 and its findings F3/F4 (investigative evidence, lower in the source hierarchy) | M0.3 = F1, F2 | In M0.3 | Via `resolve_tap()` (migration 031) | Via `contact_methods` + 72 h cool-down |

**Other binding text both positions must respect (OBSERVED)**
- **Doc 12 §0 rule 4:** "Legacy `/t/<slug>` behaviour must be byte-compatible (same JSON from `get_public_profile`). A golden test enforces it." Doc 12 §2 freezes `get_public_profile` as well.
- **Doc 01 §3 C2:** "every chip for a user points to the same `/t/<slug>`". The printed URL "must never change".
- **Doc 01 F3 fix note:** "define semantics first (OQ-1, OQ-2: is a *profile* still reachable by slug/QR if one card is lost?)".
- **Doc 12 §2A:**
  - RLS changes in M0.3/M0.4 need the Security Owner's L3 review.
  - Lifecycle work waits for DEC-2026-002 (the 14-day activation expiry). The EXPIRED state and `activation_expires_at` exist only on the live database (doc 01 F6), so they cannot be modelled before the M0.2 baseline.
- **Doc 13 §3.3:** any change to physical-card-visible behaviour is treated as irreversible and needs a full decision record.

## Options

### Position A: M0.3 = F1 + F3 + F4 (F2 goes to the backlog)
- Benefits:
  - The three P1 security findings get addressed early.
  - F3's and F4's harm comes sooner off the list: lost cards keep resolving, and OTP trusts an editable phone.
- Risks:
  - F3's minimal fix on the legacy path would change `/t/<slug>` output. That conflicts with the doc 12 §0 rule 4 freeze unless the freeze is amended here.
  - Because every card of a user prints the same `/t/<slug>`, blocking the slug when one card is lost would also disable that user's other cards and shared QR links. The semantics need a Product Owner decision (and DEC-2026-002).
  - F4 before the verified-contact model risks an interim design that M1.3 later replaces.
  - F2 (P2) waits.
- Cost: higher in M0.3. Time: longer M0.3.
- Reversibility: F1/F4 are reversible, with rollback SQL and code. F3 changes behaviour on printed cards, which is treated as irreversible.

### Position B: M0.3 = F1 + F2 (as in the approved doc 12)
- Benefits:
  - Matches the approved plan and the audit.
  - Keeps `/t/<slug>` byte-compatible.
  - Fixes F3 where cards can carry per-device state (`/d/:code`, M1.2).
  - Fixes F4 with the full verified-contact model (M1.3).
- Risks:
  - F3 and F4 stay open (both P1) until Phase 1.
  - Under the doc 12 M1.2 acceptance, cards already printed with `/t/<slug>` keep resolving even when a card is suspended.
- Cost: lower in M0.3. Time: shorter M0.3.
- Reversibility: high.

(Combinations are possible, for example Position B plus an interim, documented control for F3/F4. Any such variant is the Accountable Owner's to define. Claude Code does not propose one as the answer.)

## Questions this decision must answer
1. Which findings are in M0.3: F1, F2, F3, F4?
2. If F3 is in M0.3:
   - Is doc 12 §0 rule 4 (the `/t/<slug>` byte-compatibility freeze) amended?
   - Exactly what should `/t/<slug>` return when **one of several** cards is lost, suspended or deactivated, or has expired?
   - This needs the Product Owner and DEC-2026-002.
3. If F4 is in M0.3:
   - Is it an interim control or the start of M1.3?
   - What is the trusted factor for existing users with no verified phone?
4. Where does F2 go?
5. Is doc 12 §3 amended? Doc 12 §5 item 5 says deviations are recorded in `docs/DECISIONS.md`.

## Impact assessment
- Security impact: it decides how long F3 (P1) and F4 (P1), or F2 (P2), remain open.
- Data impact: none directly. Any schema work waits for the M0.2 baseline under both positions.
- Product impact: Position A may change what printed cards show.
- Architecture impact: Position A may pull resolver or contact concepts forward, or introduce interim designs.
- Operational impact: none.
- Irreversible? Possibly. F3 under Position A is physical-card-visible; if chosen, complete G§78.

## Decision
- Decision: ________ (HUMAN DECISION REQUIRED)
- Expected outcome: ________
- Required approvals: the Accountable Owner (UNASSIGNED); the Security Owner for any F1/F3/F4 implementation (L3); the Product Owner for card semantics
- Blockers: M0.2 baseline (OQ-3); role roster (OQ-16); DEC-2026-002 (for F3 lifecycle semantics)
- Next action: the Founder names the Accountable Owner and decides
- Decision date: ________

## Result (filled at review date)
- Observed result:
- Reviewed on / by:
- Lesson for institutional memory:
