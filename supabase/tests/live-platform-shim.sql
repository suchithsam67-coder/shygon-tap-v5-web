-- Supabase-provided objects the live schema baseline depends on (M0.2).
--
-- supabase/baseline/000_live_baseline.sql is a `pg_dump --schema=public` of
-- the live project. It refers to a few things Supabase itself provides, outside
-- the `public` schema:
--   - roles: anon, authenticated, service_role, supabase_admin (postgres is
--     PGlite's own superuser);
--   - auth.users (foreign keys) and auth.uid() (policies and functions).
-- This file creates stand-ins for those, and nothing else, so that
-- supabase/tests/schema-drift.mjs can load the baseline into an isolated
-- in-memory PGlite database.
--
-- This is test scaffolding. It is NOT part of the live baseline and makes no
-- claim about how Supabase implements these objects. The auth stand-ins match
-- supabase/tests/baseline.sql, so both sides of the comparison see the same
-- auth objects.

CREATE SCHEMA IF NOT EXISTS auth;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN CREATE ROLE supabase_admin; END IF;
END $$;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
