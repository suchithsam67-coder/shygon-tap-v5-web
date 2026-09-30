# 09 — AI Opportunity Map (Future, not MVP)

**Rule:** AI is added only where it removes a real cost or risk and a human stays in control. Nothing here is required by Phases 0–2. All AI features run **server-side**, on **minimal data**, with the model provider under a data-processing agreement, no training on customer data, logged prompts/outputs (redacted), per-org toggles, and a kill switch.

Format: **Problem → AI role → Data required → Risk → Human control → Cost → Phase.**

| # | Feature | Problem | AI role | Data required | Risk | Human control | Cost | Phase |
|---|---|---|---|---|---|---|---|---|
| 1 | **Rescue abuse & spam scoring** | Harassment/spam through the finder relay is the top safety risk | Classify finder messages (toxicity, threats, solicitation, links) before delivery; score threads | Message text (ephemeral), thread velocity | False positives block real finders; bias | Owner sees "held for review"; admin queue; rules-first (regex/limits) with model as second layer | Low (small classifier or moderation API) | **3** (rules in 3, model in 3b) |
| 2 | **Fraud/anomaly detection** | Card-testing at checkout, account takeover, enumeration, org misuse | Rules → gradient-boosted/anomaly model over events (velocity, geo, device changes) | Audit/auth/payment metadata, hashed IPs | Wrongly locking customers | Score only *flags*; auto-actions limited to step-up; admins decide bans | Low–medium | **3** rules; ML **5** |
| 3 | **Support assistant** | Repetitive support (activation, editing limits, delivery) | Retrieval-augmented answers from help content + the *user's own* order/device state via constrained tools; drafts replies for agents | Help docs, own order/device status | Wrong policy claims; leaking other users' data | Agent-in-the-loop for refunds/security; strict tool permissions; citations; handoff button | Medium (tokens) | **3** (agent-assist) → **4** (customer-facing) |
| 4 | **Profile & bio generation** | Blank-page problem at onboarding | Draft headline/bio from what the user typed (LinkedIn text they paste, prompts) | User-provided text only | Hallucinated claims on a public page | Draft-only, user edits & publishes; never auto-publish; label "AI-assisted" optional | Low | **2** (optional nicety) |
| 5 | **Portfolio organization (Student)** | Students dump projects/certificates unsorted | Suggest categories/tags/order; summarize a project from README | Student-provided items | Mis-categorization; minors' data to a third party | Suggestions only; **minors: off by default**, needs guardian/school setting | Low | **2b/4** |
| 6 | **Credential categorization / OCR** | Verifying/structuring uploaded certificates is manual | Extract issuer/title/date from a certificate image; suggest type; flag inconsistencies | Uploaded certificate image | Extraction errors; **must never convert into `verified`** | Output populates a `self_asserted`/`pending` draft; verification stays with issuer/human reviewer | Medium (vision) | **3b** |
| 7 | **Business profile assistance** | SMBs struggle to write services/FAQ/enquiry replies | Draft service descriptions, FAQs, enquiry replies from business facts | Business-provided facts, reviews they own | Misleading marketing claims | Draft → owner approval; no auto-send | Low | **4** |
| 8 | **Smart profile recommendations** | Users don't know what to add | Rules-first "complete your profile", "add WhatsApp" based on funnel data; ML later | Own aggregate analytics | Nagging; over-personalization | Dismissable; off switch | Low | **2** (rules), later ML |
| 9 | **Organization insights** | Schools/companies want engagement insights | Natural-language summaries over **aggregate** analytics ("attendance up 12%") | k-anonymous aggregates only | Re-identification through small cells | Org toggle; show the underlying table | Low–medium | **4b** |
| 10 | **Multilingual content assist** | Locations need many languages | Machine-translate location content, simplified-language variants, alt-text drafts | Org content (non-personal) | Bad translations in safety text | **Human review required before publish for safety-critical blocks**; show "machine translated" tag | Low–medium | **4** |
| 11 | **Personalized experiences** | Context-aware layout/time-of-day | (Existing GOAT time-of-day is rule-based) | — | Creepy tracking | Stay rules-based; no behavioral profiling | — | **Not planned** |
| 12 | **Access anomaly detection** | Unusual door/permission use | Behavioral baseline per org/resource | `access_decisions` | False alarms | Alert-only; human triage | Medium | **5+** |

## Not AI (explicitly)
* **Identity verification decisions** (is this person who they claim?) — never delegated to a model.
* **Access control decisions** — deterministic policy engine only.
* **Moderation *enforcement*** (bans, takedowns) — humans decide; AI prioritizes queues.
* **Emergency information release.**

## Governance requirements before any AI ships
1. Data-flow diagram + provider DPA + regional processing choice (India data residency question, OQ-9).
2. Prompt/response logging with PII redaction and retention limit.
3. Evaluation set per feature (precision/recall for classifiers; red-team set for the assistant).
4. User-visible labelling & opt-out; org-level disable.
5. Cost guardrails (monthly budget, per-user rate limits).
6. Rollback: every AI output is a *suggestion object* separate from the canonical record.
