# Release handoff — <release / PR> (G§44)

Required for every production deploy of an L2/L3 change and every P0 fix.
Flow: Engineering → QA → Security (if L3) → Release Owner → Deploy → **Verification**

| Field | Value |
|---|---|
| Release / PR / commit SHA | |
| P0 ID (if incident fix) / DEC ID | |
| Risk level (risk engine) and any override reason | |
| Problem | |
| Containment in place (if incident) | |
| Proposed change | |
| Blast radius (components / journeys) | |
| Risk | |
| Rollback plan (specific: deploy id / flag / migration expand-only / rollback SQL) | |
| Testing (CI run link, staging evidence) | |
| Security status (Security Owner sign-off for L3) | |
| Data status (migrations applied to staging copy? row checks?) | |
| Approvals (role — name — time) | |
| Deploy window | |
| Verification plan (which function, how, by whom) | |
| Post-deploy watch window result (15 min / 30 min for L3) | |
| Verified by / time | |
