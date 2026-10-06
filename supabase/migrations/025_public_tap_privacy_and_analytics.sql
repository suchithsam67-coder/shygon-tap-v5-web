-- 025: the public Tap's privacy and analytics hardening (V6 Stage 3).
--   a) the unused legacy reader get_public_tap() is no longer callable by
--      visitors (V6-071);
--   b) Tap analytics hash visitors with a random daily salt instead of a bare
--      MD5 of their IP address and browser (V6-073);
--   c) Tap analytics count a repeated event once and cap one visitor's events
--      per Tap (V6-032);
--   d) a Tap owner can hide their phone number or email address from the
--      public Tap without deleting it (V6-071).
--
-- Decision:  DEC-2026-035 (SHYGON V6; backlog V6-071, V6-073 and V6-032,
--            approved with the Stage 1 audit on 2026-10-05; privacy = hardening;
--            migration numbering N-1). Stage 3 run authorized by the owner on
--            2026-10-06 ("complete software").
-- Level:     L3 (a function grant, two function bodies, a new table). Under
--            DEC-2026-018 it needs a 24-hour cool-off plus the checklist review
--            before it is approved or applied. Never applied by tooling to
--            production.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-024.
--            record_tap_event and enforce_tap_edit_rules below are the LIVE
--            bodies with exactly two and one replacements
--            (supabase/tests/admin-contract.mjs proves it).
-- Data:      none changed. tap_events rows written before this keep their old
--            MD5 hashes; the day this is applied may count a returning visitor
--            twice in "unique visitors".
--
-- THE PROBLEMS (live baseline; Stage 3 review)
--   1. get_public_tap(text) is EXECUTE-granted to anon and authenticated. The
--      app reads the public Tap through get_public_profile(text) only; nothing
--      in this repository calls get_public_tap. It still answers anyone, and
--      it is older and looser than get_public_profile: it returns `location`
--      whether or not the owner switched it on or owns the Location add-on.
--      CONFIRMED on the live baseline (supabase/tests/public-tap.mjs): for an
--      active Tap with an address and Location off, anon gets the address from
--      get_public_tap and null from get_public_profile. (A paused Tap is not
--      exposed: trg_tap_profiles_00_status keeps `published` false.)
--   2. record_tap_event stores visitor_hash = md5(user agent | IP | date). With
--      no secret in it, anyone holding the hash can recover the IP address by
--      trying every IPv4 address with common user agents.
--   3. record_tap_event writes every call. One script can inflate a Tap's
--      view and click counts without limit.
--   4. The owner cannot hide their phone or email. get_public_profile shows a
--      contact only when it is in enabled_customizations, but the trigger
--      enforce_tap_edit_rules adds 'phone' and 'email' back to that list on
--      every update the owner makes. The only way to keep a number off the
--      public page is to delete it from the Tap.
--
-- THE FIX
--   1. REVOKE EXECUTE on get_public_tap(text) FROM anon, authenticated.
--      service_role keeps it. The function body is unchanged.
--   2. public.tap_visitor_salts(day PK, salt): one random salt per UTC day, RLS
--      on, no policies, no anon/authenticated grant. record_tap_event hashes
--      sha256(salt | user agent | IP) and deletes salts older than yesterday,
--      so yesterday's hashes can no longer be recomputed by anyone.
--   3. record_tap_event skips an event identical to one the same visitor sent
--      on the same Tap in the last 10 seconds, and any event once that visitor
--      has 60 on that Tap in the last hour. A new index serves both checks.
--   4. enforce_tap_edit_rules keeps the owner's list as given. It still refuses
--      an add-on that was not bought (phone and email need none), and nothing
--      else in it changes. get_public_profile already withholds any contact not
--      on the list, so the public page follows the owner's switch.
--   Signatures, grants, SECURITY DEFINER and search_path are unchanged.
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT md5(prosrc) FROM pg_proc
--    WHERE oid = 'public.record_tap_event(text,text,text)'::regprocedure;
--                                         -- must match the baseline body
--   SELECT has_function_privilege('anon', 'public.get_public_tap(text)', 'EXECUTE');
--                                         -- true (to be revoked)
--   SELECT md5(prosrc) FROM pg_proc
--    WHERE oid = 'public.enforce_tap_edit_rules()'::regprocedure; -- must match the baseline body
--   SELECT to_regclass('public.tap_visitor_salts');             -- NULL (not created yet)
--   Whether any external client (the admin APK) calls get_public_tap: check
--   the API logs for /rest/v1/rpc/get_public_tap before applying.
--
-- ROLLBACK (begin)
-- CREATE OR REPLACE FUNCTION public.record_tap_event(p_slug text, p_event text, p_link_key text DEFAULT NULL::text) RETURNS void
--     LANGUAGE plpgsql SECURITY DEFINER
--     SET search_path TO 'public', 'pg_temp'
--     AS $$
-- DECLARE
--   v_tap_id  UUID;
--   v_headers JSON;
--   v_ua      TEXT;
--   v_ip      TEXT;
--   v_ref     TEXT;
-- BEGIN
--   IF p_event NOT IN ('view', 'nfc', 'qr', 'link_click') THEN
--     RETURN;
--   END IF;
--
--   SELECT t.id INTO v_tap_id
--   FROM public.tap_profiles t
--   WHERE lower(t.slug) = lower(btrim(p_slug))
--     AND t.published IS TRUE
--     AND t.suspended_at IS NULL
--   LIMIT 1;
--
--   IF v_tap_id IS NULL THEN
--     RETURN;
--   END IF;
--
--   BEGIN
--     v_headers := current_setting('request.headers', true)::json;
--     v_ua  := v_headers ->> 'user-agent';
--     v_ip  := split_part(COALESCE(v_headers ->> 'x-forwarded-for', ''), ',', 1);
--     v_ref := v_headers ->> 'referer';
--   EXCEPTION WHEN OTHERS THEN
--     v_ua := NULL; v_ip := NULL; v_ref := NULL;
--   END;
--
--   INSERT INTO public.tap_events
--     (tap_profile_id, event_type, link_key, visitor_hash, referrer_host)
--   VALUES (
--     v_tap_id,
--     p_event,
--     left(NULLIF(btrim(COALESCE(p_link_key, '')), ''), 48),
--     md5(COALESCE(v_ua, '') || '|' || COALESCE(v_ip, '') || '|' ||
--         to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD')),
--     left(NULLIF(split_part(split_part(COALESCE(v_ref, ''), '://', 2), '/', 1), ''), 128)
--   );
-- END;
-- $$;
-- CREATE OR REPLACE FUNCTION public.enforce_tap_edit_rules() RETURNS trigger
--     LANGUAGE plpgsql SECURITY DEFINER
--     SET search_path TO 'public', 'pg_temp'
--     AS $$ DECLARE v_tier TEXT;v_pass BOOLEAN;v_owned TEXT[];v_content BOOLEAN; BEGIN IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() THEN RETURN NEW; END IF; v_tier:=public.user_max_ui_tier(NEW.user_id); v_pass:=public.user_has_pass(NEW.user_id); NEW.enabled_customizations:=ARRAY(SELECT DISTINCT value FROM unnest(COALESCE(NEW.enabled_customizations,'{}'::text[]) || ARRAY['phone','email']) AS u(value) WHERE value<>'' ORDER BY value); IF public.tier_rank(NEW.selected_ui_tier)>public.tier_rank(v_tier) THEN RAISE EXCEPTION 'You have not purchased the % experience.',NEW.selected_ui_tier USING ERRCODE='42501'; END IF; IF NEW.theme_palette<>ALL(public.theme_options('palette',v_tier,v_pass)) THEN RAISE EXCEPTION 'That colour palette is not unlocked on your plan.' USING ERRCODE='42501'; END IF; IF NEW.theme_layout<>ALL(public.theme_options('layout',v_tier,v_pass)) THEN RAISE EXCEPTION 'That layout is not unlocked on your plan.' USING ERRCODE='42501'; END IF; IF NEW.theme_buttons<>ALL(public.theme_options('buttons',v_tier,v_pass)) THEN RAISE EXCEPTION 'That button style is not unlocked on your plan.' USING ERRCODE='42501'; END IF; IF NEW.theme_font<>ALL(public.theme_options('font',v_tier,v_pass)) THEN RAISE EXCEPTION 'That font is not unlocked on your plan.' USING ERRCODE='42501'; END IF; IF NEW.theme_animation<>ALL(public.theme_options('animation',v_tier,v_pass)) THEN RAISE EXCEPTION 'That animation style is not unlocked on your plan.' USING ERRCODE='42501'; END IF; SELECT COALESCE(array_agg(e.key),'{}') INTO v_owned FROM public.entitlements e WHERE e.user_id=NEW.user_id AND e.is_active AND e.type='customization'; IF EXISTS(SELECT 1 FROM unnest(NEW.enabled_customizations) AS k(key) WHERE k.key<>ALL(v_owned||ARRAY['phone','email'])) THEN RAISE EXCEPTION 'That add-on has not been purchased.' USING ERRCODE='42501'; END IF; v_content:=NEW.display_name IS DISTINCT FROM OLD.display_name OR NEW.headline IS DISTINCT FROM OLD.headline OR NEW.designation IS DISTINCT FROM OLD.designation OR NEW.company IS DISTINCT FROM OLD.company OR NEW.bio IS DISTINCT FROM OLD.bio OR NEW.avatar_url IS DISTINCT FROM OLD.avatar_url OR NEW.location IS DISTINCT FROM OLD.location OR NEW.phone IS DISTINCT FROM OLD.phone OR NEW.whatsapp IS DISTINCT FROM OLD.whatsapp OR NEW.email IS DISTINCT FROM OLD.email OR NEW.website IS DISTINCT FROM OLD.website OR NEW.instagram IS DISTINCT FROM OLD.instagram OR NEW.linkedin IS DISTINCT FROM OLD.linkedin OR NEW.youtube IS DISTINCT FROM OLD.youtube OR NEW.custom_links IS DISTINCT FROM OLD.custom_links OR NEW.theme_palette IS DISTINCT FROM OLD.theme_palette OR NEW.theme_layout IS DISTINCT FROM OLD.theme_layout OR NEW.theme_buttons IS DISTINCT FROM OLD.theme_buttons OR NEW.theme_font IS DISTINCT FROM OLD.theme_font OR NEW.theme_animation IS DISTINCT FROM OLD.theme_animation OR (NEW.slug IS DISTINCT FROM OLD.slug AND OLD.slug IS NOT NULL); IF NOT v_content THEN RETURN NEW; END IF; IF NOT public.tap_can_edit(NEW.user_id) THEN RAISE EXCEPTION 'You can change your Tap once every % days. The Customization Pass removes the limit.',public.tap_edit_interval_days() USING ERRCODE='42501'; END IF; NEW.last_content_edit_at:=NOW(); RETURN NEW; END; $$;
-- GRANT ALL ON FUNCTION public.get_public_tap(text) TO anon;
-- GRANT ALL ON FUNCTION public.get_public_tap(text) TO authenticated;
-- DROP INDEX IF EXISTS public.idx_tap_events_profile_visitor_time;
-- DROP TABLE IF EXISTS public.tap_visitor_salts;
-- ROLLBACK (end)
--   The block restores both live bodies exactly, gives get_public_tap back to the
--   API roles, and drops the salt table and index; supabase/tests/
--   migration-rollbacks.mjs runs it and compares the catalogue.
--
-- Idempotent: safe to run more than once.

-- 1. The legacy public reader: server only -------------------------------------
REVOKE ALL ON FUNCTION public.get_public_tap(text) FROM anon;
REVOKE ALL ON FUNCTION public.get_public_tap(text) FROM authenticated;

-- 2. Daily visitor salts ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tap_visitor_salts (
  day  date PRIMARY KEY,
  salt text NOT NULL
);

ALTER TABLE public.tap_visitor_salts ENABLE ROW LEVEL SECURITY;

-- No policies on purpose. Supabase's default privileges grant new tables to the
-- API roles, so take that back explicitly; only record_tap_event (SECURITY
-- DEFINER) reads and writes it.
REVOKE ALL ON TABLE public.tap_visitor_salts FROM PUBLIC;
REVOKE ALL ON TABLE public.tap_visitor_salts FROM anon, authenticated;
GRANT ALL ON TABLE public.tap_visitor_salts TO service_role;

COMMENT ON TABLE public.tap_visitor_salts IS
  'One random salt per UTC day for Tap visitor hashes (V6-073, migration 025). Deleted after two days. Never exposed.';

-- 3. The dedupe and rate-limit lookups ----------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tap_events_profile_visitor_time
  ON public.tap_events USING btree (tap_profile_id, visitor_hash, occurred_at DESC);

-- 4. record_tap_event: the live body, salted hash + dedupe + cap ---------------------
CREATE OR REPLACE FUNCTION public.record_tap_event(p_slug text, p_event text, p_link_key text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_tap_id  UUID;
  v_headers JSON;
  v_ua      TEXT;
  v_ip      TEXT;
  v_ref     TEXT;
  v_day     DATE;
  v_salt    TEXT;
  v_hash    TEXT;
  v_link    TEXT;
BEGIN
  IF p_event NOT IN ('view', 'nfc', 'qr', 'link_click') THEN
    RETURN;
  END IF;

  SELECT t.id INTO v_tap_id
  FROM public.tap_profiles t
  WHERE lower(t.slug) = lower(btrim(p_slug))
    AND t.published IS TRUE
    AND t.suspended_at IS NULL
  LIMIT 1;

  IF v_tap_id IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    v_headers := current_setting('request.headers', true)::json;
    v_ua  := v_headers ->> 'user-agent';
    v_ip  := split_part(COALESCE(v_headers ->> 'x-forwarded-for', ''), ',', 1);
    v_ref := v_headers ->> 'referer';
  EXCEPTION WHEN OTHERS THEN
    v_ua := NULL; v_ip := NULL; v_ref := NULL;
  END;

  -- V6-073: the visitor hash is salted with a random value per UTC day. The
  -- salt never leaves the database and is deleted after two days, so a hash
  -- cannot be reversed to an IP address and user agent by brute force, nor
  -- linked across days. Unique visitors per day still count correctly.
  v_day := (NOW() AT TIME ZONE 'UTC')::date;
  INSERT INTO public.tap_visitor_salts (day, salt)
  VALUES (v_day, md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text))
  ON CONFLICT (day) DO NOTHING;
  SELECT s.salt INTO v_salt FROM public.tap_visitor_salts s WHERE s.day = v_day;
  DELETE FROM public.tap_visitor_salts WHERE day < v_day - 1;
  v_hash := encode(sha256(convert_to(
    v_salt || '|' || COALESCE(v_ua, '') || '|' || COALESCE(v_ip, ''), 'UTF8')), 'hex');
  v_link := left(NULLIF(btrim(COALESCE(p_link_key, '')), ''), 48);

  -- V6-032: the same visitor sending the same event within 10 seconds counts
  -- once (double taps, reloads), and no visitor records more than 60 events
  -- on one Tap in an hour. Both read idx_tap_events_profile_visitor_time.
  IF EXISTS (
       SELECT 1 FROM public.tap_events e
       WHERE e.tap_profile_id = v_tap_id AND e.visitor_hash = v_hash
         AND e.event_type = p_event AND e.link_key IS NOT DISTINCT FROM v_link
         AND e.occurred_at > NOW() - INTERVAL '10 seconds')
     OR (SELECT count(*) FROM public.tap_events e
         WHERE e.tap_profile_id = v_tap_id AND e.visitor_hash = v_hash
           AND e.occurred_at > NOW() - INTERVAL '1 hour') >= 60 THEN
    RETURN;
  END IF;

  INSERT INTO public.tap_events
    (tap_profile_id, event_type, link_key, visitor_hash, referrer_host)
  VALUES (
    v_tap_id,
    p_event,
    v_link,
    v_hash,
    left(NULLIF(split_part(split_part(COALESCE(v_ref, ''), '://', 2), '/', 1), ''), 128)
  );
END;
$$;


-- 5. enforce_tap_edit_rules: the live body, without forcing phone and email on --------
CREATE OR REPLACE FUNCTION public.enforce_tap_edit_rules() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ DECLARE v_tier TEXT;v_pass BOOLEAN;v_owned TEXT[];v_content BOOLEAN; BEGIN IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() THEN RETURN NEW; END IF; v_tier:=public.user_max_ui_tier(NEW.user_id); v_pass:=public.user_has_pass(NEW.user_id); NEW.enabled_customizations:=ARRAY(SELECT DISTINCT value FROM unnest(COALESCE(NEW.enabled_customizations,'{}'::text[])) AS u(value) WHERE value<>'' ORDER BY value); IF public.tier_rank(NEW.selected_ui_tier)>public.tier_rank(v_tier) THEN RAISE EXCEPTION 'You have not purchased the % experience.',NEW.selected_ui_tier USING ERRCODE='42501'; END IF; IF NEW.theme_palette<>ALL(public.theme_options('palette',v_tier,v_pass)) THEN RAISE EXCEPTION 'That colour palette is not unlocked on your plan.' USING ERRCODE='42501'; END IF; IF NEW.theme_layout<>ALL(public.theme_options('layout',v_tier,v_pass)) THEN RAISE EXCEPTION 'That layout is not unlocked on your plan.' USING ERRCODE='42501'; END IF; IF NEW.theme_buttons<>ALL(public.theme_options('buttons',v_tier,v_pass)) THEN RAISE EXCEPTION 'That button style is not unlocked on your plan.' USING ERRCODE='42501'; END IF; IF NEW.theme_font<>ALL(public.theme_options('font',v_tier,v_pass)) THEN RAISE EXCEPTION 'That font is not unlocked on your plan.' USING ERRCODE='42501'; END IF; IF NEW.theme_animation<>ALL(public.theme_options('animation',v_tier,v_pass)) THEN RAISE EXCEPTION 'That animation style is not unlocked on your plan.' USING ERRCODE='42501'; END IF; SELECT COALESCE(array_agg(e.key),'{}') INTO v_owned FROM public.entitlements e WHERE e.user_id=NEW.user_id AND e.is_active AND e.type='customization'; IF EXISTS(SELECT 1 FROM unnest(NEW.enabled_customizations) AS k(key) WHERE k.key<>ALL(v_owned||ARRAY['phone','email'])) THEN RAISE EXCEPTION 'That add-on has not been purchased.' USING ERRCODE='42501'; END IF; v_content:=NEW.display_name IS DISTINCT FROM OLD.display_name OR NEW.headline IS DISTINCT FROM OLD.headline OR NEW.designation IS DISTINCT FROM OLD.designation OR NEW.company IS DISTINCT FROM OLD.company OR NEW.bio IS DISTINCT FROM OLD.bio OR NEW.avatar_url IS DISTINCT FROM OLD.avatar_url OR NEW.location IS DISTINCT FROM OLD.location OR NEW.phone IS DISTINCT FROM OLD.phone OR NEW.whatsapp IS DISTINCT FROM OLD.whatsapp OR NEW.email IS DISTINCT FROM OLD.email OR NEW.website IS DISTINCT FROM OLD.website OR NEW.instagram IS DISTINCT FROM OLD.instagram OR NEW.linkedin IS DISTINCT FROM OLD.linkedin OR NEW.youtube IS DISTINCT FROM OLD.youtube OR NEW.custom_links IS DISTINCT FROM OLD.custom_links OR NEW.theme_palette IS DISTINCT FROM OLD.theme_palette OR NEW.theme_layout IS DISTINCT FROM OLD.theme_layout OR NEW.theme_buttons IS DISTINCT FROM OLD.theme_buttons OR NEW.theme_font IS DISTINCT FROM OLD.theme_font OR NEW.theme_animation IS DISTINCT FROM OLD.theme_animation OR (NEW.slug IS DISTINCT FROM OLD.slug AND OLD.slug IS NOT NULL); IF NOT v_content THEN RETURN NEW; END IF; IF NOT public.tap_can_edit(NEW.user_id) THEN RAISE EXCEPTION 'You can change your Tap once every % days. The Customization Pass removes the limit.',public.tap_edit_interval_days() USING ERRCODE='42501'; END IF; NEW.last_content_edit_at:=NOW(); RETURN NEW; END; $$;

