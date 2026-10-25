# BQ-1 production baseline reconciliation (V6-106), 2026-10-25

| | |
|---|---|
| Decision | DEC-2026-041 BQ-1 (approved 2026-10-24, built locally as migration 035, `b04a72d`) |
| Backlog | V6-106 (production drift) |
| Owner | Session A (backend) |
| Status | **PROPOSED.** A production variant is prepared and verified against production evidence of 2026-10-18. Nothing was run against production, and no fresh capture exists yet. **Release BLOCKED.** |

Evidence labels follow DEC-2026-041: OBSERVED (seen on production by the owner, read-only), INFERRED (derived from observed evidence), PROPOSED, APPROVED.

## 1. Starting point [OBSERVED]
- Branch `v6/aaroh-backend`, HEAD `b04a72d`, clean working tree.
- `supabase/migrations/035_public_profile_respects_mode.sql` and AAROH-API v0.9 are present.
- Migrations on this branch: 020–026, 028–035 (027 held aside, DEC-2026-037).

## 2. Production evidence

### 2.1 What was available
- **No fresh capture exists.** The approved procedure is read-only and human-run: the owner runs the `VERIFY-LIVE-*` query packs or a schema-only dump (DEC-2026-023) and shares the result.
  - Session A may not use production credentials (master directive).
  - Session A therefore did not connect to production and did not capture anything from it.
- **The latest genuine production evidence is from 2026-10-18.** It is held in `../shygon-tap-v5-web-rebaseline/docs/governance/evidence/` (another session's worktree, not yet committed there).
  - **The migration record** [OBSERVED]. `2026-10-18_production-schema-migrations.csv` holds the owner's read-only export of production's `supabase_migrations.schema_migrations`: seven migrations after the 2026-09-30 capture, with their recorded SQL.
    - sha256 `a9fd38c7791c54e253413a7f366efc6f9b15451b245d96ed85e11236d2a87bce`. Re-verified 2026-10-25, and the same as recorded there.
    - Copied byte for byte to `docs/governance/evidence/` on this branch, so the test is reproducible.
  - **The match** [OBSERVED]. On 2026-10-18 the owner's `VERIFY-LIVE-DRIFT.sql` results matched a replay of those seven migrations on the 2026-09-30 baseline: 44 of 44 changed objects, all seven function bodies equal by hash (carriage returns removed), and the same privileges.
- **The 2026-09-30 baseline** is `supabase/baseline/000_live_baseline.sql`, sha256 `c12b46eba81e1102f568339f10e6892c3d000282c8cefda7caf8fd9a99a50655`. This equals the copy kept in the rebaseline worktree.

### 2.2 Production's `get_public_profile` [INFERRED from OBSERVED evidence]
Rebuilt in isolated in-memory PGlite: the baseline, a test-only Storage stand-in, then the seven recorded migrations in order. Nothing connected anywhere.

| Attribute | 2026-09-30 baseline | Production (evidence of 2026-10-18) |
|---|---|---|
| Body md5 (CRs removed) | `acbaff4f0fb3014a0a080cbf15267cd9` | `4a70098823695f40395d7c32439ffc98` |
| Body md5 (as recorded) | the same | `23626166ad63ad3a04424323dc27ec85` (the recorded SQL has CRLF line endings) |
| Signature | `(p_slug text) → jsonb` | same |
| Language, volatility | plpgsql, STABLE | same |
| Security | SECURITY DEFINER, `search_path = public, pg_temp` | same |
| Owner | postgres | same |
| EXECUTE grants | postgres, anon, service_role | same |
| Calls | `canonical_experience`, `tap_event_theme_for`, `theme_options`, `tier_rank`, `user_has_pass`, `user_max_ui_tier` | the same, plus **`tier_buttons`** |
| Reads | `tap_profiles`, `entitlements` | same |
| Last changed by | the baseline | `20261011100305 rerun_admin_create_tap_page_repeatable` |

The body changed in three places:
1. Production computes `v_shown` after `v_clamp` and shows the page tier's own buttons:
   - before: `v_owned || ARRAY['phone','email']`
   - production: `v_owned || public.tier_buttons(v_clamp)`
2. The payload has a new key, `'pageTemplate', v_tap.page_template`.
3. There are two new comments (the "024: the page's own tier…" lineage line and the event-styling note).

**The guard's anchor `IF NOT FOUND THEN RETURN NULL; END IF;` occurs exactly once in production's body,** at the same place as in the baseline.

### 2.3 Why `migrations/035` must not go to production
- It is generated from the baseline body. Applied to production, it would replace production's body with the baseline's plus the guard.
- That would silently remove `pageTemplate` and the `tier_buttons` term. The negative control in §4 shows it: 15 of 20 fixture slugs change.

## 3. The proposal [PROPOSED]
`supabase/proposed/035_public_profile_respects_mode.production.sql`. It is generated from the rebuilt definition (nothing retyped) and lives in `supabase/proposed/`, so neither `db:push` nor `APPLY_ALL.sql` can run it.

### 3.1 The change
Production's body plus the same single guard as `migrations/035`, after the Tap lookup:
```sql
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- BQ-1 (migration 035, DEC-2026-041): while the Tap shows another mode
  -- (Info), its Business profile is not public through this reader either.
  IF EXISTS (SELECT 1 FROM public.tap_mode_state s
             WHERE s.tap_profile_id = v_tap.id AND s.active_mode <> 'business') THEN
    RETURN NULL;
  END IF;
```
- **Unchanged:** signature, return type, language, volatility, SECURITY DEFINER, `search_path`, owner and grants.
- **No GRANT or REVOKE.** `CREATE OR REPLACE` keeps the function's privileges.
- **Body hash** after the change: `d267acb378c604576f950c3da651faa1`.

### 3.2 Protection against unrelated drift
- **A pre-check, in the same transaction, refuses to run unless:**
  - the body is the captured production one, or already the forward one (a re-run);
  - the function is SECURITY DEFINER, with `search_path = public, pg_temp` and owner postgres;
  - `public.tap_mode_state` exists, meaning 034 was applied first.
- On any other body it raises an error and changes nothing. It never overwrites drift it was not written for.
- **VERIFY ON LIVE** queries in the header give every field to compare by hand first.

### 3.3 Rollback
- The ROLLBACK block is the full captured production definition. The test checks it against the replay.
- It restores the body, every attribute and the grants (§4).
- **Carriage returns:** the comparisons ignore them, as the 2026-10-18 comparison did. The evidence cannot show whether the live body stores CRs, so a fresh capture should record both hashes.

### 3.4 Dependencies and order
- **Needs 034 only.** 034 applies directly on the production-equivalent database (probe, 2026-10-25).
- **The intended order on production is still the release track:**
  1. a fresh capture;
  2. the chain re-based on it (including 025, A19);
  3. 034;
  4. this file, as migration 035.
- At adoption, this body becomes `migrations/035` and the baseline-derived file is retired with the old baseline.

## 4. Verification

### 4.1 Executed (2026-10-25, Node 20.18.0, isolated PGlite, outbound network denied)
`npm run test:bq1-production` (`supabase/tests/bq1-production.mjs`, now in `ci` and `ci.yml`): **13 passed, 0 failed.**

| # | Check | Result |
|---|---|---|
| 1 | The evidence file's sha256; seven recorded migrations; the replay gives body `4a700988…`; the anchor occurs once; production drift present | PASS |
| 2 | The proposal's pre-check names both hashes and the evidence checksum; no GRANT or REVOKE; its ROLLBACK equals the captured `pg_get_functiondef` | PASS |
| 3 | Refuses without 034; the body is unchanged | PASS |
| 4 | Refuses on another body (the repository baseline + 034); the body is unchanged | PASS |
| 5 | After applying: the body is production's plus exactly the guard; owner, SECURITY DEFINER, `search_path`, volatility, signature and grants unchanged | PASS |
| 6 | Every other function (107), table grant (835) and policy (64) is unchanged | PASS |
| 7 | Business and no-state Taps: 20 slugs (15 with a payload, including page and card families) byte-identical; `pageTemplate` kept | PASS |
| 8 | Info live: the legacy reader returns null; `get_public_tap_state` still answers `active`; other Taps unchanged | PASS |
| 9 | Kill switch (Info off in the catalogue): still null | PASS |
| 10 | Back to Business: byte-identical payload | PASS |
| 11 | Re-run: accepted; nothing changes | PASS |
| 12 | ROLLBACK: the definition, attributes, grants, every other object and every output equal the capture | PASS |
| 13 | Negative control: `migrations/035` on production would change 15 slugs and drop `pageTemplate` | PASS |

The existing gates, re-run after these changes, are in readiness report §17.

### 4.2 Not performed
- **A fresh production capture**, and any read of production since 2026-10-18. This needs the owner and production credentials.
- **Any run on production, a hosted project or a preview.** None was attempted.
- **The admin-contract gate on the production variant.**
  - That gate compares the repository baseline with the migrations, so its keyed text is the baseline's.
  - `test:bq1-production` does the equivalent for production: exactly one approved edit, everything else unchanged.
  - The admin-contract gate itself is re-keyed when the baseline is re-captured (V6-106; F-4 notes the same for 025).
- **Callers on production.** The second application on www.shygontech.com (V6-107) is not known to call `get_public_profile`; that was not verified.
- **PostgreSQL 17.6.** Production runs 17.6 and PGlite is 18.3. Nothing version-specific is used.

## 5. Remaining risks and approvals
- **R-1: production may have changed since 2026-10-18.**
  - Mitigation: the pre-check refuses any other body, and the fresh capture comes first.
  - **Human:** the owner runs the VERIFY ON LIVE queries, or a schema-only dump, and shares the result.
- **R-2: the rest of the chain.** 025 still needs re-basing (F-4, A19). The production variant does not resolve the bundle.
- **R-3: CRs.** Whether the live body stores CRs is unknown. Behaviour is unaffected; only a byte comparison of the raw body would differ.
- **Approvals still required before any production use:**
  - DEC-2026-018 L3 cool-off and checklist;
  - the owner's approval of this production text after the capture;
  - the release gates (P1, hosted P2, G1–G7, G10, G13 and G14).
- **Info stays OFF in the catalogue** until the owner switches it on per environment.

**Release status: BLOCKED.** Nothing pushed, applied, deployed or switched on.
