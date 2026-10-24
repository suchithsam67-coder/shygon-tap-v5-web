-- Account deletion: the account's data in the public schema.
-- Step 4 of docs/runbooks/RUNBOOK-account-deletion.md. Read that first.
--
-- Run ONLY inside that runbook: one request at a time, after its checks, with
-- the owner's authorisation for that request, in the Supabase SQL editor.
-- Never by tooling. IRREVERSIBLE: confirm a backup or point-in-time recovery
-- window before running it.
--
-- Replace the two placeholders below. The block refuses to run, and changes
-- nothing, unless:
--   - the account exists;
--   - it is not an administrator (admin_users);
--   - it has the privacy request on record (a support ticket in the 'privacy'
--     category with exactly that reference);
--   - none of its orders is still being fulfilled.
-- It is one statement, so it either does all of the below or none of it.
--
-- Deleted (Privacy Policy, "How long we keep it": account, profile and Tap
-- data; visit statistics; support conversations):
--   the Tap and its visit statistics, the profile, the customer record and its
--   customisations, entitlements, notifications, card one-time codes, account
--   events, and the support conversations, the deletion request included;
--   where migration 029 is applied, the emergency contacts (third-party
--   numbers), settings, verification codes, alerts with their recipients and
--   delivery attempts, and the emergency audit trail; where 031 is applied,
--   the Return-to-Owner settings, conversations (with their messages), blocks
--   and audit trail; where 032 is applied, Connect settings, connections (both
--   directions), the consent grants on them, and the Connect audit trail;
--   where 033 is applied, the Privé demo requests (with their steps).
-- Kept ("orders, invoices and payment records ... up to 8 years"):
--   orders, their items, payments and status history. A card stays as a
--   hardware record, unlinked from the account and retired, so it opens nothing.
-- Not here: the sign-in itself (auth.users), which is step 5 of the runbook.
--
-- Proven on the live baseline + 020 onward by supabase/tests/account-deletion.mjs,
-- which runs this file as written.

DO $$
DECLARE
  target  uuid := '<ACCOUNT ID>';         -- auth.users.id; an unreplaced placeholder fails here
  request text := '<REQUEST REFERENCE>';  -- the privacy ticket's reference, e.g. ST-1A2B3C4D
  busy    text;
  n_taps int; n_profiles int; n_customers int; n_entitlements int; n_notifications int;
  n_codes int; n_events int; n_tickets int; n_cards int; n_contacts int := 0; n_alerts int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = target) THEN
    RAISE EXCEPTION 'no account %', target;
  END IF;
  IF EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = target) THEN
    RAISE EXCEPTION 'account % is an administrator: this runbook does not delete administrators', target;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.support_tickets
                  WHERE user_id = target AND category = 'privacy' AND reference = request) THEN
    RAISE EXCEPTION 'no privacy request % on record for account %', request, target;
  END IF;
  SELECT string_agg(order_id, ', ') INTO busy FROM public.orders
   WHERE user_id = target AND fulfillment_status IN ('processing', 'retry');
  IF busy IS NOT NULL THEN
    RAISE EXCEPTION 'orders still being fulfilled: %; finish or refund them first', busy;
  END IF;

  -- Cards first: their links to the Tap and customer would otherwise only be cleared.
  UPDATE public.cards
     SET user_id = NULL, customer_id = NULL, tap_profile_id = NULL,
         status = 'suspended', card_status = 'retired', deactivated_at = COALESCE(deactivated_at, now())
   WHERE user_id = target OR customer_id IN (SELECT id FROM public.customers WHERE user_id = target);
  GET DIAGNOSTICS n_cards = ROW_COUNT;

  -- Emergency data (migration 029), only where it exists. Deleting the sign-in
  -- (step 5) would cascade to it, but an account with orders is anonymised,
  -- not deleted, so it is removed here. Alerts take their recipients and
  -- delivery attempts with them.
  IF to_regclass('public.emergency_contacts') IS NOT NULL THEN
    DELETE FROM public.emergency_events WHERE user_id = target;
    GET DIAGNOSTICS n_alerts = ROW_COUNT;
    DELETE FROM public.emergency_contact_challenges WHERE user_id = target;
    DELETE FROM public.emergency_contacts WHERE user_id = target;
    GET DIAGNOSTICS n_contacts = ROW_COUNT;
    DELETE FROM public.emergency_settings WHERE user_id = target;
    DELETE FROM public.emergency_audit WHERE user_id = target;
  END IF;
  -- Return-to-Owner conversations (migration 031), only where they exist.
  IF to_regclass('public.rescue_threads') IS NOT NULL THEN
    DELETE FROM public.rescue_threads WHERE owner_user_id = target;
    DELETE FROM public.rescue_blocks WHERE owner_user_id = target;
    DELETE FROM public.rescue_settings WHERE user_id = target;
    DELETE FROM public.rescue_audit WHERE user_id = target;
  END IF;
  -- Connect and its consent ledger (migration 032), only where they exist. The
  -- grants go with their connections.
  IF to_regclass('public.connections') IS NOT NULL THEN
    DELETE FROM public.connections WHERE requester_user_id = target OR target_user_id = target;
    DELETE FROM public.connect_settings WHERE user_id = target;
    DELETE FROM public.connect_audit WHERE user_id = target;
  END IF;
  -- Privé demo requests (migration 033), only where they exist; steps go with them.
  IF to_regclass('public.prive_demo_requests') IS NOT NULL THEN
    DELETE FROM public.prive_demo_requests WHERE user_id = target;
  END IF;
  -- Modes and Info (migration 034), only where they exist.
  IF to_regclass('public.info_pages') IS NOT NULL THEN
    DELETE FROM public.tap_mode_state WHERE user_id = target;
    DELETE FROM public.info_pages WHERE owner_user_id = target;
    DELETE FROM public.tap_mode_audit WHERE user_id = target;
  END IF;

  -- The Tap; its visit statistics (tap_events) go with it.
  DELETE FROM public.tap_profiles
   WHERE user_id = target OR customer_id IN (SELECT id FROM public.customers WHERE user_id = target);
  GET DIAGNOSTICS n_taps = ROW_COUNT;

  DELETE FROM public.entitlements WHERE user_id = target;
  GET DIAGNOSTICS n_entitlements = ROW_COUNT;
  DELETE FROM public.notifications WHERE user_id = target;
  GET DIAGNOSTICS n_notifications = ROW_COUNT;
  DELETE FROM public.card_otp_challenges WHERE user_id = target;
  GET DIAGNOSTICS n_codes = ROW_COUNT;
  DELETE FROM public.account_events WHERE user_id = target;
  GET DIAGNOSTICS n_events = ROW_COUNT;
  -- Support conversations; their messages go with them.
  DELETE FROM public.support_tickets WHERE user_id = target;
  GET DIAGNOSTICS n_tickets = ROW_COUNT;

  DELETE FROM public.profiles WHERE id = target;
  GET DIAGNOSTICS n_profiles = ROW_COUNT;
  -- The customer record; its customisations go with it.
  DELETE FROM public.customers WHERE user_id = target;
  GET DIAGNOSTICS n_customers = ROW_COUNT;

  RAISE NOTICE 'account %: deleted % Tap(s), % profile(s), % customer record(s), % entitlement(s), % notification(s), % card code(s), % account event(s), % support conversation(s), % emergency contact(s), % emergency alert(s); retired % card(s); orders and payments kept',
    target, n_taps, n_profiles, n_customers, n_entitlements, n_notifications, n_codes, n_events, n_tickets, n_contacts, n_alerts, n_cards;
END $$;
