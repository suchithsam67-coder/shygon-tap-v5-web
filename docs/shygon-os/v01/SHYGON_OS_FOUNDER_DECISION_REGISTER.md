# SHYGON OS: founder decision register

| Field | Value |
|---|---|
| Date | 2026-11-02 |
| Status | **PROPOSED.** Nothing here is decided until the founder (and, where marked, an adult signatory or counsel) answers |
| Related | Every decision links to the existing DEC record where one exists (`docs/governance/decisions/`) |

## Why some decisions need an adult

The directive states that **the founder is a minor**. In India a minor cannot enter a binding contract (Indian Contract Act 1872, s.11; **counsel to confirm**). Anything that signs, contracts, completes KYC or carries legal responsibility must therefore be done by the company, through an **adult authorised signatory** (a director or a guardian authorised by board resolution), not by the founder personally.

**Correction to earlier advice in this project:** the Coordinator previously told "you" to activate Razorpay, register on DLT, sign supplier NDAs and fill in company details. Each of those must be done by the adult signatory.

Legend for **Who decides**:
- **F**: the founder (product decisions);
- **A**: the adult authorised signatory (contracts, KYC, provider accounts, legal roles);
- **C**: counsel;
- **P**: a provider's approval (Razorpay, DLT, a host).

## Decisions

| # | Decision | Who | Recommended default | Consequence if delayed | Blocks |
|---|---|---|---|---|---|
| **F-1** | Approve `SHYGON_AAROH_VERSION_01_COMPLETE_SCOPE.md` (what is in V01 and what is later) | F | **APPROVED 2026-11-02**, founder in the coordination session: "Approve F-1". Consequence recorded by the Coordinator: the scope's V01 rows are now in scope, including data export (F-20's V01 part), adults only (F-26's product rule) and no AI features (F-25); counsel review of their wording still applies | — | — |
| **F-2** | Who is the **adult authorised signatory**? Is the company incorporated (name, CIN, directors)? | F + A | Name one adult director or guardian with written authority | No contract, KYC or provider account can legally proceed | F-10, F-11, F-23, payments, SMS, suppliers |
| **F-3** | Fill the ROLE_ROSTER: Legal/Compliance and Incident Lead (secondary) must be **adults other than the founder**; confirm the Principal Architect (contradiction C-5) | F + A | Founder = Product Owner; the adult signatory = Legal/Compliance contact and secondary Incident Lead | The production launch gate G2 stays closed (doc 13 §2.3) | Release |
| **F-4** | One host: Netlify or Vercel (V6-043) | F | Wait for the GPT-8 brief, then decide | No previews, no cron, no deploy | Previews, P1/P2, release |
| **F-5** | The production domain, and the fate of the corporate site now on www.shygontech.com (V6-107) | F | V6 on a subdomain (e.g. tap.shygontech.com) until the corporate site is migrated | Razorpay review and DLT URL whitelisting can't finish | F-10, F-11 |
| **F-6** | Record that DEC-038/039 supersede doc 10 §4's "do not build Rescue/Connect" | F | Yes, as a note in DECISIONS.md | Documents keep contradicting the code (C-1) | Docs |
| **F-7** | Provide the read-only production capture (V6-106) | F or A (account holder) | Run the VERIFY ON LIVE queries or a schema-only dump | 020–037 can never be applied safely | Production |
| **F-8** | Create a non-production Supabase project + protected previews (AP-1..AP-6, DEC-027) | F + A (billing) | One non-production project; previews protected | P1/P2 never close; Return to Owner and Connect can't switch on | Release of safety features |
| **F-9** | Pricing and subscriptions: provisional ₹999/₹1,499; "no subscription" promises vs the trial + ₹999/month direction (C-6) | F (+C for terms) | V01: one-time purchases only, keep "no subscription"; decide subscriptions for V02 | Pricing copy stays blank; terms conflict | Commercial launch |
| **F-10** | SMS: MSG91 + DLT registration (entity, header SHYGON, templates); the portal's tag answers | A (+P) | Start now; templates after the portal answers | Emergency alerts can't deliver; order SMS off | Emergency, orders |
| **F-11** | Razorpay live activation; the site's legal details (registered address, CIN, GSTIN, grievance officer) | A (+P) | Do it after F-2 and F-5 | No live payments | Commercial launch |
| **F-12** | "Places and objects": the same as Info, or a separate mode? (C-3) | F | Merge into Info; remove the separate showroom entry | The showroom promises a mode that already exists | Showroom wording |
| **F-13** | The Terms' 14-day edit rule vs free Info editing (C-7) | F + C | Keep 14 days for profiles; Info edits free; ChatGPT's draft wording for counsel | A Terms conflict at launch | Info release |
| **F-14** | Accept the Verified Tap Q5 deviation (the code in a closed table, not on `cards`) (C-8) | F | Accept (smaller attack surface; reversible) | U1 stays on hold | Verified Tap |
| **F-15** | Printed QR on the card back (C-4) | F | No QR by default (the 2026-10-18 design); a QR only ever yields "not verified" | Card artwork is held up | Card production |
| **F-16** | Verified Tap: Q2 key custody, Q3 who personalises, Q7 the first batch + inlay feasibility | F + A (supplier contracts) | Q2: envelope-encrypted keys (DEC P-5 b). Q3/Q7 after the supplier RFQ (GPT-7 pack) | Cards can't be made; the badge stays off | Card launch |
| **F-17** | Member OS: confirm it is a separate product in its own repository; delete the superseded untracked copy here (C-9) | F | Yes | The numbering clash, confusion | Repo hygiene |
| **F-18** | Credential rotation B-1 (DEC-001) | F or A | Before any production apply | Production stays at risk | Production |
| **F-19** | Approve the customer wording: Info, Lost (GPT-6 checked table), the Verified Tap verdicts | F | As checked | The features stay off | Info, Lost, U1 release |
| **F-20** | Data export (U3) in V01? | F + C | **Yes, a basic owner export (JSON + vCard) in V01**; the "continuity pledge" later (GPT-9 brief) | The DPDP access right (2027) needs it anyway; earlier is cheaper | Owner OS |
| **F-21** | The customer-facing SHYGON ID (D-9) | F | Later (V02); no customer impact in V01 | None for V01 | — |
| **F-22** | Record V6-128 (refunds outside the admin tool) as P1 before checkout (D9) | F | Approve | Possible refund/entitlement mismatches once checkout is on | Checkout |
| **F-23** | Engage counsel (DEC-017): DPDP, minors, CERT-In, GST, the Terms, the emergency features | A | Engage before any public switch | Sensitive features stay off | Emergency, Connect, Return to Owner, any minors' data |
| **F-24** | V01 switch-on order for the built features | F | Business → Info → Lost + Return to Owner (after P1) → Connect (after P2 + counsel) → Emergency owner alerts (after DLT + counsel + a supervised smoke test) → Verified Tap (with the first NTAG batch). Visitor alerts and Privé stay off | — | Release plan |
| **F-25** | AI in V01 | F | **None.** Intelligence OS = architecture + governance only (doc 09) | — | — |
| **F-26** | Children's data: no Student, Guardian-for-children or under-18 accounts in V01 | F + C | Adults only (18+) in the Terms; an age checkbox at sign-up | Legal exposure | Student, Guardian |
| **F-27** | Open advisories: the minimatch moderate npm advisory; L-1..L-6 confirmations (Session A's list) | F | Review in the backend session | Minor | Release gate G11 |

## How to answer

Reply in the coordination session with the decision numbers, e.g. "F-1 approve; F-12 merge; F-25 none". Where **A** or **C** is required, the founder's answer records intent, and the adult signatory or counsel confirms in writing.
