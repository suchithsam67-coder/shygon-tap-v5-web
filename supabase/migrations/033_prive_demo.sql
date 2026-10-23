-- 033: SHYGON Privé, demo only: sample hotels owned by SHYGON, and guest
-- service requests that are really stored and progressed inside SHYGON, but
-- never reach, and are never presented as reaching, a real hotel.
--
-- Decision:  DEC-2026-038 Q6, changed to A by the owner on 2026-10-20
--            ("Privé demo-only: build the demo-only Privé (labelled sample
--            hotels, SHYGON-owned test data, no real hotel integrations)");
--            the 2026-10-19 briefs (a demo request "may be genuinely created
--            and updated inside the SHYGON demo environment, but it must never
--            be represented as having reached a real hotel"). The choices this
--            file makes are DEC-2026-040 Q1-Q5, APPROVED by the owner 2026-10-20
--            (in session). Approval of the design is not approval to apply:
--            see Level.
-- Level:     L3 (new tables, seed rows, privileged functions). DEC-2026-018
--            cool-off plus checklist review before approval or application.
--            Never applied by tooling.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-026,
--            028-032.
-- Data:      inserts three SAMPLE hotels (fictional, owned by SHYGON, every
--            row is_demo = true). Nothing else is read or changed.
--
-- MODEL
--   prive_demo_hotels          the sample catalogue. is_demo is always true
--                              (CHECK); each row carries its demo label.
--   prive_demo_requests        a signed-in account's demo service request at
--                              a sample hotel. is_demo always true (CHECK).
--   prive_demo_request_events  every step, by the guest or by the SHYGON demo
--                              simulator (append-only).
--   The "hotel" is a simulator inside SHYGON: received -> acknowledged (after
--   20 s) -> in progress (after 1 min) -> completed (after 3 min). There is no
--   hotel system behind it, and nothing here calls one.
--
-- RULES (supabase/tests/prive.mjs)
--   - Catalogue and requests are closed to every client role; the server
--     function /api/prive is the only way in.
--   - A request: signed-in account, a sample hotel, one of that hotel's
--     sample services; idempotency key; 10 per hour and 50 per day per
--     account; cancel while not completed.
--   - Retention: requests (with their events) deleted 30 days after creation;
--     the account cascade deletes them with the account.
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT to_regclass('public.prive_demo_hotels');   -- NULL
--
-- ROLLBACK (begin)
-- DROP FUNCTION IF EXISTS public.prive_demo_purge();
-- DROP FUNCTION IF EXISTS public.prive_demo_request_cancel(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.prive_demo_requests_for(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.prive_demo_request_create(uuid, text, text, text);
-- DROP FUNCTION IF EXISTS public.prive_demo_advance_due();
-- DROP FUNCTION IF EXISTS public.prive_demo_hotels_list();
-- DROP TABLE IF EXISTS public.prive_demo_request_events;
-- DROP TABLE IF EXISTS public.prive_demo_requests;
-- DROP TABLE IF EXISTS public.prive_demo_hotels;
-- ROLLBACK (end)
--
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS public.prive_demo_hotels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,40}$'),
  name        text NOT NULL CHECK (name LIKE 'SHYGON Demo %'),
  city        text NOT NULL,
  description text NOT NULL,
  services    jsonb NOT NULL,
  is_demo     boolean NOT NULL DEFAULT true CHECK (is_demo),
  demo_label  text NOT NULL DEFAULT 'Sample hotel (demo). Not a real property.',
  sort_order  integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.prive_demo_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hotel_id        uuid NOT NULL REFERENCES public.prive_demo_hotels(id) ON DELETE CASCADE,
  service         text NOT NULL,
  status          text NOT NULL DEFAULT 'received'
                  CHECK (status IN ('received', 'acknowledged', 'in_progress', 'completed', 'cancelled')),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  is_demo         boolean NOT NULL DEFAULT true CHECK (is_demo),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  cancelled_at    timestamptz,
  CONSTRAINT prive_demo_requests_idempotent UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_prive_demo_requests_user ON public.prive_demo_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prive_demo_requests_open ON public.prive_demo_requests (status, updated_at)
  WHERE status IN ('received', 'acknowledged', 'in_progress');

CREATE TABLE IF NOT EXISTS public.prive_demo_request_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.prive_demo_requests(id) ON DELETE CASCADE,
  status     text NOT NULL,
  actor      text NOT NULL CHECK (actor IN ('guest', 'demo_hotel_simulator')),
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prive_demo_events_request ON public.prive_demo_request_events (request_id, at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['prive_demo_hotels', 'prive_demo_requests', 'prive_demo_request_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
  END LOOP;
  REVOKE UPDATE, DELETE, TRUNCATE ON public.prive_demo_request_events FROM service_role;
END $$;

-- The sample catalogue: fictional properties owned by SHYGON. The first one and
-- its services match the frontend's walkthrough ("SHYGON Demo Residence").
INSERT INTO public.prive_demo_hotels (slug, name, city, description, services, sort_order) VALUES
  ('demo-residence', 'SHYGON Demo Residence', 'Sample city',
   'A sample hotel for trying SHYGON Privé. Not a real property; nothing here reaches a hotel.',
   '[{"id":"fresh_towels","label":"Fresh towels"},{"id":"housekeeping","label":"Housekeeping"},{"id":"late_checkout","label":"Late check-out"},{"id":"restaurant_table","label":"A table at the restaurant"}]', 1),
  ('demo-seaside', 'SHYGON Demo Seaside', 'Sample coast',
   'A sample beach hotel for trying SHYGON Privé. Not a real property; nothing here reaches a hotel.',
   '[{"id":"fresh_towels","label":"Fresh towels"},{"id":"room_service","label":"Room service"},{"id":"airport_transfer","label":"Airport transfer"}]', 2),
  ('demo-hills', 'SHYGON Demo Hills', 'Sample hills',
   'A sample hill retreat for trying SHYGON Privé. Not a real property; nothing here reaches a hotel.',
   '[{"id":"housekeeping","label":"Housekeeping"},{"id":"spa","label":"A spa slot"},{"id":"late_checkout","label":"Late check-out"}]', 3)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prive_demo_hotels_list()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'slug', h.slug, 'name', h.name, 'city', h.city, 'description', h.description,
    'services', h.services, 'demo', h.is_demo, 'label', h.demo_label) ORDER BY h.sort_order), '[]'::jsonb)
  FROM public.prive_demo_hotels h;
$$;

-- The SHYGON demo "hotel desk": moves each open request one step when its time
-- comes. Called by the sweep and before every read, so it also works without a
-- schedule.
CREATE OR REPLACE FUNCTION public.prive_demo_advance_due()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE r record; v_next text; v_n integer := 0;
BEGIN
  FOR r IN
    SELECT id, status, created_at FROM public.prive_demo_requests
     WHERE status IN ('received', 'acknowledged', 'in_progress')
     FOR UPDATE SKIP LOCKED
  LOOP
    v_next := CASE
      WHEN r.status = 'received' AND r.created_at <= now() - interval '20 seconds' THEN 'acknowledged'
      WHEN r.status = 'acknowledged' AND r.created_at <= now() - interval '1 minute' THEN 'in_progress'
      WHEN r.status = 'in_progress' AND r.created_at <= now() - interval '3 minutes' THEN 'completed'
    END;
    CONTINUE WHEN v_next IS NULL;
    UPDATE public.prive_demo_requests
       SET status = v_next, updated_at = now(), completed_at = CASE WHEN v_next = 'completed' THEN now() END
     WHERE id = r.id;
    INSERT INTO public.prive_demo_request_events (request_id, status, actor) VALUES (r.id, v_next, 'demo_hotel_simulator');
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- Returns {ok, requestId, replayed} or {ok:false, code, retryAfter?}.
CREATE OR REPLACE FUNCTION public.prive_demo_request_create(p_user uuid, p_hotel_slug text, p_service text, p_idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_hotel public.prive_demo_hotels; v_r public.prive_demo_requests;
BEGIN
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{16,64}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('prive:' || p_user::text, 0));
  SELECT * INTO v_r FROM public.prive_demo_requests WHERE user_id = p_user AND idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN jsonb_build_object('ok', true, 'requestId', v_r.id, 'replayed', true); END IF;

  SELECT * INTO v_hotel FROM public.prive_demo_hotels WHERE slug = lower(btrim(COALESCE(p_hotel_slug, '')));
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'hotel_not_found'); END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_hotel.services) s WHERE s->>'id' = p_service) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_service');
  END IF;
  IF (SELECT count(*) FROM public.prive_demo_requests WHERE user_id = p_user AND created_at > now() - interval '1 hour') >= 10
     OR (SELECT count(*) FROM public.prive_demo_requests WHERE user_id = p_user AND created_at > now() - interval '24 hours') >= 50 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'rate_limited', 'retryAfter', 3600);
  END IF;

  INSERT INTO public.prive_demo_requests (user_id, hotel_id, service, idempotency_key)
  VALUES (p_user, v_hotel.id, p_service, p_idempotency_key)
  RETURNING * INTO v_r;
  INSERT INTO public.prive_demo_request_events (request_id, status, actor) VALUES (v_r.id, 'received', 'guest');
  RETURN jsonb_build_object('ok', true, 'requestId', v_r.id, 'replayed', false);
END;
$$;

-- My demo requests (or one), each with its hotel, its service label and its steps.
CREATE OR REPLACE FUNCTION public.prive_demo_requests_for(p_user uuid, p_request uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', r.id, 'demo', r.is_demo, 'status', r.status,
    'hotel', jsonb_build_object('slug', h.slug, 'name', h.name, 'label', h.demo_label),
    'service', jsonb_build_object('id', r.service,
                 'label', (SELECT s->>'label' FROM jsonb_array_elements(h.services) s WHERE s->>'id' = r.service LIMIT 1)),
    'createdAt', r.created_at, 'updatedAt', r.updated_at, 'completedAt', r.completed_at, 'cancelledAt', r.cancelled_at,
    'steps', (SELECT COALESCE(jsonb_agg(jsonb_build_object('status', e.status, 'by', e.actor, 'at', e.at) ORDER BY e.at), '[]'::jsonb)
                FROM public.prive_demo_request_events e WHERE e.request_id = r.id)) ORDER BY r.created_at DESC), '[]'::jsonb)
  FROM public.prive_demo_requests r
  JOIN public.prive_demo_hotels h ON h.id = r.hotel_id
  WHERE r.user_id = p_user AND (p_request IS NULL OR r.id = p_request);
$$;

CREATE OR REPLACE FUNCTION public.prive_demo_request_cancel(p_user uuid, p_request uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_r public.prive_demo_requests;
BEGIN
  SELECT * INTO v_r FROM public.prive_demo_requests WHERE id = p_request AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prive:request_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_r.status IN ('completed', 'cancelled') THEN RAISE EXCEPTION 'prive:already_closed' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.prive_demo_requests SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = v_r.id;
  INSERT INTO public.prive_demo_request_events (request_id, status, actor) VALUES (v_r.id, 'cancelled', 'guest');
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.prive_demo_purge()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_n integer;
BEGIN
  DELETE FROM public.prive_demo_requests WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('demoRequestsDeleted', v_n, 'advanced', public.prive_demo_advance_due());
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.prive_demo_hotels_list()',
    'public.prive_demo_advance_due()',
    'public.prive_demo_request_create(uuid, text, text, text)',
    'public.prive_demo_requests_for(uuid, uuid)',
    'public.prive_demo_request_cancel(uuid, uuid)',
    'public.prive_demo_purge()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;
