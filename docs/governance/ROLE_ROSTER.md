# SHYGON — Canonical Role Roster (G§3, G§80)

> A production launch is blocked until every row below has a named person and a tested contact (doc 13 §2.3).
> Holding a governance role grants no database privilege. Containment rights come from the kill-switch matrix (doc 13 §7.2).

> **Status 2026-10-02: DEC-2026-018 APPROVED, Option B (the one-person control model, doc 13 §2.2).**
> - **The repository owner holds the roles marked below.** No personal name, phone number or GitHub handle was provided, and none is invented. Those cells remain HUMAN ACTION REQUIRED.
> - The `@role-*` handles in `.github/CODEOWNERS` remain placeholders, not real accounts.
> - **The L3 control in force:**
>   - No external retained reviewer is named. So every L3 change gets a **24-hour cool-off** plus the `.github/pull_request_template.md` checklist review before the owner approves it.
>   - A Claude non-author review is advisory and never an approval.
> - **Still UNASSIGNED:** the secondary Incident Lead (must be a different person), Legal / Compliance and the external reviewer. The G2 production-launch gate stays closed (doc 13 §2.3).
>
> _Previous status (2026-09-30): no role holder named; every role UNASSIGNED / HUMAN CONFIRMATION REQUIRED (OQ-16)._

Last reviewed: 2026-10-02 (DEC-2026-018)  Reviewed by (Product Owner): repository owner  Next review due (quarterly): 2027-01-02

| Role | Primary (name) | Phone | Backup (name) | Phone | GitHub handle | Admin-app role (if any) |
|---|---|---|---|---|---|---|
| Product Owner | Repository owner (one-person model; name not recorded) | HUMAN ACTION REQUIRED | none (one-person model) | | HUMAN ACTION REQUIRED | |
| Principal Architect | Repository owner (one-person model; name not recorded) | HUMAN ACTION REQUIRED | none (one-person model) | | HUMAN ACTION REQUIRED | |
| Security Owner | Repository owner (one-person model; name not recorded) | HUMAN ACTION REQUIRED | none (one-person model) | | HUMAN ACTION REQUIRED | |
| Data Owner | Repository owner (one-person model; name not recorded) | HUMAN ACTION REQUIRED | none (one-person model) | | HUMAN ACTION REQUIRED | |
| Engineering Owner | Repository owner (one-person model; name not recorded) | HUMAN ACTION REQUIRED | none (one-person model) | | HUMAN ACTION REQUIRED | |
| QA Owner | Repository owner (one-person model; name not recorded) | HUMAN ACTION REQUIRED | none (one-person model) | | HUMAN ACTION REQUIRED | |
| Release Owner | Repository owner (one-person model; name not recorded) | HUMAN ACTION REQUIRED | none (one-person model) | | HUMAN ACTION REQUIRED | |
| Incident Lead — primary | Repository owner (one-person model; name not recorded) | HUMAN ACTION REQUIRED | none (one-person model) | | HUMAN ACTION REQUIRED | |
| Incident Lead — secondary | UNASSIGNED — HUMAN ACTION REQUIRED | | UNASSIGNED — HUMAN ACTION REQUIRED | | UNASSIGNED — HUMAN ACTION REQUIRED | |
| Legal / Compliance (Consulted) | UNASSIGNED — HUMAN ACTION REQUIRED | | UNASSIGNED — HUMAN ACTION REQUIRED | | UNASSIGNED — HUMAN ACTION REQUIRED | |
| External security reviewer (L3, if used) | UNASSIGNED — HUMAN ACTION REQUIRED | | UNASSIGNED — HUMAN ACTION REQUIRED | | UNASSIGNED — HUMAN ACTION REQUIRED | |

## Escalation contacts (G§80)
| Escalation | First | Second | Out-of-band channel |
|---|---|---|---|
| Security | UNASSIGNED — HUMAN ACTION REQUIRED | UNASSIGNED — HUMAN ACTION REQUIRED | UNASSIGNED — HUMAN ACTION REQUIRED |
| Data | UNASSIGNED — HUMAN ACTION REQUIRED | UNASSIGNED — HUMAN ACTION REQUIRED | UNASSIGNED — HUMAN ACTION REQUIRED |
| Infrastructure (Supabase / Netlify / Vercel / DNS) | UNASSIGNED — HUMAN ACTION REQUIRED | UNASSIGNED — HUMAN ACTION REQUIRED | UNASSIGNED — HUMAN ACTION REQUIRED |
| Production (release / rollback) | UNASSIGNED — HUMAN ACTION REQUIRED | UNASSIGNED — HUMAN ACTION REQUIRED | UNASSIGNED — HUMAN ACTION REQUIRED |
| Payments (Razorpay account holder) | UNASSIGNED — HUMAN ACTION REQUIRED | UNASSIGNED — HUMAN ACTION REQUIRED | UNASSIGNED — HUMAN ACTION REQUIRED |

## Authorized responders (doc 13 GAP-5)
People on on-call who may use the "(P0 only)" switches in doc 13 §7.2:
| Name | Phone | Allowed switches | Trained on (date) |
|---|---|---|---|

## Vendor emergency contacts
Supabase support plan / Netlify / Vercel / Razorpay / MSG91 / Twilio / email provider / registrar / GitHub:
| Vendor | Account owner | Support route | Account ID |
|---|---|---|---|
