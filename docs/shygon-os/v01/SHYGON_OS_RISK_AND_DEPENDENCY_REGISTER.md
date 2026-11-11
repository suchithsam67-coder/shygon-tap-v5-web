# SHYGON OS: risk and dependency register

| Field | Value |
|---|---|
| Date | 2026-11-02 |
| Scale | Likelihood and impact: H/M/L. Owner = who acts. F-n = the founder decision register |

## 1. Risks

| # | Risk | L | I | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|
| R-01 | **Founder is a minor:** contracts, KYC or provider accounts in the founder's name are void or rejected | H | H | All legal and commercial actions through an adult authorised signatory for the company (F-2); counsel confirms | Adult | OPEN |
| R-02 | Production drift (V6-106): applying 020–037 breaks the live app or the second app | H | H | A fresh capture → rebaseline → the BQ-1 production variant with pre-check/rollback → DEC-018 review | Owner + A | OPEN |
| R-03 | The live domain serves a non-repository app with world-readable `shygontap_profiles` (V6-107) | M | H | F-5 domain plan; audit that app's data exposure; decide its fate | Owner | OPEN |
| R-04 | Credentials not rotated (B-1) | M | H | Rotate before any production apply (F-18) | Owner/Adult | OPEN |
| R-05 | Children's data collected unintentionally | M | H | 18+ gate (T-13); no Student / Guardian in V01; counsel | B + Counsel | OPEN |
| R-06 | Emergency features misunderstood as an emergency service | M | H | Fixed wording ("SHYGON does not contact emergency services; call 112"); "delivered" only on a receipt; counsel; supervised smoke test | A/B + Counsel | MITIGATED in code |
| R-07 | Verified Tap false "genuine" or key compromise | L | H | OC-6 independent review; envelope-encrypted keys (F-16); per-epoch keys; batch verification; fail closed | A + OC | IN REVIEW |
| R-08 | Link-preview bots consume taps → false "already checked" | M | M | DEC-043 P-3 (POST after load), calm wording | A/B | MITIGATED |
| R-09 | DLT rejects templates or variables (name/time/order formats) | M | M | Portal questions first; Session A's normalisation proposal | Adult + A | OPEN |
| R-10 | Refunds outside admin-refund leave entitlements active (V6-128) | M | M | Refund webhook sync before checkout (T-16) | A | OPEN |
| R-11 | Single machine / single person (bus factor 1) | H | H | Remote backup exists (GitHub, 10-26 state); push newer work regularly; a second adult Incident Lead (F-3) | Owner | PARTIAL |
| R-12 | Several AI agents editing the same files | M | M | Lane ownership; helpers on their own branches; Coordinator review before hand-off | Coord | MITIGATED |
| R-13 | The landing page misses its performance budget (5.7 s vs 4 s) | H | M | T-14 (chunking, rendering the hero earlier) | B | OPEN |
| R-14 | No monitoring or backups at launch | M | H | T-22, T-23 before release | A | OPEN |
| R-15 | Pricing/subscription claims conflict with the Terms (C-6) | M | M | F-9 | Owner + Counsel | OPEN |
| R-16 | Supplier can't build NTAG 424 DNA into metal/transparent cards at small MOQ | M | H | RFQ to 3–5 suppliers (GPT-7 pack); sample first | Adult | OPEN |
| R-17 | Scope creep: "build everything" delays any release indefinitely | H | H | The V01 scope (F-1) is the finish line; P8 items need new DECs | Owner + Coord | OPEN |
| R-18 | Tests are green locally but behave differently on the real host (headers, IP, concurrency) | M | H | Hosted P1/P2; preview soak on real Postgres | A | OPEN |

## 2. Dependencies

| Dependency | Needed by | Type | Status |
|---|---|---|---|
| Adult authorised signatory (F-2) | Razorpay, DLT, suppliers, counsel, host billing | Human/legal | OPEN |
| Counsel (F-23, DEC-017) | Terms, privacy notice, emergency/Connect/Return to Owner release, 18+ | Human | OPEN |
| Host choice (F-4) | Previews, cron, monitoring, deploy | Founder | OPEN (GPT-8 brief) |
| Production domain (F-5) | Razorpay review, DLT URL, NTAG URL template | Founder | OPEN |
| Non-production Supabase project (F-8) | P1/P2, preview verification | Founder + billing | OPEN |
| Production capture (F-7) | Rebaseline, apply | Founder | OPEN |
| MSG91 + DLT (F-10) | Emergency alerts, order SMS, phone verification | Provider | OPEN |
| Razorpay live (F-11) | Payments | Provider | OPEN |
| NTAG card supplier (F-16) | Verified Tap release, card sales | Supplier | OPEN (RFQ drafted) |
| Email provider (DEC-031) | Notifications beyond SMS | Founder | OPEN (not V01-blocking) |
| GitHub Actions minutes | CI | Platform | Available (private repo quota: verify) |
