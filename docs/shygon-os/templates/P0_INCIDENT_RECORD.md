# P0-YYYYMMDD-NN — <title>

> One authoritative record per P0 (G§74). Until SHYGON Control exists (doc 14, O3), keep this file in the private incident repo **and** mirror key updates in the out-of-band channel.
> Label every statement OBSERVED / HYPOTHESIZED / CONFIRMED (G§67).

## 1. Detection (first responder, G§39)
| Field | Value |
|---|---|
| P0 ID | |
| Detection time (clock start, G§24) | |
| Detection source | monitor / canary / customer / staff / automated detector |
| Detected by | |
| Entry criterion (G§18.x / doc 13 §5) | |
| Observed behaviour | |
| Affected system(s) | |
| Affected tenants / users | |
| Known impact | |
| Potential impact | |
| Actions taken so far | |
| Current system state | |
| Evidence (links, not raw PII) | |
| People notified | |
| Recommended next action | |
| Restricted incident? (possible insider — doc 13 GAP-10) | Yes / No |
| Legal hold set? (K14) | Yes / No — scope: |

## 2. Ownership
| Role | Name | Acknowledged at |
|---|---|---|
| Incident Lead | | |
| Security decision A | | |
| Data decision A | | |
| Architecture decision A | | |
| Production decision A | | |
| Product / comms A | | |

## 3. Timers (G§23) — record actual time and ON TARGET / AT RISK / OVERDUE
| Target | Due | Actual | Status | Reason if missed (G§30) |
|---|---|---|---|---|
| Human acknowledgement ≤ 5 min | | | | |
| Incident Lead fallback if no ack at 5 min | | | | |
| Accountable Owner ≤ 10 min | | | | |
| Specialists ≤ 15 min | | | | |
| Containment plan ≤ 20 min | | | | |
| Initial containment ≤ 30 min | | | | |
| Leadership notified ≤ 30 min | | | | |
| Regulatory assessment ≤ 60 min (doc 13 GAP-8) | | | | |
| Recovery direction ≤ 60 min | | | | |
| Preliminary summary ≤ 4 h after stabilization | | | | |
| Post-incident review ≤ 3 business days | | | | |

## 4. State (G§65)
DETECTED → ACKNOWLEDGED → TRIAGED → CONTAINMENT PLANNED → CONTAINMENT ACTIVE → CONTAINED → RECOVERY PLANNED → RECOVERY ACTIVE → RECOVERED → VERIFICATION → MONITORING → CLOSED
Current state: ____________

## 5. Timeline (append only)
| Time | Event | Evidence class | By |
|---|---|---|---|

## 6. Containment switches used (doc 13 §7)
| Switch | Pulled by | Authorized by (role) | Time | Reversed at |
|---|---|---|---|---|

## 7. Decisions, handoffs, escalations, approvals
(link DEC records, HANDOFF records, PRIORITY_CHANGE records)

## 8. Communications
| Time | Audience (internal / customers / orgs / Razorpay / regulator) | Approved by | Content link |
|---|---|---|---|

## 9. Recovery & verification (G§33)
- Recovery direction: ROLL BACK / FIX FORWARD / ISOLATE / DISABLE / RESTORE / CONTINUE INVESTIGATION / ESCALATE
- Verification performed (which tests — see doc 13 §8 playbook column):
- Verification evidence:

## 10. Closure (G§34) — all required
- [ ] Impact contained  - [ ] Recovery completed  - [ ] Recovery verified with evidence
- [ ] Security reviewed where applicable  - [ ] Data integrity assessed  - [ ] Monitoring stable
- [ ] Accountable Owner confirms closure  - [ ] Timeline complete  - [ ] Follow-up actions created  - [ ] Final status posted
Closed by: ____________  Closure time: ____________

## 11. Root cause & contributing factors
## 12. Follow-up actions
| Action | Owner | Due | Tracking link |
|---|---|---|---|
