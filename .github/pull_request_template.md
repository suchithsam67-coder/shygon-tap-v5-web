## What & why
<!-- Link the DEC record for L2/L3 changes and the requirement id from the Claude Code spec (e.g. M1.2, F3). -->

## Governance (doc 13 §3, doc 14 §3.4)
- Risk engine level: <!-- auto-filled by CI: L0 Low / L1 Medium / L2 High / L3 Critical -->
- Level override (only raising it, or lowering it with a reason):
- Accountable Owner (one):
- DEC id:
- Required approvals: <!-- CODEOWNERS + Environment -->

## Blast radius (doc 14 §3.3)
<!-- auto-filled by CI: components, dependents, user journeys -->
Customer impact (manual until the simulator exists): which customers/orgs/features/users · possible downtime · data impact

## Reversibility (required for L2/L3)
- Rollback plan (deploy id / flag / expand-only migration / rollback SQL):
- Irreversible? If yes, complete G§78: why required · what can go wrong · how tested · how reversed · who approved

## Security & data
- [ ] No secrets, keys, .env files or production data in this PR
- [ ] RLS/definer/auth/payment changes have adversarial tests (L3)
- [ ] New tables/columns carry data-classification comments
- [ ] Public payload unchanged, or snapshot tests updated with Security Owner approval

## Tests
- [ ] CI green (lint, tsc, build, db:apply ×2, db:verify, rls-adversarial, test:payments, golden legacy, leak snapshot, bundle budget)
- [ ] Playwright/axe for UI changes

## AI assistance (doc 14 §3.18)
- AI-assisted: yes/no · Agent: · Session link (Claude-Session trailer):
- Human reviewer who is NOT the proposer:
