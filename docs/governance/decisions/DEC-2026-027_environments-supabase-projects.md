# DEC-2026-027: Staging and Control environments vs "no additional Supabase project"

| Field | Value |
|---|---|
| Domain / Level | Architecture / infrastructure / L2 (L3 if it holds production data copies) |
| **Accountable Owner** | Principal Architect: **UNASSIGNED — HUMAN ACTION REQUIRED** |
| Consulted | Release Owner, Security Owner, Data Owner, Product Owner (cost) |
| State | **PROPOSED — HUMAN DECISION REQUIRED** |
| Priority | I2 U1 Irr1 R2 = 6 → P2 · matrix P1 · **P1** · before M1.11 / G2 |

**Question:** Where do staging and the SHYGON Control plane run, given the owner constraint "Do not create another Supabase project"?

**Conflicts (OBSERVED):**
- **doc 12 §4.10:** environments are `local`, `staging (separate Supabase project + Netlify site, Razorpay test keys)` and `production`.
- **doc 12 M1.13:** migrations apply to staging automatically, then to production after approval.
- **doc 13 §10.1 and doc 14 §2:** SHYGON Control lives in a **separate Supabase project** (`shygon-ops`), so incident tooling survives a product outage.
- **The owner brief (2026-10-02) says:** "Do not create another Supabase project" and "Do not create a replacement Supabase project".

**Options:**
- **A, no new projects.**
  - Staging is local PGlite on the live baseline, plus Netlify deploy previews against **local or mock** backends.
  - Control stays repository and CI based (O0/O1) with external paging. No Control project until later.
  - Integration and drill tests (K1–K8, the restore drill) can't run against a real Supabase. **The G2 evidence would be weaker.**
- **B, Supabase branching** (preview branches of the existing project, if the plan supports it). Arguably not "another project".
  - Gives a real staging database. Cost and plan to confirm.
- **C, approved exception:** one staging project (test keys, no production data), plus the Control project at G3. This is the approved-document position.
- **D, hybrid:** B for staging now; the Control project is decided at G3.

**Impact:**
- Security: drills and canaries need a real environment.
- Operations: the M1.13 pipeline design.
- Cost: B and C cost money.
- Irreversible? No.

**Decision:** ________ **Approved by:** ________ **Date:** ________
