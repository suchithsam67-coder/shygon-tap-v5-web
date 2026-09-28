-- TRIAL RUN FOR 013 ON LIVE. Changes NOTHING: it applies 013, exercises the admin
-- functions as the existing admin, checks what a signed-out visitor can do, then
-- raises an error on purpose so Postgres rolls every statement back.
-- Expected result: an error that starts "DRYRUN REPORT (rolled back):" followed
-- by 'ok' for each check. Any 'ERR' in that report means: do not run 013 yet.
BEGIN;
-- ============================================================================
-- 013 — ADMIN PLATFORM (003) ADAPTED TO THE LIVE DATABASE
-- ============================================================================
-- Generated from 003_admin_platform.sql on 2026-09-27 for project
-- auvgvikdbhbrtsrsaslv, whose schema was built outside these migrations: it
-- already had 003's tables and columns, but none of its functions, admin read
-- policies or alert triggers, so the Admin APK stopped at "not set up".
--
-- Differences from 003, all found by comparing against live:
--   1. Every policy is TO authenticated. 003's had no role, so anon evaluated
--      admin_has()/is_admin() too — the exact failure fixed for products in 012.
--      Tightening only: every one of them is admin-only or admin-own-row.
--   2. get_public_tap(): live's newer body (hides a Tap whose card is inactive)
--      is kept; only 003's suspended_at check is added. 003's copy predates the
--      card gating and would have removed it.
--   3. admin_reply_ticket(uuid, text): live's version returned uuid, 003's
--      returns jsonb. The old one is dropped first, only if it conflicts.
--   4. Live's admin_push_tokens and inventory_movements predate 003's table
--      definitions (CREATE TABLE IF NOT EXISTS skips them), so the three
--      columns 003's functions write are added: last_seen_at, stock_after, note.
-- Everything else is 003 verbatim. Every table, column and index statement uses
-- IF NOT EXISTS. Idempotent; safe to re-run.
-- ============================================================================

-- ============================================================================
-- SHYGON TAP V5 — ADMIN PLATFORM
-- ============================================================================
-- Run AFTER 001_production_payments_and_catalog.sql and 002_shygon_v5_platform.sql.
--
-- ORDERING MATTERS, AND NOT ONLY THE FIRST TIME. Migration 002 drops EVERY
-- policy on profiles, orders and tap_profiles before recreating its own. If 002
-- is ever re-run after this file, the admin SELECT policies in section 9 go
-- with them and the Admin APK will read nothing but empty lists. Re-run 003
-- after any re-run of 002. Both are idempotent, so that is always safe.
--
-- This is the server half of the SHYGON Tap Admin APK. It is additive and
-- idempotent: it adds nothing the customer app reads, changes no customer
-- policy, and drops no existing object except the two functions it deliberately
-- replaces in place (both by CREATE OR REPLACE, so their triggers survive).
--
-- WHAT WAS FOUND BEFORE THIS FILE
--   `admin_users` existed in the live project with exactly two columns —
--   (user_id, created_at) — and NOTHING in the codebase referenced it. No role,
--   no permission, no active flag, no policy, no function. It was an allowlist
--   nobody consulted.
--
-- THE SECURITY MODEL THIS ESTABLISHES
--
--     authenticated user (JWT)
--            |
--            v  auth.uid()
--     admin_users  ->  is_active
--            |
--            v  role  +  explicit permission grants
--     admin_has('<permission>')
--            |
--            v  require_admin() raises 42501 if not satisfied
--     SECURITY DEFINER RPC performs the operation and writes an audit row
--
--   The Admin APK holds only the public anon key and the admin's own session.
--   There is no service-role key in this path, so there is nothing to leak, and
--   the authorization check runs inside the same transaction as the write.
--   Client-side permission checks in the APK are UX only; this file is the
--   boundary.
--
-- WHY NOT AN EDGE FUNCTION WITH THE SERVICE ROLE
--   Because that would replace an in-transaction check with a network hop that
--   carries a key able to bypass every policy in the database. Postgres already
--   knows who the caller is. The only operations that genuinely leave Postgres
--   (a Razorpay refund, an Expo push) are Edge Functions, in supabase/functions.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. REFUSE TO RUN ON AN UNPREPARED DATABASE
-- ---------------------------------------------------------------------------
-- A half-applied security model is worse than none: admin policies would
-- reference tables that do not exist, and every RPC below would fail at call
-- time rather than at install time. Fail loudly, now.
DO $$
DECLARE
  v_missing TEXT[] := '{}';
  v_table   TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'profiles', 'orders', 'products', 'tap_profiles', 'admin_users',
    'entitlements', 'payments', 'order_items', 'cards', 'notifications',
    'support_tickets', 'support_messages', 'tap_events', 'webhook_events'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = v_table AND c.relkind = 'r'
    ) THEN
      v_missing := v_missing || v_table;
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION
      'Cannot install the admin platform: missing table(s) %. Apply 001_production_payments_and_catalog.sql and 002_shygon_v5_platform.sql first.',
      array_to_string(v_missing, ', ');
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 0b. PRE-FLIGHT ON WHAT IS ALREADY IN THIS PROJECT
-- ---------------------------------------------------------------------------
-- This project was NOT pristine when the admin platform was written. It already
-- contained an `admin_users` table and an `is_admin()` function that no
-- application code referenced. Both are reused rather than replaced — but both
-- can stop this migration in ways whose native error message says nothing
-- useful, so they are checked here first and reported in plain words.
DO $$
DECLARE
  v_rettype TEXT;
  v_dupes   BIGINT;
BEGIN
  -- CREATE OR REPLACE FUNCTION cannot change an existing function's return
  -- type; it fails with a bare 42P13 that does not say which function. The
  -- pre-existing is_admin() must therefore already return boolean.
  SELECT pg_catalog.format_type(p.prorettype, NULL) INTO v_rettype
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'is_admin' AND p.pronargs = 0;

  IF v_rettype IS NOT NULL AND v_rettype <> 'boolean' THEN
    RAISE EXCEPTION
      'public.is_admin() already exists in this project and returns %, not boolean. This migration needs it to return boolean. Inspect it first (\df+ public.is_admin), then either drop it — DROP FUNCTION public.is_admin(); — or, if an RLS policy depends on it, rewrite that policy before re-running this file.',
      v_rettype;
  END IF;

  -- Section 1 puts a UNIQUE index on admin_users(user_id). If the table was
  -- ever written to by hand it may hold duplicates, and the index build fails
  -- with a 23505 that names an index nobody has heard of.
  SELECT count(*) INTO v_dupes FROM (
    SELECT user_id FROM public.admin_users
    WHERE user_id IS NOT NULL
    GROUP BY user_id HAVING count(*) > 1
  ) d;

  IF v_dupes > 0 THEN
    RAISE EXCEPTION
      'public.admin_users holds % duplicated user_id value(s), so a unique index cannot be built. Resolve them first: SELECT user_id, count(*) FROM public.admin_users GROUP BY user_id HAVING count(*) > 1;',
      v_dupes;
  END IF;

  IF EXISTS (SELECT 1 FROM public.admin_users WHERE user_id IS NULL) THEN
    RAISE EXCEPTION
      'public.admin_users contains a row with a NULL user_id, which can never identify an administrator. Delete it first: DELETE FROM public.admin_users WHERE user_id IS NULL;';
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 1. ADMIN IDENTITY
-- ---------------------------------------------------------------------------
-- `admin_users` is kept. user_id stays the identity, exactly as it was.
-- Everything below is an additive column with a safe default, so the rows that
-- are already in the table keep working and simply become role 'admin'.

ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS role         TEXT   NOT NULL DEFAULT 'admin';
ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS permissions  TEXT[] NOT NULL DEFAULT '{}';
-- The reason S1 in the readiness report existed: a compromised admin could only
-- be stopped by deleting the row, which also destroyed the audit trail's FK.
ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS is_active    BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- One row per admin. The table may have had no key at all.
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_user
  ON public.admin_users(user_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_users_role_valid') THEN
    ALTER TABLE public.admin_users ADD CONSTRAINT admin_users_role_valid
      CHECK (role IN ('owner', 'admin', 'fulfilment', 'support', 'viewer')) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
-- Deliberately NOT `FORCE ROW LEVEL SECURITY`: the SECURITY DEFINER helpers
-- below are owned by the table owner and must be able to read this table
-- without tripping the very policy they are used to evaluate.


-- ---------------------------------------------------------------------------
-- 1b. COMPANY EMAIL DOMAIN ALLOWLIST — A GUARDRAIL, NOT THE AUTH CONTROL
-- ---------------------------------------------------------------------------
-- Read this before assuming it is what gates admin access. It is not.
--
-- Authorization remains, unchanged and exclusively:
--     auth.uid() -> admin_users -> role -> permission
--
-- Someone who forged an address at an approved domain would still have exactly
-- zero access without a row in admin_users. This list constrains only WHICH
-- ADDRESSES AN OWNER IS ALLOWED TO PROMOTE, so a personal or mistyped address
-- cannot be handed administrative access by accident. Defence in depth on the
-- promotion action, layered on top of the real control — never a substitute
-- for it.
--
-- Configurable rather than hardcoded, because "who counts as company staff" is
-- an operational policy that will change, and changing it should not mean
-- editing and re-running a migration.
CREATE TABLE IF NOT EXISTS public.admin_allowed_email_domains (
  -- Stored bare and lowercase: 'shygon.com', never '@shygon.com'.
  domain     TEXT PRIMARY KEY CHECK (domain = lower(btrim(domain))
                                     AND domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  note       TEXT,
  added_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.admin_allowed_email_domains ENABLE ROW LEVEL SECURITY;

-- The SELECT policy for this table is created in section 2b, immediately after
-- admin_has() exists. Postgres parses and resolves a policy expression at
-- CREATE POLICY time, so declaring it here — 100 lines before the function is
-- defined — aborted the whole migration with
-- "function public.admin_has(unknown) does not exist".
-- Writes go through the RPCs below only.

-- Seeded EMPTY on purpose. An empty list means "not configured yet" and imposes
-- no restriction — the alternative would be that applying this file instantly
-- locks every owner out of adding anybody. That fail-open is only acceptable
-- because this is a guardrail rather than a control, and because the
-- Administrators screen states plainly when no domain is configured instead of
-- letting the unrestricted state pass unnoticed.


-- ---------------------------------------------------------------------------
-- 2. ROLES AND PERMISSIONS
-- ---------------------------------------------------------------------------
-- Permission catalogue (the only strings any RPC below will accept):
--
--   orders.read        orders.fulfil     orders.cancel      orders.refund
--   customers.read     customers.manage
--   tap.read           tap.moderate
--   products.read      products.manage
--   inventory.read     inventory.manage
--   entitlements.read  entitlements.grant
--   support.read       support.respond
--   analytics.read     audit.read        admins.manage
--
-- A role expands to a fixed set. `admin_users.permissions` may add extra
-- grants on top of the role, but can never take one away — narrowing is done
-- by choosing a smaller role, which keeps the model easy to reason about.

CREATE OR REPLACE FUNCTION public.admin_role_permissions(p_role TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_role
    WHEN 'owner' THEN ARRAY[
      'orders.read','orders.fulfil','orders.cancel','orders.refund',
      'customers.read','customers.manage',
      'tap.read','tap.moderate',
      'products.read','products.manage',
      'inventory.read','inventory.manage',
      'entitlements.read','entitlements.grant',
      'support.read','support.respond',
      'analytics.read','audit.read','admins.manage']
    -- 'admin' is everything an owner can do EXCEPT creating other admins.
    -- Privilege escalation is the one thing a day-to-day operator must not
    -- be able to do to themselves.
    WHEN 'admin' THEN ARRAY[
      'orders.read','orders.fulfil','orders.cancel','orders.refund',
      'customers.read','customers.manage',
      'tap.read','tap.moderate',
      'products.read','products.manage',
      'inventory.read','inventory.manage',
      'entitlements.read','entitlements.grant',
      'support.read','support.respond',
      'analytics.read','audit.read']
    WHEN 'fulfilment' THEN ARRAY[
      'orders.read','orders.fulfil',
      'customers.read','tap.read',
      'products.read','inventory.read','inventory.manage',
      'analytics.read']
    WHEN 'support' THEN ARRAY[
      'orders.read','customers.read','tap.read',
      'entitlements.read','support.read','support.respond',
      'products.read','analytics.read']
    WHEN 'viewer' THEN ARRAY[
      'orders.read','customers.read','tap.read','products.read',
      'inventory.read','entitlements.read','support.read','analytics.read']
    ELSE ARRAY[]::TEXT[]
  END;
$$;


-- Is the caller a live administrator? SECURITY DEFINER so it can consult
-- admin_users from inside a policy on admin_users without recursing.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users a
    WHERE a.user_id = auth.uid() AND a.is_active
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.role FROM public.admin_users a
  WHERE a.user_id = auth.uid() AND a.is_active;
$$;

CREATE OR REPLACE FUNCTION public.admin_has(p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users a
    WHERE a.user_id = auth.uid()
      AND a.is_active
      AND (
        p_permission = ANY (public.admin_role_permissions(a.role))
        OR p_permission = ANY (a.permissions)
      )
  );
$$;

-- The gate every privileged RPC opens with. Returns the acting admin's id so
-- the caller can attribute the audit row without a second lookup.
-- A NULL permission means "any active administrator", for the handful of
-- surfaces (the notification feed, the admin's own identity) that every role
-- legitimately reaches.
CREATE OR REPLACE FUNCTION public.require_admin(p_permission TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_admin() THEN
    -- Same message for "not an admin" and "deactivated admin": a signed-in
    -- customer poking at these RPCs learns nothing about who is an admin.
    RAISE EXCEPTION 'This account does not have administrator access.'
      USING ERRCODE = '42501';
  END IF;

  IF p_permission IS NOT NULL AND NOT public.admin_has(p_permission) THEN
    RAISE EXCEPTION 'Your role does not permit this action (%).', p_permission
      USING ERRCODE = '42501';
  END IF;

  RETURN v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_role_permissions(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.require_admin(TEXT)          FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_admin()               TO authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_role()             TO authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_has(TEXT)          TO authenticated;


-- ---------------------------------------------------------------------------
-- 2b. POLICIES THAT DEPEND ON admin_has()
-- ---------------------------------------------------------------------------
-- Declared here rather than beside their table, because CREATE POLICY resolves
-- the function in its USING expression immediately.
DROP POLICY IF EXISTS "admin_domains_select" ON public.admin_allowed_email_domains;
CREATE POLICY "admin_domains_select" ON public.admin_allowed_email_domains
  FOR SELECT TO authenticated USING (public.admin_has('admins.manage'));


-- ---------------------------------------------------------------------------
-- 3. AUDIT LOG
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created
  ON public.admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_entity
  ON public.admin_audit_log(entity_type, entity_id);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_audit_select" ON public.admin_audit_log;
CREATE POLICY "admin_audit_select" ON public.admin_audit_log
  FOR SELECT TO authenticated USING (public.admin_has('audit.read'));
-- No INSERT/UPDATE/DELETE policy anywhere: audit rows are written only by the
-- SECURITY DEFINER helper below, and can never be edited or removed by a
-- client — including by the admin who created them.

CREATE OR REPLACE FUNCTION public.admin_audit(
  p_admin       UUID,
  p_action      TEXT,
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id   TEXT DEFAULT NULL,
  p_metadata    JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (p_admin, p_action, p_entity_type, p_entity_id, p_metadata);
$$;

REVOKE ALL ON FUNCTION public.admin_audit(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_audit(UUID, TEXT, TEXT, TEXT, JSONB) FROM anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. ADMIN NOTIFICATIONS AND PUSH TOKENS
-- ---------------------------------------------------------------------------
-- A feed separate from the customer `notifications` table. Mixing them would
-- put operational alerts behind a customer's RLS policy and vice versa.
CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = broadcast to every admin with the matching permission.
  admin_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  -- order | payment | support | inventory | tap | system
  category    TEXT NOT NULL DEFAULT 'system',
  -- info | warning | critical
  severity    TEXT NOT NULL DEFAULT 'info',
  title       TEXT NOT NULL,
  body        TEXT,
  -- Deep link target inside the APK, e.g. /orders/<uuid>
  link        TEXT,
  metadata    JSONB,
  -- Set by the admin-push Edge Function once the row has been dispatched, so
  -- the dispatcher is resumable and never sends the same alert twice.
  pushed_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_created
  ON public.admin_notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_pending
  ON public.admin_notifications(created_at) WHERE pushed_at IS NULL;

ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_notifications_select" ON public.admin_notifications;
CREATE POLICY "admin_notifications_select" ON public.admin_notifications
  FOR SELECT TO authenticated USING (
    public.is_admin() AND (admin_id IS NULL OR admin_id = auth.uid())
  );

-- Per-admin read state. Kept in its own table so a broadcast row can be read by
-- one admin without being marked read for everyone.
CREATE TABLE IF NOT EXISTS public.admin_notification_reads (
  notification_id UUID NOT NULL REFERENCES public.admin_notifications(id) ON DELETE CASCADE,
  admin_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (notification_id, admin_id)
);

ALTER TABLE public.admin_notification_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_notification_reads_own" ON public.admin_notification_reads;
CREATE POLICY "admin_notification_reads_own" ON public.admin_notification_reads
  FOR SELECT TO authenticated USING (admin_id = auth.uid());

DROP POLICY IF EXISTS "admin_notification_reads_insert_own" ON public.admin_notification_reads;
CREATE POLICY "admin_notification_reads_insert_own" ON public.admin_notification_reads
  FOR INSERT TO authenticated WITH CHECK (admin_id = auth.uid() AND public.is_admin());


CREATE TABLE IF NOT EXISTS public.admin_push_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expo_token   TEXT NOT NULL UNIQUE,
  platform     TEXT,
  device_name  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_admin_push_tokens_admin
  ON public.admin_push_tokens(admin_id) WHERE revoked_at IS NULL;

ALTER TABLE public.admin_push_tokens ENABLE ROW LEVEL SECURITY;

-- Row-private even between administrators. A token is a capability to reach a
-- specific device; no admin has a reason to read another admin's.
DROP POLICY IF EXISTS "admin_push_tokens_own" ON public.admin_push_tokens;
CREATE POLICY "admin_push_tokens_own" ON public.admin_push_tokens
  FOR SELECT TO authenticated USING (admin_id = auth.uid());
-- Registration and revocation go through the RPCs below, never a direct write.


-- ---------------------------------------------------------------------------
-- 5. INVENTORY MOVEMENTS
-- ---------------------------------------------------------------------------
-- `products.stock` alone answers "how many" but never "why". Every admin
-- adjustment and every fulfilment decrement lands here.
CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku         VARCHAR(64) NOT NULL,
  delta       INTEGER NOT NULL,
  stock_after INTEGER,
  -- admin_adjustment | fulfilment | restock | correction
  reason      TEXT NOT NULL DEFAULT 'admin_adjustment',
  note        TEXT,
  admin_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  order_id    UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_sku
  ON public.inventory_movements(sku, created_at DESC);

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_movements_admin_select" ON public.inventory_movements;
CREATE POLICY "inventory_movements_admin_select" ON public.inventory_movements
  FOR SELECT TO authenticated USING (public.admin_has('inventory.read'));


-- live-adapted: columns 003's functions write that live's older tables lack.
ALTER TABLE public.admin_push_tokens   ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.inventory_movements ADD COLUMN IF NOT EXISTS stock_after  INTEGER;
ALTER TABLE public.inventory_movements ADD COLUMN IF NOT EXISTS note         TEXT;


-- ---------------------------------------------------------------------------
-- 6. OPERATIONAL COLUMNS THE ADMIN APK NEEDS
-- ---------------------------------------------------------------------------
-- `orders` carried a bare tracking_number and nothing else about fulfilment.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_carrier      TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipped_at            TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivered_at          TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cancelled_at          TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cancellation_reason   TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS admin_note            TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refunded_at           TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refund_amount_in_paise INTEGER;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS razorpay_refund_id    TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_created        ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON public.orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_order_status   ON public.orders(order_status);

-- Suspension is an administrative act distinct from the customer unpublishing
-- their own Tap: a suspended Tap must not come back when the owner toggles
-- `published`, so it is tracked separately.
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS suspended_at     TIMESTAMPTZ;
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS suspended_by     UUID
  REFERENCES auth.users(id) ON DELETE SET NULL;

-- Suspending a customer's whole account.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS suspended_at     TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS suspended_reason TEXT;

-- Threshold that drives the low-stock alert, per product, so a card with a long
-- lead time can warn earlier than one that reprints overnight.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER NOT NULL DEFAULT 10;


-- ---------------------------------------------------------------------------
-- 7. THE PUBLIC TAP MUST RESPECT SUSPENSION  (live-adapted)
-- ---------------------------------------------------------------------------
-- 003 shipped a full copy of get_public_tap(). Live has a newer body that also
-- hides a Tap whose physical card is inactive or expired (expire_tap_cards,
-- cards.status). That body is kept verbatim; the only change is the
-- `suspended_at IS NULL` condition, which is all 003 meant to add.
-- (get_public_profile, which the public page actually uses, already checks
-- suspended_at on live.)
CREATE OR REPLACE FUNCTION public.get_public_tap(p_slug TEXT)
RETURNS TABLE (
  slug                   TEXT,
  display_name           TEXT,
  headline               TEXT,
  bio                    TEXT,
  avatar_url             TEXT,
  location               TEXT,
  phone                  TEXT,
  whatsapp               TEXT,
  email                  TEXT,
  website                TEXT,
  instagram              TEXT,
  linkedin               TEXT,
  theme_color            TEXT,
  ui_tier                TEXT,
  enabled_customizations TEXT[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_tap public.tap_profiles%ROWTYPE; v_max TEXT; v_owned TEXT[];
        v_has_cards BOOLEAN; v_has_active_card BOOLEAN;
BEGIN
  SELECT * INTO v_tap FROM public.tap_profiles t
  WHERE lower(t.slug)=lower(btrim(p_slug)) AND t.published IS TRUE
    AND t.suspended_at IS NULL
  LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM public.expire_tap_cards();
  SELECT EXISTS(SELECT 1 FROM public.cards c WHERE c.tap_profile_id=v_tap.id OR c.user_id=v_tap.user_id) INTO v_has_cards;
  SELECT EXISTS(
    SELECT 1 FROM public.cards c
    WHERE (c.tap_profile_id=v_tap.id OR c.user_id=v_tap.user_id)
      AND c.status='active' AND (c.activation_expires_at IS NULL OR c.activation_expires_at>now())
  ) INTO v_has_active_card;
  IF v_has_cards AND NOT v_has_active_card THEN RETURN; END IF;
  v_max := public.user_max_ui_tier(v_tap.user_id);
  SELECT COALESCE(array_agg(e.key),'{}') INTO v_owned
  FROM public.entitlements e WHERE e.user_id=v_tap.user_id AND e.is_active AND e.type='customization';
  RETURN QUERY SELECT v_tap.slug,v_tap.display_name,v_tap.headline,v_tap.bio,v_tap.avatar_url,v_tap.location,
    CASE WHEN 'phone'=ANY(v_tap.enabled_customizations) THEN v_tap.phone END,
    CASE WHEN 'whatsapp'=ANY(v_tap.enabled_customizations) AND 'whatsapp'=ANY(v_owned) THEN v_tap.whatsapp END,
    CASE WHEN 'email'=ANY(v_tap.enabled_customizations) THEN v_tap.email END,
    CASE WHEN 'website'=ANY(v_tap.enabled_customizations) AND 'website'=ANY(v_owned) THEN v_tap.website END,
    CASE WHEN 'instagram'=ANY(v_tap.enabled_customizations) AND 'instagram'=ANY(v_owned) THEN v_tap.instagram END,
    CASE WHEN 'linkedin'=ANY(v_tap.enabled_customizations) AND 'linkedin'=ANY(v_owned) THEN v_tap.linkedin END,
    v_tap.theme_color,
    CASE WHEN public.tier_rank(v_tap.selected_ui_tier)<=public.tier_rank(v_max) THEN v_tap.selected_ui_tier ELSE v_max END,
    ARRAY(SELECT unnest(v_tap.enabled_customizations) INTERSECT SELECT unnest(v_owned || ARRAY['phone','email']));
END;
$function$;

REVOKE ALL ON FUNCTION public.get_public_tap(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tap(TEXT) TO anon, authenticated;

-- A suspended Tap must not accumulate analytics either.
CREATE OR REPLACE FUNCTION public.record_tap_event(
  p_slug     TEXT,
  p_event    TEXT,
  p_link_key TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tap_id  UUID;
  v_headers JSON;
  v_ua      TEXT;
  v_ip      TEXT;
  v_ref     TEXT;
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

  INSERT INTO public.tap_events
    (tap_profile_id, event_type, link_key, visitor_hash, referrer_host)
  VALUES (
    v_tap_id,
    p_event,
    left(NULLIF(btrim(COALESCE(p_link_key, '')), ''), 48),
    md5(COALESCE(v_ua, '') || '|' || COALESCE(v_ip, '') || '|' ||
        to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD')),
    left(NULLIF(split_part(split_part(COALESCE(v_ref, ''), '://', 2), '/', 1), ''), 128)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_tap_event(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_tap_event(TEXT, TEXT, TEXT) TO anon, authenticated;


-- ---------------------------------------------------------------------------
-- 8. THE PAYMENT TRIGGER, AMENDED FOR ADMINS — CAREFULLY
-- ---------------------------------------------------------------------------
-- Finding S2: the original trigger refuses ANY caller with an auth.uid() that
-- tries to change order_status once payment_status is paid. That is correct for
-- customers and catastrophic for operations — it makes shipping an order
-- impossible from any authenticated context.
--
-- The single change below: a caller holding 'orders.fulfil' may move
-- order_status. Everything else is unchanged and still applies to admins:
--   * no client context may set payment_status to paid/refunded/captured
--   * no client context may edit amount, amount_in_paise or the gateway ids
-- Refunds therefore remain impossible from the APK; they go through the
-- admin-refund Edge Function, which uses the service role and has no
-- auth.uid() — the same door the payment webhook already uses.
CREATE OR REPLACE FUNCTION public.enforce_server_only_payment_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_protected TEXT[] := ARRAY['paid', 'refunded', 'captured'];
BEGIN
  -- service_role / server-side fulfilment has no auth.uid().
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.payment_status = ANY (v_protected) THEN
      RAISE EXCEPTION 'payment_status % may only be set by the server', NEW.payment_status
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     AND NEW.payment_status = ANY (v_protected) THEN
    RAISE EXCEPTION 'payment_status % may only be set by the server', NEW.payment_status
      USING ERRCODE = '42501';
  END IF;

  IF NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.amount_in_paise IS DISTINCT FROM OLD.amount_in_paise
     OR NEW.razorpay_order_id IS DISTINCT FROM OLD.razorpay_order_id
     OR NEW.razorpay_payment_id IS DISTINCT FROM OLD.razorpay_payment_id THEN
    RAISE EXCEPTION 'Order amount and payment references are server-managed'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.payment_status = ANY (v_protected)
     AND NEW.order_status IS DISTINCT FROM OLD.order_status
     AND NOT public.admin_has('orders.fulfil') THEN
    RAISE EXCEPTION 'Fulfilment status of a paid order is server-managed'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------------
-- 9. ADMIN READ POLICIES
-- ---------------------------------------------------------------------------
-- Added ALONGSIDE the existing owner-only policies; Postgres ORs policies of
-- the same command, so a customer keeps exactly the access they had. These
-- exist so the APK can use Supabase Realtime (which is gated by RLS, not by
-- RPC) and so read paths do not all have to funnel through a function.
--
-- Scope note: `notifications` (the customer feed) deliberately gets NO admin
-- policy. Nothing in admin operations requires reading a customer's personal
-- notification stream.

DROP POLICY IF EXISTS "orders_select_admin" ON public.orders;
CREATE POLICY "orders_select_admin" ON public.orders
  FOR SELECT TO authenticated USING (public.admin_has('orders.read'));

DROP POLICY IF EXISTS "order_items_select_admin" ON public.order_items;
CREATE POLICY "order_items_select_admin" ON public.order_items
  FOR SELECT TO authenticated USING (public.admin_has('orders.read'));

DROP POLICY IF EXISTS "payments_select_admin" ON public.payments;
CREATE POLICY "payments_select_admin" ON public.payments
  FOR SELECT TO authenticated USING (public.admin_has('orders.read'));

DROP POLICY IF EXISTS "profiles_select_admin" ON public.profiles;
CREATE POLICY "profiles_select_admin" ON public.profiles
  FOR SELECT TO authenticated USING (public.admin_has('customers.read'));

DROP POLICY IF EXISTS "tap_profiles_select_admin" ON public.tap_profiles;
CREATE POLICY "tap_profiles_select_admin" ON public.tap_profiles
  FOR SELECT TO authenticated USING (public.admin_has('tap.read'));

DROP POLICY IF EXISTS "entitlements_select_admin" ON public.entitlements;
CREATE POLICY "entitlements_select_admin" ON public.entitlements
  FOR SELECT TO authenticated USING (public.admin_has('entitlements.read'));

DROP POLICY IF EXISTS "cards_select_admin" ON public.cards;
CREATE POLICY "cards_select_admin" ON public.cards
  FOR SELECT TO authenticated USING (public.admin_has('orders.read'));

DROP POLICY IF EXISTS "support_tickets_select_admin" ON public.support_tickets;
CREATE POLICY "support_tickets_select_admin" ON public.support_tickets
  FOR SELECT TO authenticated USING (public.admin_has('support.read'));

DROP POLICY IF EXISTS "support_messages_select_admin" ON public.support_messages;
CREATE POLICY "support_messages_select_admin" ON public.support_messages
  FOR SELECT TO authenticated USING (public.admin_has('support.read'));

DROP POLICY IF EXISTS "tap_events_select_admin" ON public.tap_events;
CREATE POLICY "tap_events_select_admin" ON public.tap_events
  FOR SELECT TO authenticated USING (public.admin_has('analytics.read'));

-- The existing products policy exposes only active rows. Admins must also see
-- disabled ones to re-enable them.
DROP POLICY IF EXISTS "products_select_admin" ON public.products;
CREATE POLICY "products_select_admin" ON public.products
  FOR SELECT TO authenticated USING (public.admin_has('products.read'));

DROP POLICY IF EXISTS "admin_users_select_admin" ON public.admin_users;
CREATE POLICY "admin_users_select_admin" ON public.admin_users
  FOR SELECT TO authenticated USING (public.is_admin());
-- Writes to admin_users happen only through admin_upsert_admin(), which
-- requires 'admins.manage'. No admin can promote themselves by writing here.


-- ---------------------------------------------------------------------------
-- 10. DASHBOARD
-- ---------------------------------------------------------------------------
-- Deliberately VOLATILE (the default): it stamps last_seen_at, and Postgres
-- refuses any write inside a STABLE function.
CREATE OR REPLACE FUNCTION public.admin_dashboard()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.require_admin('analytics.read');
  v_out   JSONB;
BEGIN
  SELECT jsonb_build_object(
    'generated_at', NOW(),

    'customers', (SELECT jsonb_build_object(
        'total',    count(*),
        'new_7d',   count(*) FILTER (WHERE p.created_at >= NOW() - INTERVAL '7 days'),
        'new_30d',  count(*) FILTER (WHERE p.created_at >= NOW() - INTERVAL '30 days'),
        'suspended',count(*) FILTER (WHERE p.suspended_at IS NOT NULL))
      FROM public.profiles p),

    'taps', (SELECT jsonb_build_object(
        'total',     count(*),
        'published', count(*) FILTER (WHERE t.published IS TRUE AND t.suspended_at IS NULL),
        'draft',     count(*) FILTER (WHERE t.published IS NOT TRUE AND t.suspended_at IS NULL),
        'suspended', count(*) FILTER (WHERE t.suspended_at IS NOT NULL))
      FROM public.tap_profiles t),

    'orders', (SELECT jsonb_build_object(
        'total',            count(*),
        'today',            count(*) FILTER (WHERE o.created_at >= date_trunc('day', NOW())),
        'pending_payment',  count(*) FILTER (WHERE o.payment_status = 'pending'),
        'failed_payment',   count(*) FILTER (WHERE o.payment_status = 'failed'),
        'paid',             count(*) FILTER (WHERE o.payment_status = 'paid'),
        'refunded',         count(*) FILTER (WHERE o.payment_status = 'refunded'),
        'awaiting_fulfilment', count(*) FILTER (
              WHERE o.payment_status = 'paid'
                AND o.order_status IN ('placed', 'processing', 'packed')),
        'processing',       count(*) FILTER (WHERE o.order_status = 'processing'),
        'packed',           count(*) FILTER (WHERE o.order_status = 'packed'),
        'shipped',          count(*) FILTER (WHERE o.order_status = 'shipped'),
        'out_for_delivery', count(*) FILTER (WHERE o.order_status = 'out_for_delivery'),
        'delivered',        count(*) FILTER (WHERE o.order_status = 'delivered'),
        'cancelled',        count(*) FILTER (WHERE o.order_status = 'cancelled'))
      FROM public.orders o),

    -- Derived from paid orders. There is no separate revenue ledger in this
    -- system and one is deliberately not invented here.
    'revenue', (SELECT jsonb_build_object(
        'lifetime_in_paise', COALESCE(sum(o.amount_in_paise), 0),
        'today_in_paise',    COALESCE(sum(o.amount_in_paise)
                                FILTER (WHERE o.created_at >= date_trunc('day', NOW())), 0),
        'last_7d_in_paise',  COALESCE(sum(o.amount_in_paise)
                                FILTER (WHERE o.created_at >= NOW() - INTERVAL '7 days'), 0),
        'last_30d_in_paise', COALESCE(sum(o.amount_in_paise)
                                FILTER (WHERE o.created_at >= NOW() - INTERVAL '30 days'), 0),
        'refunded_in_paise', COALESCE((SELECT sum(r.refund_amount_in_paise)
                                       FROM public.orders r
                                       WHERE r.refund_amount_in_paise IS NOT NULL), 0))
      FROM public.orders o WHERE o.payment_status = 'paid'),

    'inventory', (SELECT jsonb_build_object(
        'tracked_skus',  count(*),
        'units_on_hand', COALESCE(sum(pr.stock), 0),
        'low_stock',     count(*) FILTER (WHERE pr.stock > 0 AND pr.stock <= pr.low_stock_threshold),
        'out_of_stock',  count(*) FILTER (WHERE pr.stock <= 0))
      FROM public.products pr
      WHERE pr.stock IS NOT NULL AND pr.active IS NOT FALSE),

    -- The ORDER BY lives on the aggregate, not only on the subquery: without it
    -- jsonb_agg's row order is not guaranteed, so the scarcest item could stop
    -- appearing first.
    'low_stock_items', (SELECT COALESCE(jsonb_agg(s.x ORDER BY s.stock ASC), '[]'::jsonb)
      FROM (
        SELECT pr.stock AS stock,
               jsonb_build_object(
                 'sku', pr.sku, 'name', pr.name,
                 'stock', pr.stock, 'threshold', pr.low_stock_threshold) AS x
        FROM public.products pr
        WHERE pr.stock IS NOT NULL
          AND pr.active IS NOT FALSE
          AND pr.stock <= pr.low_stock_threshold
        ORDER BY pr.stock ASC
        LIMIT 12
      ) s),

    'cards', (SELECT jsonb_build_object(
        'total',     count(*),
        'pending',   count(*) FILTER (WHERE c.status = 'pending'),
        'shipped',   count(*) FILTER (WHERE c.status = 'shipped'),
        'active',    count(*) FILTER (WHERE c.status = 'active'),
        'suspended', count(*) FILTER (WHERE c.status = 'suspended'))
      FROM public.cards c),

    'entitlements', (SELECT jsonb_build_object(
        'digital_plans',  count(*) FILTER (WHERE e.type = 'digital_plan'),
        'lifetime',       count(*) FILTER (WHERE e.type = 'lifetime'),
        'customizations', count(*) FILTER (WHERE e.type = 'customization'))
      FROM public.entitlements e WHERE e.is_active),

    -- Set-based rather than calling user_max_ui_tier() once per customer: the
    -- dashboard is the most frequently hit query in the whole app.
    'tier_distribution', (SELECT COALESCE(jsonb_object_agg(t.tier, t.n), '{}'::jsonb)
      FROM (
        SELECT COALESCE(best.ui_tier, 'free') AS tier, count(*) AS n
        FROM public.profiles p
        LEFT JOIN (
          SELECT e.user_id,
                 (array_agg(pl.ui_tier ORDER BY public.tier_rank(pl.ui_tier) DESC))[1]
                   AS ui_tier
          FROM public.entitlements e
          JOIN public.products pl ON pl.sku = 'plan-' || e.key
          WHERE e.is_active
            AND e.type IN ('digital_plan', 'lifetime')
            AND pl.ui_tier IS NOT NULL
          GROUP BY e.user_id
        ) best ON best.user_id = p.id
        GROUP BY 1
      ) t),

    'support', (SELECT jsonb_build_object(
        'open',              count(*) FILTER (WHERE s.status = 'open'),
        'awaiting_customer', count(*) FILTER (WHERE s.status = 'awaiting_customer'),
        'resolved',          count(*) FILTER (WHERE s.status = 'resolved'),
        'closed',            count(*) FILTER (WHERE s.status = 'closed'))
      FROM public.support_tickets s),

    'recent_orders', (SELECT COALESCE(jsonb_agg(s.x ORDER BY s.created_at DESC), '[]'::jsonb)
      FROM (
        SELECT o.created_at,
               jsonb_build_object(
                 'id', o.id, 'reference', o.order_id,
                 'customer_name', pr.full_name, 'product_name', o.product_name,
                 'amount_in_paise', o.amount_in_paise,
                 'payment_status', o.payment_status,
                 'order_status', o.order_status,
                 'created_at', o.created_at) AS x
        FROM public.orders o
        LEFT JOIN public.profiles pr ON pr.id = o.user_id
        ORDER BY o.created_at DESC
        LIMIT 8
      ) s)
  ) INTO v_out;

  UPDATE public.admin_users SET last_seen_at = NOW() WHERE user_id = v_admin;

  RETURN v_out;
END;
$$;


-- ---------------------------------------------------------------------------
-- 11. ORDERS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_orders(
  p_search         TEXT DEFAULT NULL,
  p_payment_status TEXT DEFAULT NULL,
  p_order_status   TEXT DEFAULT NULL,
  p_limit          INT  DEFAULT 25,
  p_offset         INT  DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit  INT  := least(greatest(COALESCE(p_limit, 25), 1), 100);
  v_offset INT  := greatest(COALESCE(p_offset, 0), 0);
  v_q      TEXT := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_total  BIGINT;
  v_rows   JSONB;
BEGIN
  PERFORM public.require_admin('orders.read');

  -- Filtering and paging happen here, in the database. The APK never pulls a
  -- whole table down to filter it on the device.
  WITH filtered AS (
    SELECT o.*, pr.full_name, pr.email AS customer_email
    FROM public.orders o
    LEFT JOIN public.profiles pr ON pr.id = o.user_id
    WHERE (p_payment_status IS NULL OR o.payment_status = p_payment_status)
      AND (p_order_status   IS NULL OR o.order_status   = p_order_status)
      AND (v_q IS NULL
           OR o.order_id     ILIKE '%' || v_q || '%'
           OR o.product_name ILIKE '%' || v_q || '%'
           OR pr.full_name   ILIKE '%' || v_q || '%'
           OR pr.email       ILIKE '%' || v_q || '%'
           OR o.tracking_number ILIKE '%' || v_q || '%'
           OR o.razorpay_order_id ILIKE '%' || v_q || '%')
  )
  SELECT
    (SELECT count(*) FROM filtered),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id,
        'reference', f.order_id,
        'user_id', f.user_id,
        'customer_name', f.full_name,
        'customer_email', f.customer_email,
        'product_name', f.product_name,
        'order_type', f.order_type,
        'amount_in_paise', f.amount_in_paise,
        'payment_status', f.payment_status,
        'order_status', f.order_status,
        'tracking_number', f.tracking_number,
        'shipping_carrier', f.shipping_carrier,
        'shipping_city', f.shipping_city,
        'created_at', f.created_at,
        'updated_at', f.updated_at
      ) ORDER BY f.created_at DESC)
      FROM (SELECT * FROM filtered ORDER BY created_at DESC
            LIMIT v_limit OFFSET v_offset) f
    ), '[]'::jsonb)
  INTO v_total, v_rows;

  RETURN jsonb_build_object('total', v_total, 'limit', v_limit,
                            'offset', v_offset, 'rows', v_rows);
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_get_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out JSONB;
BEGIN
  PERFORM public.require_admin('orders.read');

  SELECT jsonb_build_object(
    'order', to_jsonb(o) - 'customer_id',
    'customer', (SELECT jsonb_build_object(
        'id', pr.id, 'full_name', pr.full_name, 'email', pr.email,
        'phone', pr.phone, 'suspended_at', pr.suspended_at)
      FROM public.profiles pr WHERE pr.id = o.user_id),
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.created_at)
      FROM public.order_items i WHERE i.order_id = o.id), '[]'::jsonb),
    -- raw_payload is the full gateway body; it is not needed to operate an
    -- order and is not sent to a mobile device.
    'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', pay.id, 'provider', pay.provider,
        'provider_order_id', pay.provider_order_id,
        'provider_payment_id', pay.provider_payment_id,
        'status', pay.status, 'amount_in_paise', pay.amount_in_paise,
        'created_at', pay.created_at, 'verified_at', pay.verified_at)
        ORDER BY pay.created_at DESC)
      FROM public.payments pay WHERE pay.order_id = o.id), '[]'::jsonb),
    'cards', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at)
      FROM public.cards c WHERE c.order_id = o.id), '[]'::jsonb),
    'history', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'action', a.action, 'metadata', a.metadata,
        'created_at', a.created_at,
        'admin_name', au.display_name)
        ORDER BY a.created_at DESC)
      FROM public.admin_audit_log a
      LEFT JOIN public.admin_users au ON au.user_id = a.admin_id
      WHERE a.entity_type = 'order' AND a.entity_id = o.id::text), '[]'::jsonb)
  ) INTO v_out
  FROM public.orders o
  WHERE o.id = p_order_id;

  IF v_out IS NULL THEN
    RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_out;
END;
$$;


-- Ordered fulfilment stages. Advancing is normal; going backwards is a
-- correction and is allowed, but cancelling a delivered order is not.
CREATE OR REPLACE FUNCTION public.admin_update_order_status(
  p_order_id  UUID,
  p_status    TEXT,
  p_tracking  TEXT DEFAULT NULL,
  p_carrier   TEXT DEFAULT NULL,
  p_note      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.require_admin('orders.fulfil');
  v_old   public.orders%ROWTYPE;
BEGIN
  IF p_status NOT IN ('placed','processing','packed','shipped',
                      'out_for_delivery','delivered') THEN
    RAISE EXCEPTION 'Unknown fulfilment status "%".', p_status USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_old FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_old.order_status = 'cancelled' THEN
    RAISE EXCEPTION 'A cancelled order cannot be moved back into fulfilment.'
      USING ERRCODE = '22023';
  END IF;

  -- Shipping something nobody has paid for is almost always a mistake, and the
  -- database is the only place that can reliably refuse it.
  IF v_old.payment_status <> 'paid'
     AND p_status IN ('shipped', 'out_for_delivery', 'delivered') THEN
    RAISE EXCEPTION 'This order has not been paid, so it cannot be marked %.', p_status
      USING ERRCODE = '22023';
  END IF;

  IF p_status IN ('shipped', 'out_for_delivery', 'delivered')
     AND COALESCE(NULLIF(btrim(COALESCE(p_tracking, '')), ''),
                  NULLIF(btrim(COALESCE(v_old.tracking_number, '')), '')) IS NULL THEN
    RAISE EXCEPTION 'Add a tracking number before marking this order %.', p_status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.orders SET
    order_status     = p_status,
    tracking_number  = COALESCE(NULLIF(btrim(COALESCE(p_tracking, '')), ''), tracking_number),
    shipping_carrier = COALESCE(NULLIF(btrim(COALESCE(p_carrier, '')), ''), shipping_carrier),
    admin_note       = COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), admin_note),
    shipped_at       = CASE WHEN p_status = 'shipped'   AND shipped_at   IS NULL
                            THEN NOW() ELSE shipped_at END,
    delivered_at     = CASE WHEN p_status = 'delivered' AND delivered_at IS NULL
                            THEN NOW() ELSE delivered_at END
  WHERE id = p_order_id;

  -- Cards leave the building with the order they belong to.
  IF p_status IN ('shipped', 'out_for_delivery') THEN
    UPDATE public.cards SET status = 'shipped'
    WHERE order_id = p_order_id AND status = 'pending';
  ELSIF p_status = 'delivered' THEN
    UPDATE public.cards SET status = 'active'
    WHERE order_id = p_order_id AND status IN ('pending', 'shipped');
  END IF;

  PERFORM public.admin_audit(v_admin, 'order.status_changed', 'order', p_order_id::text,
    jsonb_build_object('from', v_old.order_status, 'to', p_status,
                       'tracking', p_tracking, 'carrier', p_carrier));

  RETURN public.admin_get_order(p_order_id);
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_cancel_order(
  p_order_id UUID,
  p_reason   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin  UUID := public.require_admin('orders.cancel');
  v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_old    public.orders%ROWTYPE;
BEGIN
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'A cancellation reason is required.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_old FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_old.order_status = 'delivered' THEN
    RAISE EXCEPTION 'A delivered order cannot be cancelled. Issue a refund instead.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.orders SET
    order_status        = 'cancelled',
    cancelled_at        = NOW(),
    cancellation_reason = v_reason
  WHERE id = p_order_id;

  UPDATE public.cards SET status = 'suspended'
  WHERE order_id = p_order_id AND status IN ('pending', 'shipped');

  -- Cancelling does NOT refund. The money side stays with the gateway and the
  -- Edge Function, so this can never silently look like the customer got paid
  -- back when they did not.
  INSERT INTO public.notifications (user_id, category, title, body, link, metadata)
  SELECT v_old.user_id, 'order', 'Order cancelled',
         'Order ' || COALESCE(v_old.order_id, '') || ' was cancelled. ' || v_reason,
         '/shygontap/orders', jsonb_build_object('order_id', p_order_id)
  WHERE v_old.user_id IS NOT NULL;

  PERFORM public.admin_audit(v_admin, 'order.cancelled', 'order', p_order_id::text,
    jsonb_build_object('reason', v_reason, 'previous_status', v_old.order_status));

  RETURN public.admin_get_order(p_order_id);
END;
$$;


-- ---------------------------------------------------------------------------
-- 12. CUSTOMERS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_customers(
  p_search TEXT DEFAULT NULL,
  p_limit  INT  DEFAULT 25,
  p_offset INT  DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit  INT  := least(greatest(COALESCE(p_limit, 25), 1), 100);
  v_offset INT  := greatest(COALESCE(p_offset, 0), 0);
  v_q      TEXT := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_total  BIGINT;
  v_rows   JSONB;
BEGIN
  PERFORM public.require_admin('customers.read');

  WITH filtered AS (
    SELECT p.id, p.full_name, p.email, p.phone, p.created_at, p.suspended_at
    FROM public.profiles p
    WHERE v_q IS NULL
       OR p.full_name ILIKE '%' || v_q || '%'
       OR p.email     ILIKE '%' || v_q || '%'
       OR p.phone     ILIKE '%' || v_q || '%'
  )
  SELECT
    (SELECT count(*) FROM filtered),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'full_name', f.full_name, 'email', f.email,
        'phone', f.phone, 'created_at', f.created_at,
        'suspended_at', f.suspended_at,
        'ui_tier', public.user_max_ui_tier(f.id),
        'order_count', (SELECT count(*) FROM public.orders o WHERE o.user_id = f.id),
        'paid_total_in_paise', COALESCE((SELECT sum(o.amount_in_paise)
            FROM public.orders o
            WHERE o.user_id = f.id AND o.payment_status = 'paid'), 0),
        'tap_slug', (SELECT t.slug FROM public.tap_profiles t WHERE t.user_id = f.id),
        'tap_published', (SELECT t.published IS TRUE AND t.suspended_at IS NULL
                          FROM public.tap_profiles t WHERE t.user_id = f.id)
      ) ORDER BY f.created_at DESC)
      FROM (SELECT * FROM filtered ORDER BY created_at DESC
            LIMIT v_limit OFFSET v_offset) f
    ), '[]'::jsonb)
  INTO v_total, v_rows;

  RETURN jsonb_build_object('total', v_total, 'limit', v_limit,
                            'offset', v_offset, 'rows', v_rows);
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_get_customer(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out JSONB;
BEGIN
  PERFORM public.require_admin('customers.read');

  SELECT jsonb_build_object(
    -- Whitelisted. `profiles` also holds the customer's own social handles and
    -- bio, which administration does not require.
    'customer', jsonb_build_object(
      'id', p.id, 'full_name', p.full_name, 'email', p.email, 'phone', p.phone,
      'company', p.company, 'job_title', p.job_title, 'location', p.location,
      'created_at', p.created_at, 'suspended_at', p.suspended_at,
      'suspended_reason', p.suspended_reason,
      'ui_tier', public.user_max_ui_tier(p.id)),
    'tap', (SELECT jsonb_build_object(
        'id', t.id, 'slug', t.slug, 'display_name', t.display_name,
        'published', t.published, 'published_at', t.published_at,
        'selected_ui_tier', t.selected_ui_tier,
        'enabled_customizations', t.enabled_customizations,
        'suspended_at', t.suspended_at, 'suspended_reason', t.suspended_reason,
        'created_at', t.created_at)
      FROM public.tap_profiles t WHERE t.user_id = p.id),
    'entitlements', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'type', e.type, 'key', e.key,
        'is_active', e.is_active, 'granted_at', e.granted_at,
        'source_order_id', e.source_order_id) ORDER BY e.granted_at DESC)
      FROM public.entitlements e WHERE e.user_id = p.id), '[]'::jsonb),
    'cards', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at DESC)
      FROM public.cards c WHERE c.user_id = p.id), '[]'::jsonb),
    'orders', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', o.id, 'reference', o.order_id, 'product_name', o.product_name,
        'amount_in_paise', o.amount_in_paise, 'payment_status', o.payment_status,
        'order_status', o.order_status, 'created_at', o.created_at)
        ORDER BY o.created_at DESC)
      FROM public.orders o WHERE o.user_id = p.id), '[]'::jsonb),
    'tickets', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'reference', s.reference, 'subject', s.subject,
        'status', s.status, 'created_at', s.created_at) ORDER BY s.created_at DESC)
      FROM public.support_tickets s WHERE s.user_id = p.id), '[]'::jsonb)
  ) INTO v_out
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF v_out IS NULL THEN
    RAISE EXCEPTION 'Customer not found.' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_out;
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_set_customer_suspension(
  p_user_id   UUID,
  p_suspended BOOLEAN,
  p_reason    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin  UUID := public.require_admin('customers.manage');
  v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF p_suspended AND v_reason IS NULL THEN
    RAISE EXCEPTION 'A reason is required to suspend an account.' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Customer not found.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.profiles SET
    suspended_at     = CASE WHEN p_suspended THEN NOW() ELSE NULL END,
    suspended_reason = CASE WHEN p_suspended THEN v_reason ELSE NULL END
  WHERE id = p_user_id;

  -- A suspended account's public Tap must come down with it.
  UPDATE public.tap_profiles SET
    suspended_at     = CASE WHEN p_suspended THEN NOW() ELSE NULL END,
    suspended_reason = CASE WHEN p_suspended THEN v_reason ELSE NULL END,
    suspended_by     = CASE WHEN p_suspended THEN v_admin ELSE NULL END
  WHERE user_id = p_user_id;

  PERFORM public.admin_audit(v_admin,
    CASE WHEN p_suspended THEN 'customer.suspended' ELSE 'customer.reactivated' END,
    'customer', p_user_id::text, jsonb_build_object('reason', v_reason));

  RETURN public.admin_get_customer(p_user_id);
END;
$$;


-- ---------------------------------------------------------------------------
-- 13. TAP PROFILES
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_taps(
  p_search TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,   -- published | draft | suspended
  p_limit  INT  DEFAULT 25,
  p_offset INT  DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit  INT  := least(greatest(COALESCE(p_limit, 25), 1), 100);
  v_offset INT  := greatest(COALESCE(p_offset, 0), 0);
  v_q      TEXT := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_total  BIGINT;
  v_rows   JSONB;
BEGIN
  PERFORM public.require_admin('tap.read');

  WITH filtered AS (
    SELECT t.*, pr.full_name AS owner_name, pr.email AS owner_email
    FROM public.tap_profiles t
    LEFT JOIN public.profiles pr ON pr.id = t.user_id
    WHERE (p_status IS NULL
           OR (p_status = 'published' AND t.published IS TRUE AND t.suspended_at IS NULL)
           OR (p_status = 'draft'     AND t.published IS NOT TRUE AND t.suspended_at IS NULL)
           OR (p_status = 'suspended' AND t.suspended_at IS NOT NULL))
      AND (v_q IS NULL
           OR t.slug         ILIKE '%' || v_q || '%'
           OR t.display_name ILIKE '%' || v_q || '%'
           OR pr.full_name   ILIKE '%' || v_q || '%'
           OR pr.email       ILIKE '%' || v_q || '%')
  )
  SELECT
    (SELECT count(*) FROM filtered),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'slug', f.slug, 'display_name', f.display_name,
        'headline', f.headline, 'user_id', f.user_id,
        'owner_name', f.owner_name, 'owner_email', f.owner_email,
        'published', f.published, 'published_at', f.published_at,
        'suspended_at', f.suspended_at,
        'selected_ui_tier', f.selected_ui_tier,
        'entitled_ui_tier', public.user_max_ui_tier(f.user_id),
        'created_at', f.created_at
      ) ORDER BY f.created_at DESC)
      FROM (SELECT * FROM filtered ORDER BY created_at DESC
            LIMIT v_limit OFFSET v_offset) f
    ), '[]'::jsonb)
  INTO v_total, v_rows;

  RETURN jsonb_build_object('total', v_total, 'limit', v_limit,
                            'offset', v_offset, 'rows', v_rows);
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_get_tap(p_tap_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out JSONB;
BEGIN
  PERFORM public.require_admin('tap.read');

  SELECT jsonb_build_object(
    'tap', jsonb_build_object(
      'id', t.id, 'slug', t.slug, 'display_name', t.display_name,
      'headline', t.headline, 'bio', t.bio, 'avatar_url', t.avatar_url,
      'location', t.location, 'theme_color', t.theme_color,
      'published', t.published, 'published_at', t.published_at,
      'selected_ui_tier', t.selected_ui_tier,
      'entitled_ui_tier', public.user_max_ui_tier(t.user_id),
      'enabled_customizations', t.enabled_customizations,
      'suspended_at', t.suspended_at, 'suspended_reason', t.suspended_reason,
      'provisioned_at', t.provisioned_at, 'created_at', t.created_at,
      'user_id', t.user_id),
    'owner', (SELECT jsonb_build_object(
        'id', pr.id, 'full_name', pr.full_name, 'email', pr.email,
        'suspended_at', pr.suspended_at)
      FROM public.profiles pr WHERE pr.id = t.user_id),
    'cards', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at DESC)
      FROM public.cards c WHERE c.user_id = t.user_id), '[]'::jsonb),
    'engagement', (SELECT jsonb_build_object(
        'views',       count(*) FILTER (WHERE ev.event_type = 'view'),
        'nfc_taps',    count(*) FILTER (WHERE ev.event_type = 'nfc'),
        'qr_scans',    count(*) FILTER (WHERE ev.event_type = 'qr'),
        'link_clicks', count(*) FILTER (WHERE ev.event_type = 'link_click'),
        'last_event',  max(ev.occurred_at))
      FROM public.tap_events ev WHERE ev.tap_profile_id = t.id)
  ) INTO v_out
  FROM public.tap_profiles t
  WHERE t.id = p_tap_id;

  IF v_out IS NULL THEN
    RAISE EXCEPTION 'Tap profile not found.' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_out;
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_set_tap_suspension(
  p_tap_id    UUID,
  p_suspended BOOLEAN,
  p_reason    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin  UUID := public.require_admin('tap.moderate');
  v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_user   UUID;
  v_slug   TEXT;
BEGIN
  IF p_suspended AND v_reason IS NULL THEN
    RAISE EXCEPTION 'A reason is required to suspend a Tap profile.' USING ERRCODE = '22023';
  END IF;

  SELECT user_id, slug INTO v_user, v_slug
  FROM public.tap_profiles WHERE id = p_tap_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tap profile not found.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.tap_profiles SET
    suspended_at     = CASE WHEN p_suspended THEN NOW() ELSE NULL END,
    suspended_reason = CASE WHEN p_suspended THEN v_reason ELSE NULL END,
    suspended_by     = CASE WHEN p_suspended THEN v_admin ELSE NULL END
  WHERE id = p_tap_id;

  -- The customer is told, so a Tap never silently stops resolving.
  INSERT INTO public.notifications (user_id, category, title, body, link)
  VALUES (v_user, 'tap',
    CASE WHEN p_suspended THEN 'Your Tap profile was suspended'
         ELSE 'Your Tap profile was restored' END,
    CASE WHEN p_suspended THEN v_reason
         ELSE 'Your Tap profile is available again.' END,
    '/shygontap/tap');

  PERFORM public.admin_audit(v_admin,
    CASE WHEN p_suspended THEN 'tap.suspended' ELSE 'tap.restored' END,
    'tap', p_tap_id::text,
    jsonb_build_object('slug', v_slug, 'reason', v_reason));

  RETURN public.admin_get_tap(p_tap_id);
END;
$$;


-- ---------------------------------------------------------------------------
-- 14. ENTITLEMENTS — UI TIER UPGRADES WITHOUT A NEW CARD
-- ---------------------------------------------------------------------------
-- Granting a tier writes an `entitlements` row. It does NOT touch `cards`, so
-- the customer's existing physical card keeps working and their Tap simply
-- renders at the higher tier the next time get_public_tap() clamps it.
CREATE OR REPLACE FUNCTION public.admin_grant_entitlement(
  p_user_id UUID,
  p_type    TEXT,
  p_key     TEXT,
  p_reason  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin  UUID := public.require_admin('entitlements.grant');
  v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_key    TEXT := lower(btrim(COALESCE(p_key, '')));
BEGIN
  IF p_type NOT IN ('digital_plan', 'lifetime', 'customization', 'card') THEN
    RAISE EXCEPTION 'Unknown entitlement type "%".', p_type USING ERRCODE = '22023';
  END IF;
  IF v_key = '' THEN
    RAISE EXCEPTION 'An entitlement key is required.' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'A reason is required when granting an entitlement by hand.'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Customer not found.' USING ERRCODE = 'P0002';
  END IF;

  -- The key must correspond to something the catalog actually sells, so a typo
  -- cannot create an entitlement no renderer will ever recognise.
  IF p_type = 'digital_plan' AND NOT EXISTS (
      SELECT 1 FROM public.products WHERE sku = 'plan-' || v_key AND product_type = 'digital_plan') THEN
    RAISE EXCEPTION 'No digital plan with key "%" exists in the catalog.', v_key
      USING ERRCODE = '22023';
  END IF;
  IF p_type = 'customization' AND NOT EXISTS (
      SELECT 1 FROM public.products WHERE sku = 'addon-' || v_key AND product_type = 'customization') THEN
    RAISE EXCEPTION 'No customization with key "%" exists in the catalog.', v_key
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.entitlements (user_id, type, key, is_active)
  VALUES (p_user_id, p_type, v_key, true)
  ON CONFLICT (user_id, type, key) DO UPDATE SET is_active = true;

  INSERT INTO public.notifications (user_id, category, title, body, link)
  VALUES (p_user_id, 'account', 'Your SHYGON Tap was upgraded',
          'A new feature has been added to your account. Your existing card keeps working.',
          '/shygontap/tap');

  PERFORM public.admin_audit(v_admin, 'entitlement.granted', 'customer', p_user_id::text,
    jsonb_build_object('type', p_type, 'key', v_key, 'reason', v_reason));

  RETURN public.admin_get_customer(p_user_id);
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_revoke_entitlement(
  p_entitlement_id UUID,
  p_reason         TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin  UUID := public.require_admin('entitlements.grant');
  v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_row    public.entitlements%ROWTYPE;
BEGIN
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'A reason is required to revoke an entitlement.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.entitlements WHERE id = p_entitlement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entitlement not found.' USING ERRCODE = 'P0002';
  END IF;

  -- Deactivated, never deleted: an entitlement that came from a real payment is
  -- part of the order's history and must stay reconcilable.
  UPDATE public.entitlements SET is_active = false WHERE id = p_entitlement_id;

  PERFORM public.admin_audit(v_admin, 'entitlement.revoked', 'customer', v_row.user_id::text,
    jsonb_build_object('entitlement_id', p_entitlement_id, 'type', v_row.type,
                       'key', v_row.key, 'source_order_id', v_row.source_order_id,
                       'reason', v_reason));

  RETURN public.admin_get_customer(v_row.user_id);
END;
$$;


-- ---------------------------------------------------------------------------
-- 15. PRODUCTS, PLANS, CUSTOMIZATIONS AND INVENTORY
-- ---------------------------------------------------------------------------
-- All three are rows in `products`, distinguished by product_type. There is no
-- second catalog table and none is created here.
CREATE OR REPLACE FUNCTION public.admin_list_products(
  p_type   TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit  INT  DEFAULT 100,
  p_offset INT  DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit  INT  := least(greatest(COALESCE(p_limit, 100), 1), 200);
  v_offset INT  := greatest(COALESCE(p_offset, 0), 0);
  v_q      TEXT := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_total  BIGINT;
  v_rows   JSONB;
BEGIN
  PERFORM public.require_admin('products.read');

  WITH filtered AS (
    SELECT * FROM public.products pr
    WHERE (p_type IS NULL OR pr.product_type = p_type)
      AND (v_q IS NULL
           OR pr.name ILIKE '%' || v_q || '%'
           OR pr.sku  ILIKE '%' || v_q || '%'
           OR pr.category ILIKE '%' || v_q || '%')
  )
  SELECT
    (SELECT count(*) FROM filtered),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'sku', f.sku, 'name', f.name, 'category', f.category,
        'material', f.material, 'tier', f.tier, 'ui_tier', f.ui_tier,
        'price_in_paise', f.price_in_paise, 'product_type', f.product_type,
        'short_description', f.short_description, 'image_url', f.image_url,
        'stock', f.stock, 'low_stock_threshold', f.low_stock_threshold,
        'active', f.active, 'sort_order', f.sort_order,
        'units_sold', COALESCE((SELECT sum(oi.quantity)
            FROM public.order_items oi
            JOIN public.orders o ON o.id = oi.order_id
            WHERE oi.sku = f.sku AND o.payment_status = 'paid'), 0)
      ) ORDER BY f.sort_order NULLS LAST, f.name)
      FROM (SELECT * FROM filtered ORDER BY sort_order NULLS LAST, name
            LIMIT v_limit OFFSET v_offset) f
    ), '[]'::jsonb)
  INTO v_total, v_rows;

  RETURN jsonb_build_object('total', v_total, 'limit', v_limit,
                            'offset', v_offset, 'rows', v_rows);
END;
$$;


-- Patch-style update: only the keys present in p_patch are written, so a screen
-- that edits price alone cannot blank a description it never loaded.
CREATE OR REPLACE FUNCTION public.admin_update_product(
  p_sku   TEXT,
  p_patch JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.require_admin('products.manage');
  v_old   public.products%ROWTYPE;
  v_price INT;
BEGIN
  SELECT * INTO v_old FROM public.products WHERE sku = p_sku FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found.' USING ERRCODE = 'P0002';
  END IF;

  IF p_patch ? 'price_in_paise' THEN
    v_price := (p_patch ->> 'price_in_paise')::INT;
    IF v_price IS NULL OR v_price < 0 THEN
      RAISE EXCEPTION 'Price must be zero or more (in paise).' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_patch ? 'low_stock_threshold'
     AND (p_patch ->> 'low_stock_threshold')::INT < 0 THEN
    RAISE EXCEPTION 'The low stock threshold cannot be negative.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.products SET
    name              = COALESCE(p_patch ->> 'name', name),
    short_description = CASE WHEN p_patch ? 'short_description'
                             THEN p_patch ->> 'short_description' ELSE short_description END,
    description       = CASE WHEN p_patch ? 'description'
                             THEN p_patch ->> 'description' ELSE description END,
    image_url         = CASE WHEN p_patch ? 'image_url'
                             THEN p_patch ->> 'image_url' ELSE image_url END,
    badge             = CASE WHEN p_patch ? 'badge'
                             THEN p_patch ->> 'badge' ELSE badge END,
    -- Kept in sync: `price` (rupees) is what pre-existing code reads,
    -- `price_in_paise` is what the checkout charges. They must never diverge.
    price_in_paise    = COALESCE(v_price, price_in_paise),
    price             = CASE WHEN v_price IS NOT NULL
                             THEN v_price / 100.0 ELSE price END,
    active            = CASE WHEN p_patch ? 'active'
                             THEN (p_patch ->> 'active')::BOOLEAN ELSE active END,
    low_stock_threshold = CASE WHEN p_patch ? 'low_stock_threshold'
                             THEN (p_patch ->> 'low_stock_threshold')::INT
                             ELSE low_stock_threshold END,
    sort_order        = CASE WHEN p_patch ? 'sort_order'
                             THEN (p_patch ->> 'sort_order')::INT ELSE sort_order END
  WHERE sku = p_sku;

  PERFORM public.admin_audit(v_admin, 'product.updated', 'product', p_sku,
    jsonb_build_object(
      'patch', p_patch,
      'previous', jsonb_build_object('name', v_old.name,
                                     'price_in_paise', v_old.price_in_paise,
                                     'active', v_old.active)));

  RETURN (SELECT to_jsonb(pr) FROM public.products pr WHERE pr.sku = p_sku);
END;
$$;


-- Stock is only ever moved through here, so every change has a reason and an
-- author. `products.stock` remains the single authoritative level.
CREATE OR REPLACE FUNCTION public.admin_adjust_stock(
  p_sku    TEXT,
  p_delta  INT,
  p_reason TEXT DEFAULT 'admin_adjustment',
  p_note   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.require_admin('inventory.manage');
  v_after INT;
BEGIN
  IF p_delta = 0 THEN
    RAISE EXCEPTION 'Stock adjustment cannot be zero.' USING ERRCODE = '22023';
  END IF;
  IF abs(p_delta) > 100000 THEN
    RAISE EXCEPTION 'Stock adjustment is unreasonably large.' USING ERRCODE = '22023';
  END IF;
  IF p_reason NOT IN ('admin_adjustment', 'restock', 'correction', 'damage') THEN
    RAISE EXCEPTION 'Unknown stock movement reason "%".', p_reason USING ERRCODE = '22023';
  END IF;

  -- Single statement, so two admins adjusting at once cannot both read the same
  -- level and write it back.
  UPDATE public.products
  SET stock = greatest(0, COALESCE(stock, 0) + p_delta)
  WHERE sku = p_sku
  RETURNING stock INTO v_after;

  IF v_after IS NULL THEN
    RAISE EXCEPTION 'Product not found.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.inventory_movements (sku, delta, stock_after, reason, note, admin_id)
  VALUES (p_sku, p_delta, v_after, p_reason, NULLIF(btrim(COALESCE(p_note, '')), ''), v_admin);

  PERFORM public.admin_audit(v_admin, 'inventory.adjusted', 'product', p_sku,
    jsonb_build_object('delta', p_delta, 'stock_after', v_after, 'reason', p_reason));

  RETURN jsonb_build_object('sku', p_sku, 'stock', v_after);
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_inventory_history(
  p_sku   TEXT DEFAULT NULL,
  p_limit INT  DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit INT := least(greatest(COALESCE(p_limit, 50), 1), 200);
BEGIN
  PERFORM public.require_admin('inventory.read');

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', m.id, 'sku', m.sku, 'delta', m.delta, 'stock_after', m.stock_after,
      'reason', m.reason, 'note', m.note, 'created_at', m.created_at,
      'admin_name', au.display_name)
      ORDER BY m.created_at DESC)
    FROM (SELECT * FROM public.inventory_movements
          WHERE p_sku IS NULL OR sku = p_sku
          ORDER BY created_at DESC LIMIT v_limit) m
    LEFT JOIN public.admin_users au ON au.user_id = m.admin_id
  ), '[]'::jsonb);
END;
$$;


-- ---------------------------------------------------------------------------
-- 16. CARDS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_card(
  p_card_id  UUID,
  p_status   TEXT DEFAULT NULL,
  p_card_uid TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.require_admin('orders.fulfil');
  v_uid   TEXT := NULLIF(btrim(COALESCE(p_card_uid, '')), '');
  v_row   public.cards%ROWTYPE;
BEGIN
  IF p_status IS NOT NULL
     AND p_status NOT IN ('pending','shipped','active','suspended','replaced') THEN
    RAISE EXCEPTION 'Unknown card status "%".', p_status USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.cards WHERE id = p_card_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Card not found.' USING ERRCODE = 'P0002';
  END IF;

  -- A chip identifier, once written, is physically fixed. Rewriting it would
  -- silently re-point a card that is already in a customer's wallet.
  IF v_uid IS NOT NULL AND v_row.card_uid IS NOT NULL AND v_row.card_uid <> v_uid THEN
    RAISE EXCEPTION 'This card already has a chip id. Issue a replacement instead.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.cards SET
    status   = COALESCE(p_status, status),
    card_uid = COALESCE(v_uid, card_uid)
  WHERE id = p_card_id;

  PERFORM public.admin_audit(v_admin, 'card.updated', 'card', p_card_id::text,
    jsonb_build_object('status', p_status, 'card_uid_set', v_uid IS NOT NULL));

  RETURN (SELECT to_jsonb(c) FROM public.cards c WHERE c.id = p_card_id);
END;
$$;


-- ---------------------------------------------------------------------------
-- 17. SUPPORT
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_tickets(
  p_status TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit  INT  DEFAULT 25,
  p_offset INT  DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit  INT  := least(greatest(COALESCE(p_limit, 25), 1), 100);
  v_offset INT  := greatest(COALESCE(p_offset, 0), 0);
  v_q      TEXT := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_total  BIGINT;
  v_rows   JSONB;
BEGIN
  PERFORM public.require_admin('support.read');

  WITH filtered AS (
    SELECT s.*, pr.full_name AS customer_name, pr.email AS customer_email
    FROM public.support_tickets s
    LEFT JOIN public.profiles pr ON pr.id = s.user_id
    WHERE (p_status IS NULL OR s.status = p_status)
      AND (v_q IS NULL
           OR s.reference ILIKE '%' || v_q || '%'
           OR s.subject   ILIKE '%' || v_q || '%'
           OR pr.full_name ILIKE '%' || v_q || '%'
           OR pr.email     ILIKE '%' || v_q || '%')
  )
  SELECT
    (SELECT count(*) FROM filtered),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'reference', f.reference, 'subject', f.subject,
        'category', f.category, 'status', f.status, 'order_id', f.order_id,
        'user_id', f.user_id, 'customer_name', f.customer_name,
        'customer_email', f.customer_email,
        'created_at', f.created_at, 'updated_at', f.updated_at,
        'message_count', (SELECT count(*) FROM public.support_messages m
                          WHERE m.ticket_id = f.id),
        'last_author', (SELECT m.author_role FROM public.support_messages m
                        WHERE m.ticket_id = f.id
                        ORDER BY m.created_at DESC LIMIT 1)
      ) ORDER BY f.updated_at DESC)
      FROM (SELECT * FROM filtered ORDER BY updated_at DESC
            LIMIT v_limit OFFSET v_offset) f
    ), '[]'::jsonb)
  INTO v_total, v_rows;

  RETURN jsonb_build_object('total', v_total, 'limit', v_limit,
                            'offset', v_offset, 'rows', v_rows);
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_get_ticket(p_ticket_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out JSONB;
BEGIN
  PERFORM public.require_admin('support.read');

  SELECT jsonb_build_object(
    'ticket', to_jsonb(s),
    'customer', (SELECT jsonb_build_object(
        'id', pr.id, 'full_name', pr.full_name, 'email', pr.email, 'phone', pr.phone)
      FROM public.profiles pr WHERE pr.id = s.user_id),
    'order', (SELECT jsonb_build_object(
        'id', o.id, 'reference', o.order_id, 'product_name', o.product_name,
        'payment_status', o.payment_status, 'order_status', o.order_status)
      FROM public.orders o WHERE o.id = s.order_id),
    'messages', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', m.id, 'author_role', m.author_role, 'body', m.body,
        'created_at', m.created_at,
        'author_name', COALESCE(au.display_name, cp.full_name))
        ORDER BY m.created_at)
      FROM public.support_messages m
      LEFT JOIN public.admin_users au ON au.user_id = m.author_id
                                      AND m.author_role = 'support'
      LEFT JOIN public.profiles cp    ON cp.id = m.author_id
                                      AND m.author_role = 'customer'
      WHERE m.ticket_id = s.id), '[]'::jsonb)
  ) INTO v_out
  FROM public.support_tickets s
  WHERE s.id = p_ticket_id;

  IF v_out IS NULL THEN
    RAISE EXCEPTION 'Ticket not found.' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_out;
END;
$$;


-- Finding S4: `support_messages` has an INSERT policy that only accepts
-- author_role = 'customer'. A support agent structurally could not reply. This
-- runs as definer, so the reply is written without weakening that policy.
-- live-adapted: live had admin_reply_ticket(uuid, text) RETURNS uuid, unused by
-- any app. The admin app expects this jsonb version; the return type cannot be
-- changed in place, so the old one is dropped first (only if it conflicts).
DO $$
BEGIN
  IF to_regprocedure('public.admin_reply_ticket(uuid,text)') IS NOT NULL
     AND (SELECT prorettype FROM pg_proc WHERE oid = to_regprocedure('public.admin_reply_ticket(uuid,text)')) <> 'jsonb'::regtype THEN
    DROP FUNCTION public.admin_reply_ticket(uuid, text);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.admin_reply_ticket(
  p_ticket_id UUID,
  p_body      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.require_admin('support.respond');
  v_body  TEXT := btrim(COALESCE(p_body, ''));
  v_row   public.support_tickets%ROWTYPE;
BEGIN
  IF length(v_body) < 1 OR length(v_body) > 4000 THEN
    RAISE EXCEPTION 'A reply must be between 1 and 4000 characters.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.support_tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status = 'closed' THEN
    RAISE EXCEPTION 'This ticket is closed. Reopen it before replying.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.support_messages (ticket_id, author_id, author_role, body)
  VALUES (p_ticket_id, v_admin, 'support', v_body);

  UPDATE public.support_tickets SET status = 'awaiting_customer'
  WHERE id = p_ticket_id AND status = 'open';

  INSERT INTO public.notifications (user_id, category, title, body, link, metadata)
  VALUES (v_row.user_id, 'account', 'SHYGON Support replied',
          'There is a new reply on ' || v_row.reference || '.',
          '/shygontap/support', jsonb_build_object('ticket_id', p_ticket_id));

  PERFORM public.admin_audit(v_admin, 'support.replied', 'ticket', p_ticket_id::text,
    jsonb_build_object('reference', v_row.reference));

  RETURN public.admin_get_ticket(p_ticket_id);
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_set_ticket_status(
  p_ticket_id UUID,
  p_status    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.require_admin('support.respond');
  v_old   TEXT;
BEGIN
  IF p_status NOT IN ('open', 'awaiting_customer', 'resolved', 'closed') THEN
    RAISE EXCEPTION 'Unknown ticket status "%".', p_status USING ERRCODE = '22023';
  END IF;

  SELECT status INTO v_old FROM public.support_tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.support_tickets SET status = p_status WHERE id = p_ticket_id;

  PERFORM public.admin_audit(v_admin, 'support.status_changed', 'ticket', p_ticket_id::text,
    jsonb_build_object('from', v_old, 'to', p_status));

  RETURN public.admin_get_ticket(p_ticket_id);
END;
$$;


-- ---------------------------------------------------------------------------
-- 18. ANALYTICS
-- ---------------------------------------------------------------------------
-- Every series below is derived from data the platform already records. Where
-- an obvious metric has no instrumentation (storefront visits, checkout
-- abandonment, delivery times) it is absent rather than approximated.
CREATE OR REPLACE FUNCTION public.admin_analytics(p_days INT DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_days  INT := least(greatest(COALESCE(p_days, 30), 1), 365);
  v_from  TIMESTAMPTZ := date_trunc('day', NOW()) - make_interval(days => v_days - 1);
BEGIN
  PERFORM public.require_admin('analytics.read');

  RETURN jsonb_build_object(
    'days', v_days,
    'from', v_from,

    'daily', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'day', d.day,
        'orders',              COALESCE(o.orders, 0),
        'paid_orders',         COALESCE(o.paid_orders, 0),
        'revenue_in_paise',    COALESCE(o.revenue, 0),
        'new_customers',       COALESCE(c.new_customers, 0),
        'tap_views',           COALESCE(t.views, 0),
        'tap_engagements',     COALESCE(t.engagements, 0)
      ) ORDER BY d.day)
      -- generate_series has no (date, date, interval) form; it returns
      -- timestamps, so the axis is cast back to date to join the daily rollups.
      FROM (SELECT g::date AS day
            FROM generate_series(v_from, date_trunc('day', NOW()), INTERVAL '1 day') g) d
      LEFT JOIN (
        SELECT (created_at AT TIME ZONE 'UTC')::date AS day,
               count(*) AS orders,
               count(*) FILTER (WHERE payment_status = 'paid') AS paid_orders,
               COALESCE(sum(amount_in_paise) FILTER (WHERE payment_status = 'paid'), 0) AS revenue
        FROM public.orders WHERE created_at >= v_from GROUP BY 1
      ) o ON o.day = d.day
      LEFT JOIN (
        SELECT (created_at AT TIME ZONE 'UTC')::date AS day, count(*) AS new_customers
        FROM public.profiles WHERE created_at >= v_from GROUP BY 1
      ) c ON c.day = d.day
      LEFT JOIN (
        SELECT (occurred_at AT TIME ZONE 'UTC')::date AS day,
               count(*) FILTER (WHERE event_type = 'view') AS views,
               count(*) FILTER (WHERE event_type IN ('nfc','qr','link_click')) AS engagements
        FROM public.tap_events WHERE occurred_at >= v_from GROUP BY 1
      ) t ON t.day = d.day
    ), '[]'::jsonb),

    'totals', (SELECT jsonb_build_object(
        'orders',           count(*),
        'paid_orders',      count(*) FILTER (WHERE payment_status = 'paid'),
        'failed_orders',    count(*) FILTER (WHERE payment_status = 'failed'),
        'cancelled_orders', count(*) FILTER (WHERE order_status = 'cancelled'),
        'revenue_in_paise', COALESCE(sum(amount_in_paise)
                              FILTER (WHERE payment_status = 'paid'), 0),
        -- Of the orders that were started in this window, how many were paid.
        -- This is payment completion, not storefront conversion: the storefront
        -- has no visit instrumentation, so true conversion is not computable.
        'payment_completion_rate', CASE WHEN count(*) = 0 THEN NULL
            ELSE round(100.0 * count(*) FILTER (WHERE payment_status = 'paid')
                       / count(*), 1) END)
      FROM public.orders WHERE created_at >= v_from),

    'top_products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'sku', s.sku, 'name', s.name, 'units', s.units,
        'revenue_in_paise', s.revenue) ORDER BY s.revenue DESC)
      FROM (
        SELECT oi.sku, max(oi.name) AS name,
               sum(oi.quantity) AS units,
               sum(oi.line_total_in_paise) AS revenue
        FROM public.order_items oi
        JOIN public.orders o ON o.id = oi.order_id
        WHERE o.payment_status = 'paid' AND o.created_at >= v_from
        GROUP BY oi.sku
        ORDER BY 4 DESC
        LIMIT 10
      ) s), '[]'::jsonb),

    'tier_distribution', (SELECT COALESCE(jsonb_object_agg(t.tier, t.n), '{}'::jsonb)
      FROM (
        SELECT COALESCE(best.ui_tier, 'free') AS tier, count(*) AS n
        FROM public.profiles p
        LEFT JOIN (
          SELECT e.user_id,
                 (array_agg(pl.ui_tier ORDER BY public.tier_rank(pl.ui_tier) DESC))[1]
                   AS ui_tier
          FROM public.entitlements e
          JOIN public.products pl ON pl.sku = 'plan-' || e.key
          WHERE e.is_active
            AND e.type IN ('digital_plan', 'lifetime')
            AND pl.ui_tier IS NOT NULL
          GROUP BY e.user_id
        ) best ON best.user_id = p.id
        GROUP BY 1
      ) t),

    'customizations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', e.key, 'count', e.n)
             ORDER BY e.n DESC)
      FROM (SELECT key, count(*) AS n FROM public.entitlements
            WHERE type = 'customization' AND is_active GROUP BY 1) e), '[]'::jsonb),

    'tap_engagement', (SELECT jsonb_build_object(
        'views',       count(*) FILTER (WHERE event_type = 'view'),
        'nfc_taps',    count(*) FILTER (WHERE event_type = 'nfc'),
        'qr_scans',    count(*) FILTER (WHERE event_type = 'qr'),
        'link_clicks', count(*) FILTER (WHERE event_type = 'link_click'),
        'active_profiles', count(DISTINCT tap_profile_id))
      FROM public.tap_events WHERE occurred_at >= v_from)
  );
END;
$$;


-- ---------------------------------------------------------------------------
-- 19. AUDIT AND ADMIN MANAGEMENT
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_audit(
  p_limit  INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit  INT := least(greatest(COALESCE(p_limit, 50), 1), 200);
  v_offset INT := greatest(COALESCE(p_offset, 0), 0);
BEGIN
  PERFORM public.require_admin('audit.read');

  RETURN jsonb_build_object(
    'total', (SELECT count(*) FROM public.admin_audit_log),
    'limit', v_limit, 'offset', v_offset,
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'action', a.action, 'entity_type', a.entity_type,
        'entity_id', a.entity_id, 'metadata', a.metadata,
        'created_at', a.created_at,
        'admin_name', COALESCE(au.display_name, 'Removed administrator'),
        'admin_role', au.role) ORDER BY a.created_at DESC)
      FROM (SELECT * FROM public.admin_audit_log
            ORDER BY created_at DESC LIMIT v_limit OFFSET v_offset) a
      LEFT JOIN public.admin_users au ON au.user_id = a.admin_id
    ), '[]'::jsonb));
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_list_admins()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_admin('admins.manage');

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'user_id', a.user_id, 'display_name', a.display_name,
      'email', p.email, 'role', a.role, 'permissions', a.permissions,
      'is_active', a.is_active, 'created_at', a.created_at,
      'last_seen_at', a.last_seen_at,
      'effective_permissions',
        public.admin_role_permissions(a.role) || a.permissions)
      ORDER BY a.created_at)
    FROM public.admin_users a
    LEFT JOIN public.profiles p ON p.id = a.user_id
  ), '[]'::jsonb);
END;
$$;


-- Adds an administrator, or changes an existing one's role. Guarded hard,
-- because this is the one operation that can create privilege:
--   * only 'admins.manage' (i.e. an owner) may call it at all;
--   * the target must already be a real, confirmed auth user — this never
--     creates an account, so there is no invite path to abuse;
--   * you cannot change your own role, so an owner cannot accidentally demote
--     themselves out of the ability to fix it;
--   * the last active owner cannot be demoted.
CREATE OR REPLACE FUNCTION public.admin_upsert_admin(
  p_email        TEXT,
  p_role         TEXT,
  p_display_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin  UUID := public.require_admin('admins.manage');
  v_email  TEXT := lower(btrim(COALESCE(p_email, '')));
  v_target UUID;
  v_old    TEXT;
BEGIN
  IF p_role NOT IN ('owner', 'admin', 'fulfilment', 'support', 'viewer') THEN
    RAISE EXCEPTION 'Unknown role "%".', p_role USING ERRCODE = '22023';
  END IF;

  -- The company-domain guardrail (section 1b). Skipped entirely when no domain
  -- has been configured, which is the documented "not set up yet" state.
  IF EXISTS (SELECT 1 FROM public.admin_allowed_email_domains) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.admin_allowed_email_domains d
      WHERE d.domain = lower(split_part(v_email, '@', 2))
    ) THEN
      RAISE EXCEPTION
        'Administrator accounts must use a company email address (%). "%" is not on the approved list.',
        (SELECT string_agg('@' || domain, ', ' ORDER BY domain)
         FROM public.admin_allowed_email_domains),
        v_email
        USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT u.id INTO v_target FROM auth.users u WHERE lower(u.email) = v_email;
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'No SHYGON account exists for %. Ask them to sign up first.', v_email
      USING ERRCODE = 'P0002';
  END IF;

  IF v_target = v_admin THEN
    RAISE EXCEPTION 'You cannot change your own role.' USING ERRCODE = '22023';
  END IF;

  SELECT role INTO v_old FROM public.admin_users WHERE user_id = v_target;

  IF v_old = 'owner' AND p_role <> 'owner'
     AND (SELECT count(*) FROM public.admin_users WHERE role = 'owner' AND is_active) <= 1 THEN
    RAISE EXCEPTION 'This is the last active owner. Promote another owner first.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.admin_users (user_id, role, display_name, is_active)
  VALUES (v_target, p_role,
          NULLIF(btrim(COALESCE(p_display_name, '')), ''), true)
  ON CONFLICT (user_id) DO UPDATE
    SET role         = EXCLUDED.role,
        -- Unqualified on purpose: ON CONFLICT resolves the bare table name to
        -- the existing row; a schema-qualified reference is a syntax error here.
        display_name = COALESCE(EXCLUDED.display_name, admin_users.display_name),
        is_active    = true,
        updated_at   = NOW();

  PERFORM public.admin_audit(v_admin,
    CASE WHEN v_old IS NULL THEN 'admin.created' ELSE 'admin.role_changed' END,
    'admin', v_target::text,
    jsonb_build_object('email', v_email, 'from', v_old, 'to', p_role));

  RETURN public.admin_list_admins();
END;
$$;


-- --- Managing the company domain allowlist -----------------------------------
-- Owner-only, and audited: widening who may be promoted is itself a privileged
-- act and belongs in the same record as everything else.

CREATE OR REPLACE FUNCTION public.admin_list_email_domains()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_admin('admins.manage');

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'domain', d.domain, 'note', d.note, 'created_at', d.created_at,
      'added_by_name', au.display_name) ORDER BY d.domain)
    FROM public.admin_allowed_email_domains d
    LEFT JOIN public.admin_users au ON au.user_id = d.added_by
  ), '[]'::jsonb);
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_add_email_domain(
  p_domain TEXT,
  p_note   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin  UUID := public.require_admin('admins.manage');
  -- Accepts either 'shygon.com' or '@shygon.com' and normalises; typing the
  -- leading @ is the obvious mistake to make here.
  v_domain TEXT := lower(btrim(ltrim(btrim(COALESCE(p_domain, '')), '@')));
BEGIN
  IF v_domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' THEN
    RAISE EXCEPTION 'That is not a valid domain name.' USING ERRCODE = '22023';
  END IF;

  -- Adding a public mailbox provider would make the guardrail meaningless,
  -- because anybody in the world can create an address there in a minute.
  IF v_domain IN ('gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com',
                  'live.com', 'yahoo.com', 'yahoo.co.in', 'icloud.com',
                  'proton.me', 'protonmail.com', 'rediffmail.com', 'aol.com',
                  'mail.com', 'yandex.com', 'zoho.com') THEN
    RAISE EXCEPTION
      'Refusing to allow "%": anyone can create an address at a public mail provider, which would make this restriction meaningless. Use a domain your company controls.',
      v_domain
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.admin_allowed_email_domains (domain, note, added_by)
  VALUES (v_domain, NULLIF(btrim(COALESCE(p_note, '')), ''), v_admin)
  ON CONFLICT (domain) DO UPDATE
    SET note = COALESCE(EXCLUDED.note, admin_allowed_email_domains.note);

  PERFORM public.admin_audit(v_admin, 'admin_domain.added', 'admin_domain', v_domain,
    jsonb_build_object('note', p_note));

  RETURN public.admin_list_email_domains();
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_remove_email_domain(p_domain TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin  UUID := public.require_admin('admins.manage');
  v_domain TEXT := lower(btrim(ltrim(btrim(COALESCE(p_domain, '')), '@')));
  v_left   INT;
BEGIN
  DELETE FROM public.admin_allowed_email_domains WHERE domain = v_domain;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That domain is not on the list.' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*) INTO v_left FROM public.admin_allowed_email_domains;

  PERFORM public.admin_audit(v_admin, 'admin_domain.removed', 'admin_domain', v_domain,
    -- Recorded explicitly, because removing the last entry silently turns the
    -- guardrail off and that must be visible in the log afterwards.
    jsonb_build_object('remaining', v_left,
                       'restriction_now_disabled', v_left = 0));

  RETURN public.admin_list_email_domains();
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_set_admin_active(
  p_user_id UUID,
  p_active  BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.require_admin('admins.manage');
BEGIN
  -- Locking yourself out and leaving nobody able to unlock the account is not
  -- a recoverable state from a phone.
  IF p_user_id = v_admin AND NOT p_active THEN
    RAISE EXCEPTION 'You cannot deactivate your own administrator account.'
      USING ERRCODE = '22023';
  END IF;

  IF NOT p_active AND (SELECT role FROM public.admin_users WHERE user_id = p_user_id) = 'owner'
     AND (SELECT count(*) FROM public.admin_users
          WHERE role = 'owner' AND is_active) <= 1 THEN
    RAISE EXCEPTION 'This is the last active owner. Promote another owner first.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.admin_users
  SET is_active = p_active, updated_at = NOW()
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Administrator not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.admin_audit(v_admin,
    CASE WHEN p_active THEN 'admin.activated' ELSE 'admin.deactivated' END,
    'admin', p_user_id::text, NULL);

  RETURN public.admin_list_admins();
END;
$$;


-- The signed-in admin's own identity and effective permissions. This is what
-- the APK calls right after login to decide whether to admit the session at
-- all, and which navigation entries to render.
-- VOLATILE (the default): it stamps last_seen_at, which a STABLE function may
-- not do.
CREATE OR REPLACE FUNCTION public.admin_me()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_out JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'user_id', a.user_id,
    'display_name', COALESCE(a.display_name, p.full_name),
    'email', p.email,
    'role', a.role,
    'is_active', a.is_active,
    'permissions', public.admin_role_permissions(a.role) || a.permissions,
    'created_at', a.created_at,
    'last_seen_at', a.last_seen_at
  ) INTO v_out
  FROM public.admin_users a
  LEFT JOIN public.profiles p ON p.id = a.user_id
  WHERE a.user_id = v_uid AND a.is_active;

  IF v_out IS NULL THEN
    -- Deliberately the same refusal a non-admin gets, with no hint about
    -- whether the account exists but is deactivated.
    RAISE EXCEPTION 'This account does not have administrator access.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.admin_users SET last_seen_at = NOW() WHERE user_id = v_uid;

  RETURN v_out;
END;
$$;


-- ---------------------------------------------------------------------------
-- 20. NOTIFICATIONS: FEED, READ STATE AND PUSH REGISTRATION
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_notifications(
  p_limit  INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    UUID := public.require_admin();
  v_limit  INT  := least(greatest(COALESCE(p_limit, 50), 1), 200);
  v_offset INT  := greatest(COALESCE(p_offset, 0), 0);
BEGIN
  RETURN jsonb_build_object(
    'unread', (SELECT count(*) FROM public.admin_notifications n
               WHERE (n.admin_id IS NULL OR n.admin_id = v_uid)
                 AND NOT EXISTS (SELECT 1 FROM public.admin_notification_reads r
                                 WHERE r.notification_id = n.id AND r.admin_id = v_uid)),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', n.id, 'category', n.category, 'severity', n.severity,
        'title', n.title, 'body', n.body, 'link', n.link,
        'metadata', n.metadata, 'created_at', n.created_at,
        'read', EXISTS (SELECT 1 FROM public.admin_notification_reads r
                        WHERE r.notification_id = n.id AND r.admin_id = v_uid))
        ORDER BY n.created_at DESC)
      FROM (SELECT * FROM public.admin_notifications
            WHERE admin_id IS NULL OR admin_id = v_uid
            ORDER BY created_at DESC LIMIT v_limit OFFSET v_offset) n
    ), '[]'::jsonb));
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_mark_notifications_read(p_ids UUID[] DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := public.require_admin();
BEGIN
  INSERT INTO public.admin_notification_reads (notification_id, admin_id)
  SELECT n.id, v_uid
  FROM public.admin_notifications n
  WHERE (n.admin_id IS NULL OR n.admin_id = v_uid)
    AND (p_ids IS NULL OR n.id = ANY (p_ids))
  ON CONFLICT DO NOTHING;

  RETURN public.admin_list_notifications(50, 0);
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_register_push_token(
  p_token    TEXT,
  p_platform TEXT DEFAULT NULL,
  p_device   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   UUID := public.require_admin();
  v_token TEXT := btrim(COALESCE(p_token, ''));
BEGIN
  -- Only Expo's own token shapes are stored, so a stray string can never end up
  -- being posted to the push service.
  IF v_token !~ '^(ExponentPushToken\[[^]]+\]|ExpoPushToken\[[^]]+\])$' THEN
    RAISE EXCEPTION 'That is not a valid Expo push token.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.admin_push_tokens (admin_id, expo_token, platform, device_name)
  VALUES (v_uid, v_token, left(COALESCE(p_platform, ''), 32),
          left(COALESCE(p_device, ''), 120))
  ON CONFLICT (expo_token) DO UPDATE
    SET admin_id     = EXCLUDED.admin_id,
        platform     = EXCLUDED.platform,
        device_name  = EXCLUDED.device_name,
        last_seen_at = NOW(),
        revoked_at   = NULL;

  RETURN jsonb_build_object('registered', true);
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_revoke_push_token(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := public.require_admin();
BEGIN
  UPDATE public.admin_push_tokens
  SET revoked_at = NOW()
  WHERE expo_token = btrim(COALESCE(p_token, '')) AND admin_id = v_uid;

  RETURN jsonb_build_object('revoked', true);
END;
$$;


-- ---------------------------------------------------------------------------
-- 21. WHAT RAISES AN ADMIN ALERT
-- ---------------------------------------------------------------------------
-- Broadcast rows (admin_id NULL). The APK reads them over Realtime; the
-- admin-push Edge Function turns the unpushed ones into device notifications.
CREATE OR REPLACE FUNCTION public.admin_notify_order_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name TEXT;
BEGIN
  SELECT full_name INTO v_name FROM public.profiles WHERE id = NEW.user_id;

  IF TG_OP = 'UPDATE'
     AND NEW.payment_status = 'paid'
     AND OLD.payment_status IS DISTINCT FROM 'paid' THEN
    INSERT INTO public.admin_notifications (category, severity, title, body, link, metadata)
    VALUES ('order', 'info',
            'New paid order — ' || chr(8377) ||
              to_char(COALESCE(NEW.amount_in_paise, 0) / 100.0, 'FM999999990D00'),
            COALESCE(v_name, 'A customer') || ' paid for ' ||
              COALESCE(NEW.product_name, 'an order') || '.',
            '/orders/' || NEW.id::text,
            jsonb_build_object('order_id', NEW.id, 'reference', NEW.order_id));
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.payment_status = 'failed'
     AND OLD.payment_status IS DISTINCT FROM 'failed' THEN
    INSERT INTO public.admin_notifications (category, severity, title, body, link, metadata)
    VALUES ('payment', 'warning', 'Payment failed',
            'Payment failed for order ' || COALESCE(NEW.order_id, '') || '.',
            '/orders/' || NEW.id::text,
            jsonb_build_object('order_id', NEW.id));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_admin_notify ON public.orders;
CREATE TRIGGER trg_orders_admin_notify
  AFTER UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.admin_notify_order_event();


CREATE OR REPLACE FUNCTION public.admin_notify_low_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.stock IS NULL OR OLD.stock IS NULL OR NEW.stock >= OLD.stock THEN
    RETURN NEW;
  END IF;

  -- Fires on the crossing only, so a product sitting below the threshold does
  -- not raise an alert on every single sale.
  IF NEW.stock <= NEW.low_stock_threshold AND OLD.stock > NEW.low_stock_threshold THEN
    INSERT INTO public.admin_notifications (category, severity, title, body, link, metadata)
    VALUES ('inventory',
            CASE WHEN NEW.stock <= 0 THEN 'critical' ELSE 'warning' END,
            CASE WHEN NEW.stock <= 0 THEN 'Out of stock' ELSE 'Low stock' END,
            NEW.name || ' is down to ' || NEW.stock || ' unit(s).',
            '/inventory',
            jsonb_build_object('sku', NEW.sku, 'stock', NEW.stock));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_admin_low_stock ON public.products;
CREATE TRIGGER trg_products_admin_low_stock
  AFTER UPDATE OF stock ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.admin_notify_low_stock();


CREATE OR REPLACE FUNCTION public.admin_notify_new_ticket()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.admin_notifications (category, severity, title, body, link, metadata)
  VALUES ('support', 'info', 'New support request',
          NEW.reference || ' — ' || NEW.subject,
          '/support/' || NEW.id::text,
          jsonb_build_object('ticket_id', NEW.id, 'reference', NEW.reference));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_support_admin_notify ON public.support_tickets;
CREATE TRIGGER trg_support_admin_notify
  AFTER INSERT ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.admin_notify_new_ticket();


-- A customer replying to an open ticket should reach the queue too.
CREATE OR REPLACE FUNCTION public.admin_notify_ticket_reply()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ref TEXT;
BEGIN
  IF NEW.author_role <> 'customer' THEN
    RETURN NEW;
  END IF;

  SELECT reference INTO v_ref FROM public.support_tickets WHERE id = NEW.ticket_id;

  INSERT INTO public.admin_notifications (category, severity, title, body, link, metadata)
  VALUES ('support', 'info', 'Customer replied',
          COALESCE(v_ref, 'A ticket') || ' has a new customer message.',
          '/support/' || NEW.ticket_id::text,
          jsonb_build_object('ticket_id', NEW.ticket_id));

  UPDATE public.support_tickets SET status = 'open'
  WHERE id = NEW.ticket_id AND status = 'awaiting_customer';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_support_messages_admin_notify ON public.support_messages;
CREATE TRIGGER trg_support_messages_admin_notify
  AFTER INSERT ON public.support_messages
  FOR EACH ROW EXECUTE FUNCTION public.admin_notify_ticket_reply();


-- ---------------------------------------------------------------------------
-- 22. GRANTS
-- ---------------------------------------------------------------------------
-- Every RPC re-checks the caller internally, so EXECUTE alone grants nothing.
-- anon is excluded regardless: an unauthenticated caller has no business
-- reaching an admin entry point at all.
DO $$
DECLARE
  v_fn TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'admin_me()',
    'admin_dashboard()',
    'admin_list_orders(text,text,text,integer,integer)',
    'admin_get_order(uuid)',
    'admin_update_order_status(uuid,text,text,text,text)',
    'admin_cancel_order(uuid,text)',
    'admin_list_customers(text,integer,integer)',
    'admin_get_customer(uuid)',
    'admin_set_customer_suspension(uuid,boolean,text)',
    'admin_list_taps(text,text,integer,integer)',
    'admin_get_tap(uuid)',
    'admin_set_tap_suspension(uuid,boolean,text)',
    'admin_grant_entitlement(uuid,text,text,text)',
    'admin_revoke_entitlement(uuid,text)',
    'admin_list_products(text,text,integer,integer)',
    'admin_update_product(text,jsonb)',
    'admin_adjust_stock(text,integer,text,text)',
    'admin_inventory_history(text,integer)',
    'admin_update_card(uuid,text,text)',
    'admin_list_tickets(text,text,integer,integer)',
    'admin_get_ticket(uuid)',
    'admin_reply_ticket(uuid,text)',
    'admin_set_ticket_status(uuid,text)',
    'admin_analytics(integer)',
    'admin_list_audit(integer,integer)',
    'admin_list_admins()',
    'admin_upsert_admin(text,text,text)',
    'admin_set_admin_active(uuid,boolean)',
    'admin_list_email_domains()',
    'admin_add_email_domain(text,text)',
    'admin_remove_email_domain(text)',
    'admin_list_notifications(integer,integer)',
    'admin_mark_notifications_read(uuid[])',
    'admin_register_push_token(text,text,text)',
    'admin_revoke_push_token(text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', v_fn);
  END LOOP;
END $$;


-- Realtime: the APK subscribes to these two so a new order and a new alert
-- appear without a poll. RLS still applies to the stream, so a non-admin
-- subscriber receives nothing.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_notifications;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 23. BOOTSTRAPPING THE FIRST OWNER
-- ---------------------------------------------------------------------------
-- Nothing here creates an administrator. `admins.manage` is required to add
-- one, which nobody holds until an owner exists — deliberately, so applying
-- this file can never by itself hand anyone access.
--
-- Promote the first owner ONCE, by hand, in the SQL editor, replacing the
-- email with the real one. This is the only step that is not self-service:
--
--   INSERT INTO public.admin_users (user_id, role, display_name, is_active)
--   SELECT id, 'owner', 'Your Name', true
--   FROM auth.users WHERE email = 'owner@shygon.tech'
--   ON CONFLICT (user_id) DO UPDATE
--     SET role = 'owner', is_active = true;
--
-- Any rows that already existed in admin_users are now role 'admin' and active,
-- because that is what the column defaults gave them. Review them:
--
--   SELECT a.user_id, u.email, a.role, a.is_active
--   FROM public.admin_users a JOIN auth.users u ON u.id = a.user_id;


-- ---------------------------------------------------------------------------
-- 24. VERIFICATION
-- ---------------------------------------------------------------------------
--   -- every admin table has RLS on
--   SELECT c.relname, c.relrowsecurity
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public'
--     AND c.relname IN ('admin_users','admin_audit_log','admin_notifications',
--                       'admin_notification_reads','admin_push_tokens',
--                       'inventory_movements');
--
--   -- a non-admin is refused (expect 42501)
--   SELECT public.admin_me();
--
--   -- an owner sees themselves and their full permission set
--   SELECT public.admin_me();
--
--   -- no admin function is reachable by anon
--   SELECT p.proname, array_agg(acl.privilege_type)
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   CROSS JOIN LATERAL aclexplode(p.proacl) acl
--   JOIN pg_roles r ON r.oid = acl.grantee
--   WHERE n.nspname = 'public' AND p.proname LIKE 'admin\_%' AND r.rolname = 'anon'
--   GROUP BY 1;
--   -- expect ZERO rows.
-- ============================================================================

-- ===================== DRY-RUN CHECKS (everything below is rolled back) =====
DO $dryrun$
DECLARE
  v_admin  uuid;
  v_email  text;
  v_role   text;
  r        text := '';
  v_order  uuid; v_cust uuid; v_tap uuid; v_ticket uuid; v_sku text; v_slug text;
  v_n      bigint;
BEGIN
  SELECT a.user_id, u.email, a.role INTO v_admin, v_email, v_role
  FROM public.admin_users a LEFT JOIN auth.users u ON u.id = a.user_id
  ORDER BY a.created_at LIMIT 1;
  r := r || format('admin row: %s role=%s | ', coalesce(v_email, '?'), coalesce(v_role, '?'));
  IF v_admin IS NULL THEN RAISE EXCEPTION 'DRYRUN: no admin row'; END IF;

  SELECT id INTO v_order FROM public.orders ORDER BY created_at DESC LIMIT 1;
  SELECT id INTO v_cust FROM public.profiles LIMIT 1;
  SELECT id, slug INTO v_tap, v_slug FROM public.tap_profiles WHERE slug IS NOT NULL LIMIT 1;
  SELECT id INTO v_ticket FROM public.support_tickets LIMIT 1;
  SELECT sku INTO v_sku FROM public.products WHERE sku IS NOT NULL LIMIT 1;

  -- Act as that admin, with owner rights, through the authenticated role.
  UPDATE public.admin_users SET role = 'owner', is_active = true WHERE user_id = v_admin;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  BEGIN PERFORM public.admin_me(); r := r || 'admin_me ok; '; EXCEPTION WHEN OTHERS THEN r := r || 'admin_me ERR ' || SQLERRM || '; '; END;
  BEGIN PERFORM public.admin_dashboard(); r := r || 'dashboard ok; '; EXCEPTION WHEN OTHERS THEN r := r || 'dashboard ERR ' || SQLERRM || '; '; END;
  BEGIN PERFORM public.admin_list_orders(NULL, NULL, NULL, 5, 0); r := r || 'list_orders ok; '; EXCEPTION WHEN OTHERS THEN r := r || 'list_orders ERR ' || SQLERRM || '; '; END;
  BEGIN PERFORM public.admin_list_customers(NULL, 5, 0); r := r || 'list_customers ok; '; EXCEPTION WHEN OTHERS THEN r := r || 'list_customers ERR ' || SQLERRM || '; '; END;
  BEGIN PERFORM public.admin_list_taps(NULL, NULL, 5, 0); r := r || 'list_taps ok; '; EXCEPTION WHEN OTHERS THEN r := r || 'list_taps ERR ' || SQLERRM || '; '; END;
  BEGIN PERFORM public.admin_list_products(NULL, NULL, 5, 0); r := r || 'list_products ok; '; EXCEPTION WHEN OTHERS THEN r := r || 'list_products ERR ' || SQLERRM || '; '; END;
  BEGIN PERFORM public.admin_list_tickets(NULL, NULL, 5, 0); r := r || 'list_tickets ok; '; EXCEPTION WHEN OTHERS THEN r := r || 'list_tickets ERR ' || SQLERRM || '; '; END;
  BEGIN PERFORM public.admin_analytics(7); r := r || 'analytics ok; '; EXCEPTION WHEN OTHERS THEN r := r || 'analytics ERR ' || SQLERRM || '; '; END;
  BEGIN PERFORM public.admin_list_audit(5, 0); r := r || 'list_audit ok; '; EXCEPTION WHEN OTHERS THEN r := r || 'list_audit ERR ' || SQLERRM || '; '; END;
  BEGIN PERFORM public.admin_list_admins(); r := r || 'list_admins ok; '; EXCEPTION WHEN OTHERS THEN r := r || 'list_admins ERR ' || SQLERRM || '; '; END;
  BEGIN PERFORM public.admin_list_email_domains(); r := r || 'list_domains ok; '; EXCEPTION WHEN OTHERS THEN r := r || 'list_domains ERR ' || SQLERRM || '; '; END;
  BEGIN PERFORM public.admin_list_notifications(5, 0); r := r || 'list_notifications ok; '; EXCEPTION WHEN OTHERS THEN r := r || 'list_notifications ERR ' || SQLERRM || '; '; END;
  IF v_sku IS NOT NULL THEN
    BEGIN PERFORM public.admin_inventory_history(v_sku, 5); r := r || 'inventory_history ok; '; EXCEPTION WHEN OTHERS THEN r := r || 'inventory_history ERR ' || SQLERRM || '; '; END;
    BEGIN PERFORM public.admin_update_product(v_sku, '{}'::jsonb); r := r || 'update_product(no-op) ok; '; EXCEPTION WHEN OTHERS THEN r := r || 'update_product ERR ' || SQLERRM || '; '; END;
  END IF;
  IF v_order IS NOT NULL THEN
    BEGIN PERFORM public.admin_get_order(v_order); r := r || 'get_order ok; '; EXCEPTION WHEN OTHERS THEN r := r || 'get_order ERR ' || SQLERRM || '; '; END;
  ELSE r := r || 'get_order skipped (no orders); '; END IF;
  IF v_cust IS NOT NULL THEN
    BEGIN PERFORM public.admin_get_customer(v_cust); r := r || 'get_customer ok; '; EXCEPTION WHEN OTHERS THEN r := r || 'get_customer ERR ' || SQLERRM || '; '; END;
  END IF;
  IF v_tap IS NOT NULL THEN
    BEGIN PERFORM public.admin_get_tap(v_tap); r := r || 'get_tap ok; '; EXCEPTION WHEN OTHERS THEN r := r || 'get_tap ERR ' || SQLERRM || '; '; END;
    BEGIN PERFORM public.admin_set_tap_suspension(v_tap, true, 'dry run'); r := r || 'suspend_tap ok; '; EXCEPTION WHEN OTHERS THEN r := r || 'suspend_tap ERR ' || SQLERRM || '; '; END;
  ELSE r := r || 'get_tap skipped (no taps); '; END IF;
  IF v_ticket IS NOT NULL THEN
    BEGIN PERFORM public.admin_get_ticket(v_ticket); r := r || 'get_ticket ok; '; EXCEPTION WHEN OTHERS THEN r := r || 'get_ticket ERR ' || SQLERRM || '; '; END;
    BEGIN PERFORM public.admin_reply_ticket(v_ticket, 'dry run'); r := r || 'reply_ticket ok; '; EXCEPTION WHEN OTHERS THEN r := r || 'reply_ticket ERR ' || SQLERRM || '; '; END;
  ELSE r := r || 'tickets skipped (none); '; END IF;

  -- A signed-out visitor.
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN SELECT count(*) INTO v_n FROM public.products; r := r || format('anon products=%s ok; ', v_n); EXCEPTION WHEN OTHERS THEN r := r || 'anon products ERR ' || SQLERRM || '; '; END;
  BEGIN PERFORM public.get_public_profile('no-such-slug-dryrun'); r := r || 'anon get_public_profile ok; '; EXCEPTION WHEN OTHERS THEN r := r || 'anon get_public_profile ERR ' || SQLERRM || '; '; END;
  BEGIN PERFORM public.get_public_tap('no-such-slug-dryrun'); r := r || 'anon get_public_tap ok; '; EXCEPTION WHEN OTHERS THEN r := r || 'anon get_public_tap ERR ' || SQLERRM || '; '; END;
  IF v_slug IS NOT NULL THEN
    BEGIN SELECT count(*) INTO v_n FROM public.get_public_tap(v_slug); r := r || format('suspended tap hidden=%s; ', v_n = 0); EXCEPTION WHEN OTHERS THEN r := r || 'suspended check ERR ' || SQLERRM || '; '; END;
  END IF;
  BEGIN PERFORM public.admin_me(); r := r || 'anon admin_me REACHABLE (BAD); '; EXCEPTION WHEN insufficient_privilege THEN r := r || 'anon admin_me denied ok; '; WHEN OTHERS THEN r := r || 'anon admin_me other: ' || SQLERRM || '; '; END;
  BEGIN SELECT count(*) INTO v_n FROM public.orders; r := r || format('anon orders visible=%s; ', v_n); EXCEPTION WHEN OTHERS THEN r := r || 'anon orders ERR ' || SQLERRM || '; '; END;
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'DRYRUN REPORT (rolled back): %', r;
END
$dryrun$;
