-- 038: the owner's data export (V01 task T-10). One account's own data as JSON,
-- built by the server from explicit field lists, plus the public fields of its
-- Business profile for a vCard. Read and written only by the server
-- (/api/account); nothing here is reachable by a client role. No new table.
--
-- Decision:  DEC-2026-044, approved for the LOCAL BUILD by the owner in session
--            on 2026-11-03 ("Approve T-10 build", on Session A's recommended
--            answers): Q1 option A (a server operation and this migration);
--            Q2 finders' message text left out; Q3 nothing of the Connect
--            counterpart; Q4 contacts' last 4 digits only; Q5 the vCard has
--            the public fields only; Q6 5 exports per 24 hours, allowed while
--            suspended.
-- Level:     L3 (privileged functions reading every AAROH table for one
--            account). DEC-2026-018 cool-off plus checklist before any real
--            database. Never applied by tooling.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-026,
--            028-037. Needs 029, 031, 032, 033, 034 and 037.
--
-- THE RULE FOR EVERY FIELD (DEC-2026-044 §4.1)
--   1. The owner's own data is in.
--   2. Another person's personal data is out: finders' message text, the
--      Connect counterpart, full emergency-contact numbers, visitors, staff.
--   3. Security values are out: tokens and their hashes, OTP and code hashes,
--      idempotency keys, keyed digests, activation codes, chip UIDs, the
--      Verified Tap UID digest and counter, provider ids and retry fields.
--   Never `*` or to_jsonb(row): a column added later stays out until someone
--   adds it here, and test:account-export fails until every table linked to
--   an account is classified.
--
-- FUNCTIONS (service_role only)
--   account_export_build(p_user)    STABLE: the whole export as jsonb, from one
--                                   snapshot. Lists are newest first and capped
--                                   at 2,000 rows each; a capped list is named in
--                                   `truncated`.
--   account_export_request(p_user)  the operation: at most 5 per account per 24
--                                   hours (429 with retryAfter), then the export,
--                                   the vCard fields, and one account_events row
--                                   ('data_export'; the format and row counts,
--                                   never content). Serialised per account.
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT to_regprocedure('public.account_export_build(uuid)');                  -- NULL
--   SELECT to_regclass('public.tap_device_auth'), to_regclass('public.info_pages'); -- both NOT NULL
--
-- ROLLBACK (begin)
-- DROP FUNCTION IF EXISTS public.account_export_request(uuid);
-- DROP FUNCTION IF EXISTS public.account_export_build(uuid);
-- ROLLBACK (end)
--   ('data_export' rows already in account_events stay as the owner's history.)
--
-- Idempotent: safe to run more than once.

DO $needs$
BEGIN
  IF to_regclass('public.emergency_events') IS NULL OR to_regclass('public.rescue_threads') IS NULL
     OR to_regclass('public.consent_grants') IS NULL OR to_regclass('public.prive_demo_requests') IS NULL
     OR to_regclass('public.info_pages') IS NULL OR to_regclass('public.tap_device_auth') IS NULL THEN
    RAISE EXCEPTION '038: needs migrations 029, 031, 032, 033, 034 and 037; nothing changed';
  END IF;
END
$needs$;

CREATE OR REPLACE FUNCTION public.account_export_build(p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  c_cap constant integer := 2000;
  v_trunc text[] := '{}';
  v_customers uuid[];
  v_profile jsonb;
  v_customer jsonb;
  v_taps jsonb;
  v_customizations jsonb;
  v_mode_states jsonb;
  v_info jsonb;
  v_mode_audit jsonb;
  v_cards jsonb;
  v_orders jsonb;
  v_entitlements jsonb;
  v_em_settings jsonb;
  v_em_contacts jsonb;
  v_em_alerts jsonb;
  v_em_audit jsonb;
  v_rt_settings jsonb;
  v_rt_threads jsonb;
  v_rt_blocks integer;
  v_rt_audit jsonb;
  v_cn_settings jsonb;
  v_cn_connections jsonb;
  v_cn_given jsonb;
  v_cn_received jsonb;
  v_cn_audit jsonb;
  v_prive jsonb;
  v_notifications jsonb;
  v_support jsonb;
  v_events jsonb;
BEGIN
  v_customers := ARRAY(SELECT c.id FROM public.customers c WHERE c.user_id = p_user);

  -- Account
  SELECT jsonb_build_object(
      'fullName', p.full_name, 'bio', p.bio, 'profileImageUrl', p.profile_image_url,
      'phone', p.phone, 'whatsapp', p.whatsapp, 'email', p.email, 'instagram', p.instagram,
      'linkedin', p.linkedin, 'website', p.website, 'location', p.location,
      'company', p.company, 'jobTitle', p.job_title,
      'show', jsonb_build_object('phone', p.show_phone, 'whatsapp', p.show_whatsapp, 'email', p.show_email,
        'instagram', p.show_instagram, 'linkedin', p.show_linkedin, 'website', p.show_website, 'location', p.show_location),
      'notifyOrderUpdates', p.notify_order_updates, 'notifyTapActivity', p.notify_tap_activity,
      'createdAt', p.created_at, 'updatedAt', p.updated_at,
      'suspendedAt', p.suspended_at, 'suspendedReason', p.suspended_reason)
    INTO v_profile
    FROM public.profiles p WHERE p.id = p_user;
  SELECT jsonb_build_object('customerId', c.customer_id, 'registeredEmail', c.registered_email,
      'registeredPhone', c.registered_phone, 'accountStatus', c.account_status,
      'createdAt', c.created_at, 'updatedAt', c.updated_at)
    INTO v_customer
    FROM public.customers c WHERE c.user_id = p_user ORDER BY c.created_at LIMIT 1;

  -- Tap (one per account in v1; a list, so none is ever dropped)
  v_taps := COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'slug', t.slug, 'username', t.username, 'displayName', t.display_name, 'headline', t.headline,
      'designation', t.designation, 'company', t.company, 'bio', t.bio, 'avatarUrl', t.avatar_url,
      'location', t.location, 'phone', t.phone, 'whatsapp', t.whatsapp, 'email', t.email,
      'website', t.website, 'instagram', t.instagram, 'linkedin', t.linkedin, 'youtube', t.youtube,
      'customLinks', t.custom_links, 'shownFields', to_jsonb(t.enabled_customizations),
      'themeColor', t.theme_color,
      'theme', jsonb_build_object('palette', t.theme_palette, 'layout', t.theme_layout,
        'buttons', t.theme_buttons, 'font', t.theme_font, 'animation', t.theme_animation),
      'selectedUiTier', t.selected_ui_tier, 'status', t.status, 'published', t.published,
      'publishedAt', t.published_at, 'provisionedAt', t.provisioned_at,
      'lastContentEditAt', t.last_content_edit_at, 'editWindowStartedAt', t.edit_window_started_at,
      'createdAt', t.created_at, 'updatedAt', t.updated_at,
      'suspendedAt', t.suspended_at, 'suspendedReason', t.suspended_reason) ORDER BY t.created_at)
    FROM public.tap_profiles t WHERE t.user_id = p_user OR t.customer_id = ANY(v_customers)), '[]'::jsonb);
  v_customizations := COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'code', z.code, 'name', z.name, 'status', cc.status, 'purchasedAt', cc.purchased_at) ORDER BY cc.created_at)
    FROM public.customer_customizations cc LEFT JOIN public.customizations z ON z.id = cc.customization_id
    WHERE cc.customer_id = ANY(v_customers)), '[]'::jsonb);

  -- Modes and Info (034, 036)
  v_mode_states := COALESCE((SELECT jsonb_agg(jsonb_build_object('activeMode', s.active_mode,
      'previousMode', s.previous_mode, 'version', s.version, 'changedAt', s.changed_at))
    FROM public.tap_mode_state s WHERE s.user_id = p_user), '[]'::jsonb);
  SELECT jsonb_build_object('title', i.title, 'shortDescription', i.short_description, 'category', i.category,
      'detailedInformation', i.detailed_information, 'version', i.version,
      'createdAt', i.created_at, 'updatedAt', i.updated_at)
    INTO v_info
    FROM public.info_pages i WHERE i.owner_user_id = p_user;
  v_mode_audit := COALESCE((SELECT jsonb_agg(x.j ORDER BY x.at DESC, x.id) FROM (
      SELECT a.created_at AS at, a.id, jsonb_build_object('action', a.action, 'fromMode', a.from_mode,
        'toMode', a.to_mode, 'fields', to_jsonb(a.fields), 'actor', a.actor, 'at', a.created_at) AS j
      FROM public.tap_mode_audit a WHERE a.user_id = p_user
      ORDER BY a.created_at DESC, a.id LIMIT c_cap + 1) x), '[]'::jsonb);
  IF jsonb_array_length(v_mode_audit) > c_cap THEN v_mode_audit := v_mode_audit - c_cap; v_trunc := array_append(v_trunc, 'modes.audit'); END IF;

  -- Cards and their Verified Tap device (037). Never the activation code, the
  -- chip UID, its digest or its counter.
  v_cards := COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'cardId', c.card_id, 'cardType', c.card_type, 'sku', c.sku, 'nickname', c.nickname,
      'status', c.status, 'cardStatus', c.card_status, 'isReplacement', c.is_replacement, 'slot', c.card_slot,
      'edition', jsonb_build_object('design', c.edition_design, 'number', c.edition_serial,
        'of', c.edition_count, 'chapterSize', c.edition_chapter_size),
      'assignedAt', c.assigned_at, 'activatedAt', c.activated_at, 'activationCount', c.activation_count,
      'lastActivationAt', c.last_activation_at, 'deactivatedAt', c.deactivated_at,
      'createdAt', c.created_at, 'updatedAt', c.updated_at,
      'verifiedTap', (SELECT jsonb_build_object('code', d.public_code, 'keyEpoch', d.key_epoch,
          'lastVerifiedAt', d.last_verified_at, 'retiredAt', d.retired_at, 'registeredAt', d.created_at)
        FROM public.tap_device_auth d WHERE d.card_id = c.id)) ORDER BY c.created_at)
    FROM public.cards c WHERE c.user_id = p_user OR c.customer_id = ANY(v_customers)), '[]'::jsonb);

  -- Orders (kept for tax law after an account deletion), their items and
  -- status history. Not the admin-only payment ledger or staff notes.
  v_orders := COALESCE((SELECT jsonb_agg(x.j ORDER BY x.at DESC, x.id) FROM (
      SELECT o.created_at AS at, o.id, jsonb_build_object(
        'orderId', o.order_id, 'productName', o.product_name, 'material', o.material, 'plan', o.plan,
        'category', o.category, 'orderType', o.order_type, 'tier', o.tier,
        'amountInPaise', o.amount_in_paise, 'discountInPaise', o.discount_in_paise,
        'deliveryFeeInPaise', o.delivery_fee_in_paise, 'promoCode', o.promo_code,
        'paymentStatus', o.payment_status, 'orderStatus', o.order_status, 'fulfillmentStatus', o.fulfillment_status,
        'shipping', jsonb_build_object('name', o.shipping_name, 'phone', o.shipping_phone,
          'address', o.shipping_address, 'city', o.shipping_city, 'state', o.shipping_state,
          'pincode', o.shipping_pincode, 'carrier', o.shipping_carrier, 'trackingNumber', o.tracking_number),
        'customNote', o.custom_note,
        'razorpayOrderId', o.razorpay_order_id, 'razorpayPaymentId', o.razorpay_payment_id,
        'razorpayRefundId', o.razorpay_refund_id, 'refundAmountInPaise', o.refund_amount_in_paise,
        'cancellationReason', o.cancellation_reason,
        'createdAt', o.created_at, 'updatedAt', o.updated_at, 'fulfilledAt', o.fulfilled_at,
        'shippedAt', o.shipped_at, 'deliveredAt', o.delivered_at, 'cancelledAt', o.cancelled_at,
        'refundedAt', o.refunded_at,
        'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', it.name, 'sku', it.sku,
            'productType', it.product_type, 'unitPriceInPaise', it.unit_price_in_paise,
            'quantity', it.quantity, 'lineTotalInPaise', it.line_total_in_paise) ORDER BY it.created_at)
          FROM public.order_items it WHERE it.order_id = o.id), '[]'::jsonb),
        'statusHistory', COALESCE((SELECT jsonb_agg(jsonb_build_object('status', h.status,
            'trackingNumber', h.tracking_number, 'carrier', h.shipping_carrier, 'at', h.created_at) ORDER BY h.created_at)
          FROM public.order_status_history h WHERE h.order_id = o.id), '[]'::jsonb)) AS j
      FROM public.orders o WHERE o.user_id = p_user OR o.customer_id = p_user  -- orders.customer_id is the auth user (baseline)
      ORDER BY o.created_at DESC, o.id LIMIT c_cap + 1) x), '[]'::jsonb);
  IF jsonb_array_length(v_orders) > c_cap THEN v_orders := v_orders - c_cap; v_trunc := array_append(v_trunc, 'orders'); END IF;
  v_entitlements := COALESCE((SELECT jsonb_agg(jsonb_build_object('type', e.type, 'key', e.key,
      'isActive', e.is_active, 'grantedAt', e.granted_at) ORDER BY e.granted_at)
    FROM public.entitlements e WHERE e.user_id = p_user), '[]'::jsonb);

  -- Emergency (029). A contact's number shows only as its last 4 digits.
  SELECT jsonb_build_object('publicAlertsEnabled', s.public_alerts_enabled,
      'publicAlertsChangedAt', s.public_alerts_changed_at, 'updatedAt', s.updated_at)
    INTO v_em_settings
    FROM public.emergency_settings s WHERE s.user_id = p_user;
  v_em_contacts := COALESCE((SELECT jsonb_agg(jsonb_build_object('name', c.name, 'relationship', c.relationship,
      'channel', c.channel, 'last4', right(c.phone_e164, 4), 'verifiedAt', c.verified_at,
      'createdAt', c.created_at, 'updatedAt', c.updated_at) ORDER BY c.created_at)
    FROM public.emergency_contacts c WHERE c.user_id = p_user), '[]'::jsonb);
  v_em_alerts := COALESCE((SELECT jsonb_agg(x.j ORDER BY x.at DESC, x.id) FROM (
      SELECT e.created_at AS at, e.id, jsonb_build_object('initiator', e.initiator, 'status', e.status,
        'recipientCount', e.recipient_count, 'createdAt', e.created_at, 'completedAt', e.completed_at,
        'cancelledAt', e.cancelled_at, 'reportedAt', e.reported_at, 'reportReason', e.report_reason,
        'recipients', COALESCE((SELECT jsonb_agg(jsonb_build_object('contactName', r.contact_name,
            'channel', r.channel, 'status', r.status, 'acceptedAt', r.accepted_at,
            'deliveredAt', r.delivered_at, 'failedAt', r.failed_at) ORDER BY r.contact_name)
          FROM public.emergency_event_recipients r WHERE r.event_id = e.id), '[]'::jsonb)) AS j
      FROM public.emergency_events e WHERE e.user_id = p_user
      ORDER BY e.created_at DESC, e.id LIMIT c_cap + 1) x), '[]'::jsonb);
  IF jsonb_array_length(v_em_alerts) > c_cap THEN v_em_alerts := v_em_alerts - c_cap; v_trunc := array_append(v_trunc, 'emergency.alerts'); END IF;
  v_em_audit := COALESCE((SELECT jsonb_agg(x.j ORDER BY x.at DESC, x.id) FROM (
      SELECT a.created_at AS at, a.id, jsonb_build_object('actor', a.actor, 'action', a.action, 'at', a.created_at) AS j
      FROM public.emergency_audit a WHERE a.user_id = p_user
      ORDER BY a.created_at DESC, a.id LIMIT c_cap + 1) x), '[]'::jsonb);
  IF jsonb_array_length(v_em_audit) > c_cap THEN v_em_audit := v_em_audit - c_cap; v_trunc := array_append(v_trunc, 'emergency.audit'); END IF;

  -- Return to Owner (031): the owner's own replies and SHYGON's notices; a
  -- finder's words are counted, never copied (DEC-2026-044 Q2).
  SELECT jsonb_build_object('enabled', s.enabled, 'publicHint', s.public_hint,
      'changedAt', s.changed_at, 'updatedAt', s.updated_at)
    INTO v_rt_settings
    FROM public.rescue_settings s WHERE s.user_id = p_user;
  v_rt_threads := COALESCE((SELECT jsonb_agg(x.j ORDER BY x.at DESC, x.id) FROM (
      SELECT th.created_at AS at, th.id, jsonb_build_object('status', th.status,
        'createdAt', th.created_at, 'lastActivityAt', th.last_activity_at, 'closedAt', th.closed_at,
        'reportedAt', th.reported_at, 'reportReason', th.report_reason,
        'finderMessages', (SELECT count(*) FROM public.rescue_messages m WHERE m.thread_id = th.id AND m.sender = 'finder'),
        'messages', COALESCE((SELECT jsonb_agg(jsonb_build_object('from', m.sender, 'body', m.body, 'at', m.created_at)
            ORDER BY m.created_at, m.id)
          FROM public.rescue_messages m WHERE m.thread_id = th.id AND m.sender IN ('owner', 'system')), '[]'::jsonb)) AS j
      FROM public.rescue_threads th WHERE th.owner_user_id = p_user
      ORDER BY th.created_at DESC, th.id LIMIT c_cap + 1) x), '[]'::jsonb);
  IF jsonb_array_length(v_rt_threads) > c_cap THEN v_rt_threads := v_rt_threads - c_cap; v_trunc := array_append(v_trunc, 'returnToOwner.threads'); END IF;
  SELECT count(*)::integer INTO v_rt_blocks
    FROM public.rescue_blocks b WHERE b.owner_user_id = p_user AND (b.expires_at IS NULL OR b.expires_at > now());
  v_rt_audit := COALESCE((SELECT jsonb_agg(x.j ORDER BY x.at DESC, x.id) FROM (
      SELECT a.created_at AS at, a.id, jsonb_build_object('actor', a.actor, 'action', a.action, 'at', a.created_at) AS j
      FROM public.rescue_audit a WHERE a.user_id = p_user
      ORDER BY a.created_at DESC, a.id LIMIT c_cap + 1) x), '[]'::jsonb);
  IF jsonb_array_length(v_rt_audit) > c_cap THEN v_rt_audit := v_rt_audit - c_cap; v_trunc := array_append(v_trunc, 'returnToOwner.audit'); END IF;

  -- Connect (032): the owner's side only; nothing that identifies the other
  -- person, and their note stays theirs (DEC-2026-044 Q3).
  SELECT jsonb_build_object('enabled', s.enabled, 'updatedAt', s.updated_at)
    INTO v_cn_settings
    FROM public.connect_settings s WHERE s.user_id = p_user;
  v_cn_connections := COALESCE((SELECT jsonb_agg(x.j ORDER BY x.at DESC, x.id) FROM (
      SELECT c.created_at AS at, c.id, jsonb_build_object('id', c.id,
        'role', CASE WHEN c.requester_user_id = p_user THEN 'requested' ELSE 'received' END,
        'status', c.status,
        'note', CASE WHEN c.requester_user_id = p_user THEN c.note END,
        'createdAt', c.created_at, 'decidedAt', c.decided_at, 'endedAt', c.ended_at,
        'endedBy', CASE WHEN c.ended_by IS NULL THEN NULL WHEN c.ended_by = p_user THEN 'you' ELSE 'other' END) AS j
      FROM public.connections c WHERE c.requester_user_id = p_user OR c.target_user_id = p_user
      ORDER BY c.created_at DESC, c.id LIMIT c_cap + 1) x), '[]'::jsonb);
  IF jsonb_array_length(v_cn_connections) > c_cap THEN v_cn_connections := v_cn_connections - c_cap; v_trunc := array_append(v_trunc, 'connect.connections'); END IF;
  v_cn_given := COALESCE((SELECT jsonb_agg(jsonb_build_object('connectionId', g.connection_id,
      'resourceKind', g.resource_kind, 'scope', to_jsonb(g.scope), 'purpose', g.purpose, 'version', g.version,
      'grantedAt', g.granted_at, 'expiresAt', g.expires_at, 'revokedAt', g.revoked_at,
      'revokedBy', CASE WHEN g.revoked_by IS NULL THEN NULL WHEN g.revoked_by = p_user THEN 'you' ELSE 'other' END,
      'revokeReason', g.revoke_reason) ORDER BY g.granted_at, g.version)
    FROM public.consent_grants g WHERE g.grantor_user_id = p_user), '[]'::jsonb);
  v_cn_received := COALESCE((SELECT jsonb_agg(jsonb_build_object('connectionId', g.connection_id,
      'resourceKind', g.resource_kind, 'scope', to_jsonb(g.scope), 'purpose', g.purpose, 'version', g.version,
      'grantedAt', g.granted_at, 'expiresAt', g.expires_at, 'revokedAt', g.revoked_at) ORDER BY g.granted_at, g.version)
    FROM public.consent_grants g WHERE g.grantee_user_id = p_user), '[]'::jsonb);
  v_cn_audit := COALESCE((SELECT jsonb_agg(x.j ORDER BY x.at DESC, x.id) FROM (
      SELECT a.created_at AS at, a.id, jsonb_build_object('action', a.action, 'at', a.created_at) AS j
      FROM public.connect_audit a WHERE a.user_id = p_user
      ORDER BY a.created_at DESC, a.id LIMIT c_cap + 1) x), '[]'::jsonb);
  IF jsonb_array_length(v_cn_audit) > c_cap THEN v_cn_audit := v_cn_audit - c_cap; v_trunc := array_append(v_trunc, 'connect.audit'); END IF;

  -- Privé demo requests (033)
  v_prive := COALESCE((SELECT jsonb_agg(jsonb_build_object('hotel', h.name, 'service', r.service,
      'status', r.status, 'demo', r.is_demo, 'createdAt', r.created_at, 'updatedAt', r.updated_at,
      'completedAt', r.completed_at, 'cancelledAt', r.cancelled_at,
      'steps', COALESCE((SELECT jsonb_agg(jsonb_build_object('status', ev.status, 'actor', ev.actor, 'at', ev.at) ORDER BY ev.at)
        FROM public.prive_demo_request_events ev WHERE ev.request_id = r.id), '[]'::jsonb)) ORDER BY r.created_at DESC)
    FROM public.prive_demo_requests r LEFT JOIN public.prive_demo_hotels h ON h.id = r.hotel_id
    WHERE r.user_id = p_user), '[]'::jsonb);

  -- Notifications, support and account history
  v_notifications := COALESCE((SELECT jsonb_agg(x.j ORDER BY x.at DESC, x.id) FROM (
      SELECT n.created_at AS at, n.id, jsonb_build_object('category', n.category, 'title', n.title,
        'body', n.body, 'link', n.link, 'readAt', n.read_at, 'createdAt', n.created_at) AS j
      FROM public.notifications n WHERE n.user_id = p_user
      ORDER BY n.created_at DESC, n.id LIMIT c_cap + 1) x), '[]'::jsonb);
  IF jsonb_array_length(v_notifications) > c_cap THEN v_notifications := v_notifications - c_cap; v_trunc := array_append(v_trunc, 'notifications'); END IF;
  v_support := COALESCE((SELECT jsonb_agg(x.j ORDER BY x.at DESC, x.id) FROM (
      SELECT tk.created_at AS at, tk.id, jsonb_build_object('reference', tk.reference, 'subject', tk.subject,
        'category', tk.category, 'status', tk.status, 'createdAt', tk.created_at, 'updatedAt', tk.updated_at,
        'messages', COALESCE((SELECT jsonb_agg(jsonb_build_object('from', m.author_role, 'body', m.body, 'at', m.created_at)
            ORDER BY m.created_at, m.id)
          FROM public.support_messages m WHERE m.ticket_id = tk.id), '[]'::jsonb)) AS j
      FROM public.support_tickets tk WHERE tk.user_id = p_user
      ORDER BY tk.created_at DESC, tk.id LIMIT c_cap + 1) x), '[]'::jsonb);
  IF jsonb_array_length(v_support) > c_cap THEN v_support := v_support - c_cap; v_trunc := array_append(v_trunc, 'support'); END IF;
  v_events := COALESCE((SELECT jsonb_agg(x.j ORDER BY x.at DESC, x.id) FROM (
      SELECT e.created_at AS at, e.id, jsonb_build_object('eventType', e.event_type, 'subjectType', e.subject_type,
        'subjectId', e.subject_id, 'detail', e.detail, 'at', e.created_at) AS j
      FROM public.account_events e WHERE e.user_id = p_user
      ORDER BY e.created_at DESC, e.id LIMIT c_cap + 1) x), '[]'::jsonb);
  IF jsonb_array_length(v_events) > c_cap THEN v_events := v_events - c_cap; v_trunc := array_append(v_trunc, 'accountEvents'); END IF;

  RETURN jsonb_build_object(
    'format', 'shygon-account-export/2',
    'exportedAt', now(),
    'accountId', p_user,
    'account', jsonb_build_object('profile', v_profile, 'customer', v_customer),
    'taps', v_taps,
    'customizations', v_customizations,
    'modes', jsonb_build_object('states', v_mode_states, 'info', v_info, 'audit', v_mode_audit),
    'cards', v_cards,
    'orders', v_orders,
    'entitlements', v_entitlements,
    'emergency', jsonb_build_object('settings', v_em_settings, 'contacts', v_em_contacts,
      'alerts', v_em_alerts, 'audit', v_em_audit),
    'returnToOwner', jsonb_build_object('settings', v_rt_settings, 'threads', v_rt_threads,
      'activeBlocks', v_rt_blocks, 'audit', v_rt_audit),
    'connect', jsonb_build_object('settings', v_cn_settings, 'connections', v_cn_connections,
      'consentGiven', v_cn_given, 'consentReceived', v_cn_received, 'audit', v_cn_audit),
    'prive', v_prive,
    'notifications', v_notifications,
    'support', v_support,
    'accountEvents', v_events,
    'truncated', to_jsonb(v_trunc),
    'excluded', jsonb_build_array(
      jsonb_build_object('what', 'Messages written by people who found your card', 'why', 'They are the finder''s own words and may hold their contact details. Each conversation shows how many they sent.'),
      jsonb_build_object('what', 'The other person in a Connect connection', 'why', 'Their account, name, shared details and notes are theirs.'),
      jsonb_build_object('what', 'Your emergency contacts'' full numbers', 'why', 'They belong to your contacts. Each shows its last 4 digits, as your dashboard does.'),
      jsonb_build_object('what', 'Visitor statistics and verification checks', 'why', 'They describe the people who opened your Tap. Your analytics page summarises them.'),
      jsonb_build_object('what', 'Codes, keys and security values', 'why', 'Card activation codes, the chip''s serial number, one-time-code and token hashes, and internal keys protect your account and card.'),
      jsonb_build_object('what', 'Staff records', 'why', 'Admin notes, the payment ledger and staff identities. Each order already shows its amount, payment status and references.'),
      jsonb_build_object('what', 'Delivery details of messages SHYGON sent', 'why', 'Provider ids and retry records are internal. Each alert shows whether it was delivered.')));
END;
$$;

CREATE OR REPLACE FUNCTION public.account_export_request(p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  c_limit constant integer := 5;
  v_n integer;
  v_first timestamptz;
  v_export jsonb;
  v_counts jsonb;
  v_tap public.tap_profiles;
  v_owned text[];
  v_shown text[];
  v_card jsonb;
BEGIN
  IF p_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid_request'); END IF;
  -- One export at a time per account, so two requests cannot both pass the limit.
  PERFORM pg_advisory_xact_lock(hashtext('account_export:' || p_user::text));
  SELECT count(*)::integer, min(e.created_at) INTO v_n, v_first
    FROM public.account_events e
   WHERE e.user_id = p_user AND e.event_type = 'data_export' AND e.created_at > now() - interval '24 hours';
  IF v_n >= c_limit THEN
    RETURN jsonb_build_object('ok', false, 'code', 'rate_limited',
      'retryAfter', GREATEST(1, ceil(extract(epoch FROM (v_first + interval '24 hours' - now())))::integer));
  END IF;

  v_export := public.account_export_build(p_user);

  -- The vCard's fields: the Business profile's public fields only, by the same
  -- rule as get_public_profile (DEC-2026-044 Q5), whatever the mode or status.
  SELECT * INTO v_tap FROM public.tap_profiles WHERE user_id = p_user ORDER BY created_at LIMIT 1;
  IF FOUND THEN
    SELECT COALESCE(array_agg(e.key), '{}') INTO v_owned
      FROM public.entitlements e WHERE e.user_id = p_user AND e.is_active AND e.type = 'customization';
    v_shown := ARRAY(SELECT unnest(v_tap.enabled_customizations) INTERSECT SELECT unnest(v_owned || ARRAY['phone', 'email']));
    v_card := jsonb_build_object(
      'displayName', v_tap.display_name, 'headline', v_tap.headline,
      'designation', v_tap.designation, 'company', v_tap.company,
      'slug', CASE WHEN v_tap.status = 'active' AND v_tap.suspended_at IS NULL THEN v_tap.slug END,
      'location', CASE WHEN 'location' = ANY(v_shown) THEN v_tap.location END,
      'phone', CASE WHEN 'phone' = ANY(v_shown) THEN v_tap.phone END,
      'whatsapp', CASE WHEN 'whatsapp' = ANY(v_shown) THEN v_tap.whatsapp END,
      'email', CASE WHEN 'email' = ANY(v_shown) THEN v_tap.email END,
      'website', CASE WHEN 'website' = ANY(v_shown) THEN v_tap.website END,
      'instagram', CASE WHEN 'instagram' = ANY(v_shown) THEN v_tap.instagram END,
      'linkedin', CASE WHEN 'linkedin' = ANY(v_shown) THEN v_tap.linkedin END,
      'youtube', CASE WHEN 'youtube' = ANY(v_shown) THEN v_tap.youtube END);
  END IF;

  -- Row counts per list, never content.
  SELECT COALESCE(jsonb_object_agg(c.k, c.n), '{}'::jsonb) INTO v_counts FROM (
    SELECT e.key AS k, jsonb_array_length(e.value) AS n
      FROM jsonb_each(v_export) e
     WHERE jsonb_typeof(e.value) = 'array' AND e.key NOT IN ('truncated', 'excluded')
    UNION ALL
    SELECT e.key || '.' || s.key, jsonb_array_length(s.value)
      FROM jsonb_each(v_export) e,
           jsonb_each(CASE WHEN jsonb_typeof(e.value) = 'object' THEN e.value ELSE '{}'::jsonb END) s
     WHERE jsonb_typeof(s.value) = 'array') c;
  INSERT INTO public.account_events (user_id, event_type, subject_type, detail)
  VALUES (p_user, 'data_export', 'account', jsonb_build_object('format', v_export->>'format', 'counts', v_counts));

  RETURN jsonb_build_object('ok', true, 'export', v_export, 'card', v_card);
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.account_export_build(uuid)',
    'public.account_export_request(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;
