# 07 — Security Threat Model

*Method: STRIDE-style per asset/flow; each threat → Risk → Mitigation → Detection → Recovery. Ratings are likelihood×impact for SHYGON's context (public-facing physical tokens, minors possible in Student, consumer India user base). "In V5?" states whether today's code already mitigates.*

## 0. Assets, actors, trust boundaries

**Assets:** account sessions; persona data (PII); sensitive data (guardian/emergency); device→route bindings; payment state & entitlements; org rosters; rescue conversations; credentials' integrity; audit log; secrets (Razorpay, service role, OTP secret, SDM keys, API keys).
**Actors:** curious visitor; malicious visitor/finder; scraper; account thief; malicious/compromised org admin; malicious org (impersonator); insider/admin; API abuser; payment fraudster.
**Boundaries:** (1) internet → edge; (2) edge → DB; (3) browser → Supabase (anon/JWT); (4) functions → Supabase (service role); (5) admin app → DB; (6) org console → DB; (7) Razorpay/SMS/email webhooks → functions; (8) physical: chip ↔ phone.

## 1. Threat register (major threats)

Rating: **C** critical · **H** high · **M** medium · **L** low.

### T1. Account takeover — **H**
* **Risk:** attacker gains a customer/org/admin account → edits persona, deactivates devices, reads consented data.
* **Mitigation:** email-link/password with breach-password check; verified-contact model (F4 fix); step-up A3 for device state, phone change, deletion, export; MFA (TOTP/passkey) mandatory for admin/org-admin; new-login and security-change notifications on all channels; 24-h sensitive-action lock after reset; refresh-token rotation + revoke-all on password change.
* **Detection:** impossible-travel/new-device rule, burst of failed logins/OTP (Supabase auth logs → alerts), phone-change followed by device action within 72 h (auto-flag).
* **Recovery:** "This wasn't me" one-click in security email (revokes sessions, freezes sensitive actions, opens ticket); admin recovery runbook; device lost-state reversible only via A3.
* **In V5?** Partially (OTP limits exist; F4 defeats the value).

### T2. Session theft — **M**
* **Risk:** XSS/malware steals `localStorage` refresh token.
* **Mitigation:** strict CSP (exists; keep no `unsafe-inline` for scripts), no third-party scripts on public/auth pages, Trusted Types (later), short JWT, refresh rotation with reuse detection, bind sessions to coarse device fingerprint for admins, optional "don't keep me signed in".
* **Detection:** refresh-token reuse alert; CSP violation report endpoint (`report-to`).
* **Recovery:** global sign-out RPC; rotate JWT secret in emergencies (documented).

### T3. Unauthorized profile editing — **H**
* **Mitigation:** owner RLS + edit-rules trigger (exists) + column guards for privileged columns (F1) + org-issued persona fields locked from user edits where org-owned + audit on publish/visibility changes.
* **Detection:** adversarial CI suite covers every column class; anomaly on mass edits.
* **Recovery:** persona version history (add: last 10 versions) → one-click restore; admin suspend.

### T4. NFC cloning / spoofing — **H (rises with Access)**
* **Risk:** Static URL NFC (NTAG21x) can be cloned in seconds by any phone; a cloned tag opens the same public page (harmless today) but would *impersonate* a device in Rescue/Access.
* **Mitigation (layered):** (1) **Never authenticate by tap** (A0 rule). (2) Rescue/Access use **NTAG 424 DNA SDM** (rolling CMAC + counter) for new hardware → clone yields at most stale/replayed URLs, which the server rejects (counter must increase; tolerate window for offline taps). (3) Per-device keys derived from a master in KMS/HSM (never stored in DB, not shared across batches). (4) Lock chip write-protection at manufacture; verify batch attestation. (5) For static-only cards: treat as public-page pointers; for lost-and-found allow static but make owner-notification the only effect (no data revealed).
* **Detection:** counter regression/replay events; two distant taps of same device in impossible time; spike in CMAC failures per batch.
* **Recovery:** revoke device (route → `unavailable`), reissue with new key; batch key rotation.
* **In V5?** Unknown chip family (OQ-2).

### T5. QR abuse — **M**
* **Risk:** sticker-over-QR ("quishing"), redirecting to phishing; forged QR pointing to attacker page that mimics SHYGON.
* **Mitigation:** QR encodes only `https://shygontech.com/d/<code>`; page shows device/owner-verified badge and item name; **no open redirects anywhere**; `Link-Domain` display; educate on reprint; custom-link buttons on personas carry an interstitial for unknown domains + blocklist (Safe Browsing lookup) + `rel=noopener nofollow`; report-abuse button on every public page.
* **Detection:** reports, blocklist hits, link-click anomaly.
* **Recovery:** admin suspends persona/link domain platform-wide.

### T6. Rescue spam / harassment — **H**
* **Risk:** repeated unwanted contact, flooding the owner, scraping owner via responses, a stalker using a found tag to contact/track someone.
* **Mitigation:** owner is never shown a finder's data except what finder voluntarily writes; finder gets no owner data; Turnstile + IP/session/item rate limits (3/hr/ip, 5/day/item, 50/day/global-per-ip-hash); message caps, link stripping, profanity/abuse scoring; owner controls: mute, block finder token, "quiet mode" (digest only), disable thread creation without deleting lost mode; **no push of message text** to notification channels; auto-quiesce after N unanswered messages; abuse score feeds admin queue; repeat offender ip-hash/asn throttling.
* **Detection:** thread velocity, same-hash across many items (mass scan), owner block/report counts.
* **Recovery:** item-level "pause rescue" (page shows neutral text); admin removes messages, blocks hash ranges.

### T7. Privacy leakage — **C**
* **Risk:** private/sensitive fields exposed via public payload, RPC, error message, cache, analytics, logs, notifications, or org queries.
* **Mitigation:** whitelisting shaping functions (exists), snapshot test that a fully-populated persona never leaks non-public fields; shared edge cache keyed only on public shape; PII redaction in logs (structured-log allow-list); notification bodies minimal; sensitive tier encrypted; org reads via consent-checked definer only; PDF/vCard downloads built from the same public shape.
* **Detection:** canary values in test personas scanned for in all outputs on every deploy; log scanners for PII patterns.
* **Recovery:** cache purge tag; incident procedure (72-h regulator notification readiness, counsel OQ-9).

### T8. ID enumeration — **M**
* **Risk:** iterate slugs/codes to harvest profiles or discover valid device codes.
* **Mitigation:** device codes ≥ 64-bit random; uniform responses for all not-available reasons; per-IP resolve throttling and 404-burst blocking; slugs remain enumerable *by design* (vanity) — acceptable only for public-tier personas; no sequential IDs exposed; `shygon_id` not resolvable.
* **Detection:** 404 ratio per ip-hash, sequential-pattern detector.
* **Recovery:** ban range; slug privacy toggle (persona not publicly listed by slug → device-code only).

### T9. Credential forgery — **H (trust product)**
* **Risk:** user fakes a certificate/achievement; org impersonated to issue fake attestations; edit of a verified record.
* **Mitigation:** provenance enum enforced by trigger (users can create only `self_asserted`); attestation only via issuing function by verified org member; **verified-org gate** (domain/DNS proof + admin review); credentials immutable after issue (changes = new version + supersede record); public verify page reads live status (revocation instantly effective); UI shows provenance badge, never a plain checkmark for self-asserted.
* **Detection:** issuance volume anomalies per org; duplicate credential fingerprints across subjects; verification-page 404 storms.
* **Recovery:** org suspension revokes/flags all its credentials pending review; per-credential revoke with reason; notify subjects.

### T10. Organization impersonation — **H**
* **Mitigation:** manual verification with evidence (domain email + DNS TXT, registration doc); name-similarity/homograph check vs verified orgs & reserved brands; "Verified" badge only after review; blocked reserved slugs; org creation rate-limited; first 30 days: issuance caps.
* **Detection/Recovery:** report flow; badge revoke; take-down of org persona pages.

### T11. Admin compromise — **C**
* **Mitigation:** MFA required; allow-listed email domains (exists); role least privilege; destructive/bulk actions need reason + re-auth (≤10 min) and, for S3 access or refunds > threshold, **two-person approval**; append-only audit with alerts on privilege use; no service-role key on any client (exists); IP allow-list optional for admin API; separate admin Supabase role from customer path; regular access review.
* **Detection:** admin action rate anomalies, off-hours privileged actions, audit-log gap monitor.
* **Recovery:** instant `is_active=false` (exists) — deactivation preserves audit FK; rotate secrets; session revoke.

### T12. Privilege escalation — **H**
* **Mitigation:** `admin_users` cannot be written by customers (tested); definer functions pin `search_path`, REVOKE PUBLIC; role changes require `admins.manage` + audit; tenant role changes require `members.manage` and cannot escalate above actor's own role; last-owner protection; CI lint over `pg_proc` for definer functions missing pinning/revocation.
* **Detection:** trigger-based alert on any role/permission change; diff of `pg_proc` grants in CI.
* **Recovery:** revoke + audit review.

### T13. Cross-tenant data access — **C**
* **Mitigation:** design rules in doc 03/04 (org_id everywhere, helper-derived org, composite FKs); **generated cross-tenant test matrix** (for every org-scoped table × role × op); Supabase Realtime channels use RLS (verify); storage paths namespaced by org with policies; API keys bound to one org.
* **Detection:** synthetic cross-tenant canary account attempts on schedule; anomaly on org-A tokens hitting org-B ids (403 count alert).
* **Recovery:** tenant-scoped incident tooling; forced credential rotation for affected org.

### T14. Payment webhook abuse — **M (mitigated in V5)**
* **Mitigation:** existing signature + event ledger + amount/currency + order lookup; add: IP/user-agent logging (not authentication), replay window check on event `created_at` (accept ≤ 24 h), alert on signature failures > N/min, secret rotation runbook, never trust `verify-payment` alone.
* **Detection:** critical admin notification on mismatch (exists); daily gateway↔DB reconciliation.
* **Recovery:** hold state exists (mismatch → not fulfilled); manual reconcile RPC.

### T15. API abuse / rate-limit bypass — **M**
* **Risk:** scraping, credential stuffing, key sharing, distributed IPs, header spoofing (`X-Forwarded-For`), race conditions.
* **Mitigation:** platform-trusted client-IP source only (Netlify `x-nf-client-connection-ip` / Vercel `x-real-ip`; never raw XFF); limits keyed on multiple dimensions (ip-hash + subject + route + device); Turnstile on public POSTs; cost-based limits for expensive routes (bulk, export); per-org quotas; idempotency keys; DB-level limits as backstop (unique/partial indexes, advisory locks for counters); WAF rules.
* **Detection:** 429 dashboards, key usage anomalies. **Recovery:** key revoke, IP ban, quota changes.

### T16. Malicious Tap redirection — **H**
* **Risk:** attacker rewrites a victim's persona/route to send visitors elsewhere; org edits route of member's device; admin/route tampering; open redirect via link fields; DNS/domain takeover of `shygontech.com`.
* **Mitigation:** routes only editable by device owner (or org for org-owned) with audit + notification on change; route target must belong to same owner/org (composite FK); **no arbitrary URL targets** as routes (only internal target kinds) — external links live inside persona as ordinary links with interstitial; HSTS preload, DNSSEC, registrar lock + MFA, CAA records; CT-log monitoring for the domain; canonical origin baked in code (exists).
* **Detection:** notification on any route change; CT alerts; synthetic checks of top devices' resolved targets. **Recovery:** route history + rollback; registrar recovery plan.

### T17. Unauthorized access permissions (SHYGON Access) — **C (Phase 5)**
* **Risk:** granting or using access without rights; replay of a tap/token to a lock; stale grants; org admin over-granting.
* **Mitigation:** policy engine deny-by-default; A4 requirement for physical; short-lived single-use signed tokens; grants always time-boxed; two-person rule for high-privilege areas; `access_decisions` complete log; kill switch per org/resource; **threat-model + external pen-test as a Phase-5 entry gate (rule 13).**
* **Detection:** allow-after-deny sequences, off-hours access, concurrent use, denied burst. **Recovery:** global revoke by org/resource, token key rotation.

### T18. Emergency-data abuse — **H (if built)**
* **Risk:** stalker/abuser uses "emergency" flow to obtain guardian/medical info.
* **Mitigation:** default off; only minimal fields (e.g. one callback number relay, not the number itself, by default); purpose confirmation; owner notification; per-device daily cap; no bulk; **no medical data in MVP** (R-9).
* **Detection:** repeated emergency releases on same device. **Recovery:** freeze feature per device.

### T19. Storage/content abuse — **M**
* **Risk:** malware/NSFW/illegal avatar uploads, EXIF location leaks, hotlink abuse.
* **Mitigation:** MIME/size limits, re-encode images (strip EXIF), per-user quotas, scan (ClamAV/`image moderation` later), private buckets for org documents, signed URLs.
* **Recovery:** admin takedown + hash blocklist.

### T20. Supply chain & secrets — **M**
* **Mitigation:** lockfile + `npm audit`/Dependabot, pinned Actions by SHA, secrets only in host env, secret scanning in CI, rotate on staff change; never ship `.env` in ZIPs (V5 incident); SBOM at release.

### T21. Denial of service on the tap path — **M**
* **Risk:** tap storms (events), targeted flood, expensive RPC per request (V5's `get_public_tap` also called `expire_tap_cards()` per request).
* **Mitigation:** edge cache ≤ 30 s; DB function cheap & read-only; move state expiry to a scheduled sweeper (not per-request writes); load test (target 200 rps resolve, p95 < 300 ms server); circuit breaker → static "temporarily unavailable" page; CDN stale-while-error.

### T22. AI agent overreach or compromise — **H**
* **Risk:** a coding/release/security agent (or a prompt-injected one) merges, deploys, leaks secrets or deletes data.
* **Mitigation:** technical boundaries in doc 14 §3.9 (separate identities, no production credentials, branch/environment protection, no delete/approve for any agent); pre-send secret filter for the AI reviewer; the AI audit trail.
* **Detection:** agent actions outside scope in the audit trail; unexpected pushes or deploy attempts.
* **Recovery:** **K19** disable the agent identity; revert; review the audit trail.

### T23. Operating-layer (SHYGON Control) compromise — **H**
* **Risk:** an attacker reads incident, security-posture or decision records (a roadmap of weaknesses), or abuses switch-request credentials.
* **Mitigation:** separate project; staff-only with MFA; no customer PII; scoped credentials that can only call the switch RPCs; `restricted` incidents mirrored out-of-band; its own append-only audit.
* **Detection:** ops-login anomalies; switch requests without an incident/DEC.
* **Recovery:** revoke scoped credentials; restore from its own backups.

> **P0 response for every threat in this document follows doc 13:** the entry criteria (§5), containment switches (§7) and playbooks PB-1…PB-11 (§8). The "Recovery" lines above are the domain-specific part of those playbooks.

## 2. Security requirements by phase (entry gates)

| Phase | Must be true before merge to production |
|---|---|
| 0 | F1–F6 closed with regression tests; CI green from empty DB; secrets rotated; MFA on admin |
| 1 | Resolver rate-limits + cache; verified-phone flow; column-guard matrix; public-payload snapshot test |
| 2 | Consent ledger + revocation tests; guardian/minor defaults reviewed by counsel; connect abuse limits |
| 3 | Rescue threat model signed off; abuse tooling for admins; external pen-test of public endpoints |
| 4 | Tenant isolation matrix in CI; org verification workflow; SSO/MFA for org admins |
| 5 | Access policy engine review + independent pen-test; SDM hardware; incident runbooks |

## 3. Logging & monitoring requirements
Security events (auth failures, role changes, consent grants/revocations, device state changes, admin actions, policy denials) go to the append-only audit log **and** an alerting sink; retain ≥ 2 years; PII-minimal; tamper-evidence via periodic hash anchoring (Phase 5); on-call runbooks per threat (T1…T21).
