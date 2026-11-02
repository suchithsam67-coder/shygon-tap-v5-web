# SHYGON OS: master roadmap, workstreams and task registry

| Field | Value |
|---|---|
| Date | 2026-11-02 |
| Status | PROPOSED, with F-1 |
| Rule | Work runs in dependency order. A phase may start early only for items whose dependencies are met; release gates are never skipped |

## 1. Phases

| Phase | Goal | Exit criteria | State today |
|---|---|---|---|
| **P0 Audit & architecture** | One truth about what exists; the V01 scope | These documents approved (F-1); contradictions C-1..C-11 resolved | **Documents delivered 2026-11-02; waiting on F-1** |
| **P1 Core identity & AAROH** | The public Tap, auth, adults-only, the Verified Tap backend | Golden 100%; identity tests; the 18+ gate; U1 backend reviewed (OC-6) | Mostly built; 18+ gate and OC-6 pending |
| **P2 Owner OS** | The dashboard, modes page, card pairing/status, report-stolen | Owner e2e journeys pass, incl. mobile and a11y | Built except pairing (minimal) and report-stolen |
| **P3 Experience modes** | Info, Lost, Return to Owner, Connect, Emergency owner alerts, Verified Tap badge | Each mode's release condition (scope §2.2) | Built and OFF; the badge not started |
| **P4 Security & portability** | Phone verification, admin MFA, data export, deletion parity, an independent security review | Acceptance §4–§5 | Export and MFA not started |
| **P5 AI (architecture only for V01)** | The AI governance framework + architecture | Doc approved; no AI ships in V01 | Not started |
| **P6 Payments & commercial** | Live one-time payments, refund sync, legal pages complete | Live smoke payment + admin refund evidenced | Needs adult signatory (F-2, F-11) |
| **P7 Production readiness** | Host, CI, previews, rebaseline, apply, monitoring, backups, rotation, runbooks | Release checklist 100% evidenced | Blocked on F-4, F-7, F-8, F-18 |
| **P8 Future ecosystem** | Student, Events, Cloud, Verify, Access, Guardian, subscriptions, AI features, SHYGON ID, transfer | Each by its own DEC | Not in V01 |

## 2. Critical path to Version 01

```
F-1 scope ─┬─> F-2 adult signatory ─> F-10 DLT, F-11 Razorpay, F-23 counsel ──────────┐
           ├─> F-4 host + F-5 domain ─> F-8 non-prod + previews ─> P1/P2 hosted checks ┤
           ├─> F-7 production capture + F-18 rotation ─> rebaseline ─> apply 020–037 ──┤
           └─> F-16 key custody + suppliers ─> first NTAG batch ───────────────────────┤
Build in parallel: badge, pairing, export, phone verify, MFA, 18+ gate, monitoring ───┤
                                                                                       v
                          Release checklist (acceptance §7) ─> founder + adult release decision
```

The longest poles are **human**: the adult signatory, DLT approval, counsel, the card supplier. They should start first.

## 3. Workstreams

| # | Workstream | Lead | Helpers | Owns (files) |
|---|---|---|---|---|
| W1 | Product architecture | Coord | GPT (briefs) | `coordination/v01/*`, DEC drafts with A |
| W2 | Frontend & experience | **B** | OC (reviews), GPT (wording) | `src/**`, `e2e/**`, page routing in netlify.toml/vercel.json |
| W3 | Backend & database | **A** | OC (reviews), CX (bounded tasks) | `supabase/**`, `netlify/**`, `api/**`, the contract, migrations |
| W4 | Security & privacy | **A** (+Coord review) | OC (independent reviews), Counsel | security tests, DECs, threat models |
| W5 | Payments | **A** | Adult (Razorpay) | payment functions, V6-128 |
| W6 | AI & automation | Coord (architecture only in V01) | GPT | `docs` only |
| W7 | Testing & QA | A and B in their lanes | OC, CX | test suites; CI |
| W8 | Docs & release engineering | Coord + A | CX (CI) | readiness reports, runbooks, `.github/**` (with A) |

**Integration rules (enforced by the Coordinator):**
- one authoritative contract;
- one task registry (below);
- every task has one owner;
- helpers work only on their own branches and folders;
- everything is reviewed and verified by the Coordinator before hand-off;
- only A and B commit to their branches;
- no agent changes a product decision.

## 4. Task registry (Version 01)

Status: TODO / DOING / REVIEW / DONE / BLOCKED. "Dep" lists blocking decisions or tasks.

| ID | Task | Phase | Owner | Dep | Status |
|---|---|---|---|---|---|
| T-01 | Founder answers F-1..F-27 | P0 | Owner/Adult | — | DOING (F-1 APPROVED 2026-11-02) |
| T-02 | Resolve contradictions C-1..C-11 in the docs | P0 | Coord + A | T-01 | TODO |
| T-03 | Verified Tap independent review (OC-6) → fixes | P1 | OC → A | — | DOING |
| T-04 | Lost frontend review (OC-7) → fixes | P3 | OC → B | — | DOING |
| T-05 | Admin edge logging V6-094 (CODEX-1) → review → A | P4 | CX → A | — | DOING |
| T-06 | Merge backend v0.11.1 into the frontend | P2 | B | — | TODO |
| T-07 | Verified Tap badge + `/d/<code>` page (contract v0.11) | P3 | B | T-06 | TODO |
| T-08 | Card pairing (minimal): bind code+epoch to the owner at activation; lifecycle states | P2 | A → B | DEC-028, F-14 | TODO |
| T-09 | Report stolen / disable card | P2 | A → B | T-08 | TODO |
| T-10 | Data export (JSON + vCard) + export page | P4 | A → B | F-20 | TODO |
| T-11 | Phone verification of the account phone | P4 | A → B | — | TODO |
| T-12 | Admin MFA | P4 | A | — | TODO |
| T-13 | 18+ eligibility at sign-up + Terms wording | P1 | B + Counsel | F-26 | TODO |
| T-14 | Landing hero < 4 s (from the OC-4 diagnosis) | P2 | B | — | TODO |
| T-15 | Lost / Info / Verified Tap wording approval | P3 | Owner | F-19 | TODO |
| T-16 | V6-128 refund webhook sync | P6 | A | F-22 | TODO |
| T-17 | Legal details on the site (`src/data/legal.ts`) | P6 | B | F-2, F-11 | BLOCKED |
| T-18 | Host chosen + previews + non-prod project | P7 | Owner/Adult + A | F-4, F-8 | BLOCKED |
| T-19 | Hosted P1 / P2 runs (runners built) | P7 | A | T-18 | BLOCKED |
| T-20 | CI green on GitHub Actions, required on PRs | P7 | CX → A | — | TODO |
| T-21 | Production capture → rebaseline → DEC-018 review → apply 020–037 | P7 | Owner + A | F-7, F-18 | BLOCKED |
| T-22 | Monitoring + error tracking + alerts | P7 | A | F-4 | TODO |
| T-23 | Backups + restore drill + replay-state reconciliation runbook | P7 | A | F-4 | TODO |
| T-24 | Emergency sweep cron | P7 | A | F-4 | BLOCKED |
| T-25 | DLT templates + variable normalisation | P3 | Adult → A | F-10 | BLOCKED |
| T-26 | Supplier RFQ → first NTAG batch → personalisation + batch verification | P3 | Adult + A | F-16 | BLOCKED |
| T-27 | Counsel review: Terms, privacy notice (GPT-2 pack), safety features | P4 | Adult/Counsel | F-23 | BLOCKED |
| T-28 | AI governance + architecture doc (no features) | P5 | Coord | F-25 | TODO |
| T-29 | Independent full security review before release | P7 | OC + Coord | T-03..T-12 | TODO |
| T-30 | Release checklist evidence pack | P7 | Coord + A + B | all | TODO |

## 5. Milestone reporting

After each milestone the Coordinator publishes an evidence report: tasks done, commits, test counts (RAN vs REPORTED), reviews, open risks, and the next decisions. It always uses the BUILT / TESTED / APPROVED / PRODUCTION READY / LIVE split.
