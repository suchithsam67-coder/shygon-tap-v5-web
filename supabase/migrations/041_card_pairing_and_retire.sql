-- 041: card pairing ("tap to activate") and "report stolen" (V01 tasks T-08,
-- T-09): the V01 subset of DEC-2026-028's card lifecycle.
--
-- Decision:  DEC-2026-047, approved for the LOCAL BUILD by the owner in session
--            on 2026-11-10 ("Approve T-08/T-09 build", on Session A's
--            recommended answers): Q1 cards.status canonical, 'retired' for
--            owners, card_status frozen; Q2 tap to activate; Q3 guard AAROH
--            cards against other writers; Q4 a stolen card opens nothing; Q5
--            the Verified Tap Q5 deviation accepted (F-14); Q6 no expiry for
--            AAROH cards; Q7 only SHYGON support can undo a retirement.
-- Level:     L3 (card state rules; the Verified Tap lookup). DEC-2026-018
--            cool-off plus checklist before any real database. Never applied by
--            tooling.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-026,
--            028-040. Needs 037 (Verified Tap) and 039 (the export builder).
--
-- WHAT AN AAROH CARD IS HERE: a cards row with a tap_device_auth row (a
-- personalised MIFARE DESFire EV3 chip). V5 cards (no chip) keep every live path.
--
-- CHANGES
--   card_events              append-only: every move of an AAROH card's status
--                            through card_transition, and every refused one.
--   card_transition()        the one writer for new code (it records the event
--                            first; the guard recognises it by that row and the
--                            transaction id, never by a session setting). V01 moves: pending or
--                            shipped -> active; pending, shipped, active or
--                            suspended -> retired (terminal). Retiring also
--                            retires the chip (tap_device_auth.retired_at).
--   cards_guard_transition   BEFORE UPDATE OF status on cards: any other writer
--                            (delivery auto-activation, the printed code, card-otp,
--                            the admin app) that would make an AAROH card active,
--                            or bring one back from retired, leaves the row
--                            unchanged and is logged as refused. The frozen
--                            functions are not edited.
--   tap_device_auth.activated_counter  the SUN counter whose possession proof
--                            activated the card: a proof is single use.
--   verify_device_lookup     (037) a pending or shipped card issued to an owner
--                            answers 'pairing' (no Tap) so its genuine tap can
--                            carry a possession proof. Suspended cards are not
--                            pairable (O-7 stays closed for AAROH cards).
--   card_owner_list / _activate / _retire / _card   for /api/cards (service only).
--   account_export_build     (039) each card gains its history.
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT to_regclass('public.card_events');                                  -- NULL
--   SELECT status, count(*) FROM public.cards GROUP BY 1 ORDER BY 1;           -- the states in use
--   SELECT count(*) FROM public.tap_device_auth;                               -- AAROH cards (0 until the first batch)
--
-- ROLLBACK (begin)
-- CREATE OR REPLACE FUNCTION public.verify_device_lookup(p_code text, p_visitor text)
-- RETURNS jsonb
-- LANGUAGE plpgsql STABLE SECURITY DEFINER
-- SET search_path TO 'public', 'pg_temp'
-- AS $$
-- DECLARE
--   v_d public.tap_device_auth;
--   v_card public.cards;
--   v_tap public.tap_profiles;
--   v_mode text;
-- BEGIN
--   IF p_code IS NULL OR p_code !~ '^[a-z2-7]{16}$' THEN RETURN jsonb_build_object('state', 'unavailable'); END IF;
--   -- One visitor: 30 checks an hour, whatever the code (no per-code signal).
--   IF p_visitor IS NOT NULL AND (SELECT count(*) FROM public.tap_verify_events
--         WHERE visitor_digest = p_visitor AND created_at > now() - interval '1 hour') >= 30 THEN
--     RETURN jsonb_build_object('state', 'rate_limited', 'retryAfter', 3600);
--   END IF;
--   SELECT * INTO v_d FROM public.tap_device_auth WHERE public_code = p_code;
--   IF NOT FOUND OR v_d.card_id IS NULL THEN RETURN jsonb_build_object('state', 'unavailable'); END IF;
--   SELECT * INTO v_card FROM public.cards WHERE id = v_d.card_id;
--   IF NOT FOUND OR v_card.status IS DISTINCT FROM 'active' OR v_card.tap_profile_id IS NULL THEN
--     RETURN jsonb_build_object('state', 'unavailable');
--   END IF;
--   SELECT * INTO v_tap FROM public.tap_profiles t
--    WHERE t.id = v_card.tap_profile_id AND t.status = 'active' AND t.suspended_at IS NULL AND t.published IS TRUE;
--   IF NOT FOUND THEN RETURN jsonb_build_object('state', 'unavailable'); END IF;
--   -- One device: 20 refused checks an hour (an 8-byte MAC cannot be guessed at that rate).
--   IF (SELECT count(*) FROM public.tap_verify_events
--         WHERE public_code = p_code AND verdict = 'not_confirmed' AND created_at > now() - interval '1 hour') >= 20 THEN
--     RETURN jsonb_build_object('state', 'rate_limited', 'retryAfter', 3600);
--   END IF;
--   SELECT active_mode INTO v_mode FROM public.tap_mode_state WHERE tap_profile_id = v_tap.id;
--   -- A lost card (Lost mode, 036): the lifecycle answer replaces every verdict.
--   IF COALESCE(v_mode, 'business') = 'lost' THEN RETURN jsonb_build_object('state', 'lost', 'slug', v_tap.slug); END IF;
--   RETURN jsonb_build_object(
--     'state', CASE WHEN v_d.retired_at IS NOT NULL THEN 'retired' ELSE 'ready' END,
--     'slug', v_tap.slug, 'cardId', v_d.card_id, 'keyEpoch', v_d.key_epoch);
-- END;
-- $$;
--
-- CREATE OR REPLACE FUNCTION public.account_export_build(p_user uuid)
-- RETURNS jsonb
-- LANGUAGE plpgsql STABLE SECURITY DEFINER
-- SET search_path TO 'public', 'pg_temp'
-- AS $$
-- DECLARE
--   c_cap constant integer := 2000;
--   v_trunc text[] := '{}';
--   v_customers uuid[];
--   v_profile jsonb;
--   v_customer jsonb;
--   v_taps jsonb;
--   v_customizations jsonb;
--   v_mode_states jsonb;
--   v_info jsonb;
--   v_mode_audit jsonb;
--   v_cards jsonb;
--   v_orders jsonb;
--   v_entitlements jsonb;
--   v_em_settings jsonb;
--   v_em_contacts jsonb;
--   v_em_alerts jsonb;
--   v_em_audit jsonb;
--   v_rt_settings jsonb;
--   v_rt_threads jsonb;
--   v_rt_blocks integer;
--   v_rt_audit jsonb;
--   v_cn_settings jsonb;
--   v_cn_connections jsonb;
--   v_cn_given jsonb;
--   v_cn_received jsonb;
--   v_cn_audit jsonb;
--   v_prive jsonb;
--   v_notifications jsonb;
--   v_support jsonb;
--   v_events jsonb;
--   v_phone jsonb;
-- BEGIN
--   v_customers := ARRAY(SELECT c.id FROM public.customers c WHERE c.user_id = p_user);
--
--   -- Account
--   SELECT jsonb_build_object(
--       'fullName', p.full_name, 'bio', p.bio, 'profileImageUrl', p.profile_image_url,
--       'phone', p.phone, 'whatsapp', p.whatsapp, 'email', p.email, 'instagram', p.instagram,
--       'linkedin', p.linkedin, 'website', p.website, 'location', p.location,
--       'company', p.company, 'jobTitle', p.job_title,
--       'show', jsonb_build_object('phone', p.show_phone, 'whatsapp', p.show_whatsapp, 'email', p.show_email,
--         'instagram', p.show_instagram, 'linkedin', p.show_linkedin, 'website', p.show_website, 'location', p.show_location),
--       'notifyOrderUpdates', p.notify_order_updates, 'notifyTapActivity', p.notify_tap_activity,
--       'createdAt', p.created_at, 'updatedAt', p.updated_at,
--       'suspendedAt', p.suspended_at, 'suspendedReason', p.suspended_reason)
--     INTO v_profile
--     FROM public.profiles p WHERE p.id = p_user;
--   SELECT jsonb_build_object('customerId', c.customer_id, 'registeredEmail', c.registered_email,
--       'registeredPhone', c.registered_phone, 'accountStatus', c.account_status,
--       'createdAt', c.created_at, 'updatedAt', c.updated_at)
--     INTO v_customer
--     FROM public.customers c WHERE c.user_id = p_user ORDER BY c.created_at LIMIT 1;
--
--   -- Tap (one per account in v1; a list, so none is ever dropped)
--   v_taps := COALESCE((SELECT jsonb_agg(jsonb_build_object(
--       'slug', t.slug, 'username', t.username, 'displayName', t.display_name, 'headline', t.headline,
--       'designation', t.designation, 'company', t.company, 'bio', t.bio, 'avatarUrl', t.avatar_url,
--       'location', t.location, 'phone', t.phone, 'whatsapp', t.whatsapp, 'email', t.email,
--       'website', t.website, 'instagram', t.instagram, 'linkedin', t.linkedin, 'youtube', t.youtube,
--       'customLinks', t.custom_links, 'shownFields', to_jsonb(t.enabled_customizations),
--       'themeColor', t.theme_color,
--       'theme', jsonb_build_object('palette', t.theme_palette, 'layout', t.theme_layout,
--         'buttons', t.theme_buttons, 'font', t.theme_font, 'animation', t.theme_animation),
--       'selectedUiTier', t.selected_ui_tier, 'status', t.status, 'published', t.published,
--       'publishedAt', t.published_at, 'provisionedAt', t.provisioned_at,
--       'lastContentEditAt', t.last_content_edit_at, 'editWindowStartedAt', t.edit_window_started_at,
--       'createdAt', t.created_at, 'updatedAt', t.updated_at,
--       'suspendedAt', t.suspended_at, 'suspendedReason', t.suspended_reason) ORDER BY t.created_at)
--     FROM public.tap_profiles t WHERE t.user_id = p_user OR t.customer_id = ANY(v_customers)), '[]'::jsonb);
--   v_customizations := COALESCE((SELECT jsonb_agg(jsonb_build_object(
--       'code', z.code, 'name', z.name, 'status', cc.status, 'purchasedAt', cc.purchased_at) ORDER BY cc.created_at)
--     FROM public.customer_customizations cc LEFT JOIN public.customizations z ON z.id = cc.customization_id
--     WHERE cc.customer_id = ANY(v_customers)), '[]'::jsonb);
--
--   -- Modes and Info (034, 036)
--   v_mode_states := COALESCE((SELECT jsonb_agg(jsonb_build_object('activeMode', s.active_mode,
--       'previousMode', s.previous_mode, 'version', s.version, 'changedAt', s.changed_at))
--     FROM public.tap_mode_state s WHERE s.user_id = p_user), '[]'::jsonb);
--   SELECT jsonb_build_object('title', i.title, 'shortDescription', i.short_description, 'category', i.category,
--       'detailedInformation', i.detailed_information, 'version', i.version,
--       'createdAt', i.created_at, 'updatedAt', i.updated_at)
--     INTO v_info
--     FROM public.info_pages i WHERE i.owner_user_id = p_user;
--   v_mode_audit := COALESCE((SELECT jsonb_agg(x.j ORDER BY x.at DESC, x.id) FROM (
--       SELECT a.created_at AS at, a.id, jsonb_build_object('action', a.action, 'fromMode', a.from_mode,
--         'toMode', a.to_mode, 'fields', to_jsonb(a.fields), 'actor', a.actor, 'at', a.created_at) AS j
--       FROM public.tap_mode_audit a WHERE a.user_id = p_user
--       ORDER BY a.created_at DESC, a.id LIMIT c_cap + 1) x), '[]'::jsonb);
--   IF jsonb_array_length(v_mode_audit) > c_cap THEN v_mode_audit := v_mode_audit - c_cap; v_trunc := array_append(v_trunc, 'modes.audit'); END IF;
--
--   -- Cards and their Verified Tap device (037). Never the activation code, the
--   -- chip UID, its digest or its counter.
--   v_cards := COALESCE((SELECT jsonb_agg(jsonb_build_object(
--       'cardId', c.card_id, 'cardType', c.card_type, 'sku', c.sku, 'nickname', c.nickname,
--       'status', c.status, 'cardStatus', c.card_status, 'isReplacement', c.is_replacement, 'slot', c.card_slot,
--       'edition', jsonb_build_object('design', c.edition_design, 'number', c.edition_serial,
--         'of', c.edition_count, 'chapterSize', c.edition_chapter_size),
--       'assignedAt', c.assigned_at, 'activatedAt', c.activated_at, 'activationCount', c.activation_count,
--       'lastActivationAt', c.last_activation_at, 'deactivatedAt', c.deactivated_at,
--       'createdAt', c.created_at, 'updatedAt', c.updated_at,
--       'verifiedTap', (SELECT jsonb_build_object('code', d.public_code, 'keyEpoch', d.key_epoch,
--           'lastVerifiedAt', d.last_verified_at, 'retiredAt', d.retired_at, 'registeredAt', d.created_at)
--         FROM public.tap_device_auth d WHERE d.card_id = c.id)) ORDER BY c.created_at)
--     FROM public.cards c WHERE c.user_id = p_user OR c.customer_id = ANY(v_customers)), '[]'::jsonb);
--
--   -- Orders (kept for tax law after an account deletion), their items and
--   -- status history. Not the admin-only payment ledger or staff notes.
--   v_orders := COALESCE((SELECT jsonb_agg(x.j ORDER BY x.at DESC, x.id) FROM (
--       SELECT o.created_at AS at, o.id, jsonb_build_object(
--         'orderId', o.order_id, 'productName', o.product_name, 'material', o.material, 'plan', o.plan,
--         'category', o.category, 'orderType', o.order_type, 'tier', o.tier,
--         'amountInPaise', o.amount_in_paise, 'discountInPaise', o.discount_in_paise,
--         'deliveryFeeInPaise', o.delivery_fee_in_paise, 'promoCode', o.promo_code,
--         'paymentStatus', o.payment_status, 'orderStatus', o.order_status, 'fulfillmentStatus', o.fulfillment_status,
--         'shipping', jsonb_build_object('name', o.shipping_name, 'phone', o.shipping_phone,
--           'address', o.shipping_address, 'city', o.shipping_city, 'state', o.shipping_state,
--           'pincode', o.shipping_pincode, 'carrier', o.shipping_carrier, 'trackingNumber', o.tracking_number),
--         'customNote', o.custom_note,
--         'razorpayOrderId', o.razorpay_order_id, 'razorpayPaymentId', o.razorpay_payment_id,
--         'razorpayRefundId', o.razorpay_refund_id, 'refundAmountInPaise', o.refund_amount_in_paise,
--         'cancellationReason', o.cancellation_reason,
--         'createdAt', o.created_at, 'updatedAt', o.updated_at, 'fulfilledAt', o.fulfilled_at,
--         'shippedAt', o.shipped_at, 'deliveredAt', o.delivered_at, 'cancelledAt', o.cancelled_at,
--         'refundedAt', o.refunded_at,
--         'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', it.name, 'sku', it.sku,
--             'productType', it.product_type, 'unitPriceInPaise', it.unit_price_in_paise,
--             'quantity', it.quantity, 'lineTotalInPaise', it.line_total_in_paise) ORDER BY it.created_at)
--           FROM public.order_items it WHERE it.order_id = o.id), '[]'::jsonb),
--         'statusHistory', COALESCE((SELECT jsonb_agg(jsonb_build_object('status', h.status,
--             'trackingNumber', h.tracking_number, 'carrier', h.shipping_carrier, 'at', h.created_at) ORDER BY h.created_at)
--           FROM public.order_status_history h WHERE h.order_id = o.id), '[]'::jsonb)) AS j
--       FROM public.orders o WHERE o.user_id = p_user OR o.customer_id = p_user  -- orders.customer_id is the auth user (baseline)
--       ORDER BY o.created_at DESC, o.id LIMIT c_cap + 1) x), '[]'::jsonb);
--   IF jsonb_array_length(v_orders) > c_cap THEN v_orders := v_orders - c_cap; v_trunc := array_append(v_trunc, 'orders'); END IF;
--   v_entitlements := COALESCE((SELECT jsonb_agg(jsonb_build_object('type', e.type, 'key', e.key,
--       'isActive', e.is_active, 'grantedAt', e.granted_at) ORDER BY e.granted_at)
--     FROM public.entitlements e WHERE e.user_id = p_user), '[]'::jsonb);
--
--   -- Emergency (029). A contact's number shows only as its last 4 digits.
--   SELECT jsonb_build_object('publicAlertsEnabled', s.public_alerts_enabled,
--       'publicAlertsChangedAt', s.public_alerts_changed_at, 'updatedAt', s.updated_at)
--     INTO v_em_settings
--     FROM public.emergency_settings s WHERE s.user_id = p_user;
--   v_em_contacts := COALESCE((SELECT jsonb_agg(jsonb_build_object('name', c.name, 'relationship', c.relationship,
--       'channel', c.channel, 'last4', right(c.phone_e164, 4), 'verifiedAt', c.verified_at,
--       'createdAt', c.created_at, 'updatedAt', c.updated_at) ORDER BY c.created_at)
--     FROM public.emergency_contacts c WHERE c.user_id = p_user), '[]'::jsonb);
--   v_em_alerts := COALESCE((SELECT jsonb_agg(x.j ORDER BY x.at DESC, x.id) FROM (
--       SELECT e.created_at AS at, e.id, jsonb_build_object('initiator', e.initiator, 'status', e.status,
--         'recipientCount', e.recipient_count, 'createdAt', e.created_at, 'completedAt', e.completed_at,
--         'cancelledAt', e.cancelled_at, 'reportedAt', e.reported_at, 'reportReason', e.report_reason,
--         'recipients', COALESCE((SELECT jsonb_agg(jsonb_build_object('contactName', r.contact_name,
--             'channel', r.channel, 'status', r.status, 'acceptedAt', r.accepted_at,
--             'deliveredAt', r.delivered_at, 'failedAt', r.failed_at) ORDER BY r.contact_name)
--           FROM public.emergency_event_recipients r WHERE r.event_id = e.id), '[]'::jsonb)) AS j
--       FROM public.emergency_events e WHERE e.user_id = p_user
--       ORDER BY e.created_at DESC, e.id LIMIT c_cap + 1) x), '[]'::jsonb);
--   IF jsonb_array_length(v_em_alerts) > c_cap THEN v_em_alerts := v_em_alerts - c_cap; v_trunc := array_append(v_trunc, 'emergency.alerts'); END IF;
--   v_em_audit := COALESCE((SELECT jsonb_agg(x.j ORDER BY x.at DESC, x.id) FROM (
--       SELECT a.created_at AS at, a.id, jsonb_build_object('actor', a.actor, 'action', a.action, 'at', a.created_at) AS j
--       FROM public.emergency_audit a WHERE a.user_id = p_user
--       ORDER BY a.created_at DESC, a.id LIMIT c_cap + 1) x), '[]'::jsonb);
--   IF jsonb_array_length(v_em_audit) > c_cap THEN v_em_audit := v_em_audit - c_cap; v_trunc := array_append(v_trunc, 'emergency.audit'); END IF;
--
--   -- Return to Owner (031): the owner's own replies and SHYGON's notices; a
--   -- finder's words are counted, never copied (DEC-2026-044 Q2).
--   SELECT jsonb_build_object('enabled', s.enabled, 'publicHint', s.public_hint,
--       'changedAt', s.changed_at, 'updatedAt', s.updated_at)
--     INTO v_rt_settings
--     FROM public.rescue_settings s WHERE s.user_id = p_user;
--   v_rt_threads := COALESCE((SELECT jsonb_agg(x.j ORDER BY x.at DESC, x.id) FROM (
--       SELECT th.created_at AS at, th.id, jsonb_build_object('status', th.status,
--         'createdAt', th.created_at, 'lastActivityAt', th.last_activity_at, 'closedAt', th.closed_at,
--         'reportedAt', th.reported_at, 'reportReason', th.report_reason,
--         'finderMessages', (SELECT count(*) FROM public.rescue_messages m WHERE m.thread_id = th.id AND m.sender = 'finder'),
--         'messages', COALESCE((SELECT jsonb_agg(jsonb_build_object('from', m.sender, 'body', m.body, 'at', m.created_at)
--             ORDER BY m.created_at, m.id)
--           FROM public.rescue_messages m WHERE m.thread_id = th.id AND m.sender IN ('owner', 'system')), '[]'::jsonb)) AS j
--       FROM public.rescue_threads th WHERE th.owner_user_id = p_user
--       ORDER BY th.created_at DESC, th.id LIMIT c_cap + 1) x), '[]'::jsonb);
--   IF jsonb_array_length(v_rt_threads) > c_cap THEN v_rt_threads := v_rt_threads - c_cap; v_trunc := array_append(v_trunc, 'returnToOwner.threads'); END IF;
--   SELECT count(*)::integer INTO v_rt_blocks
--     FROM public.rescue_blocks b WHERE b.owner_user_id = p_user AND (b.expires_at IS NULL OR b.expires_at > now());
--   v_rt_audit := COALESCE((SELECT jsonb_agg(x.j ORDER BY x.at DESC, x.id) FROM (
--       SELECT a.created_at AS at, a.id, jsonb_build_object('actor', a.actor, 'action', a.action, 'at', a.created_at) AS j
--       FROM public.rescue_audit a WHERE a.user_id = p_user
--       ORDER BY a.created_at DESC, a.id LIMIT c_cap + 1) x), '[]'::jsonb);
--   IF jsonb_array_length(v_rt_audit) > c_cap THEN v_rt_audit := v_rt_audit - c_cap; v_trunc := array_append(v_trunc, 'returnToOwner.audit'); END IF;
--
--   -- Connect (032): the owner's side only; nothing that identifies the other
--   -- person, and their note stays theirs (DEC-2026-044 Q3).
--   SELECT jsonb_build_object('enabled', s.enabled, 'updatedAt', s.updated_at)
--     INTO v_cn_settings
--     FROM public.connect_settings s WHERE s.user_id = p_user;
--   v_cn_connections := COALESCE((SELECT jsonb_agg(x.j ORDER BY x.at DESC, x.id) FROM (
--       SELECT c.created_at AS at, c.id, jsonb_build_object('id', c.id,
--         'role', CASE WHEN c.requester_user_id = p_user THEN 'requested' ELSE 'received' END,
--         'status', c.status,
--         'note', CASE WHEN c.requester_user_id = p_user THEN c.note END,
--         'createdAt', c.created_at, 'decidedAt', c.decided_at, 'endedAt', c.ended_at,
--         'endedBy', CASE WHEN c.ended_by IS NULL THEN NULL WHEN c.ended_by = p_user THEN 'you' ELSE 'other' END) AS j
--       FROM public.connections c WHERE c.requester_user_id = p_user OR c.target_user_id = p_user
--       ORDER BY c.created_at DESC, c.id LIMIT c_cap + 1) x), '[]'::jsonb);
--   IF jsonb_array_length(v_cn_connections) > c_cap THEN v_cn_connections := v_cn_connections - c_cap; v_trunc := array_append(v_trunc, 'connect.connections'); END IF;
--   v_cn_given := COALESCE((SELECT jsonb_agg(jsonb_build_object('connectionId', g.connection_id,
--       'resourceKind', g.resource_kind, 'scope', to_jsonb(g.scope), 'purpose', g.purpose, 'version', g.version,
--       'grantedAt', g.granted_at, 'expiresAt', g.expires_at, 'revokedAt', g.revoked_at,
--       'revokedBy', CASE WHEN g.revoked_by IS NULL THEN NULL WHEN g.revoked_by = p_user THEN 'you' ELSE 'other' END,
--       'revokeReason', g.revoke_reason) ORDER BY g.granted_at, g.version)
--     FROM public.consent_grants g WHERE g.grantor_user_id = p_user), '[]'::jsonb);
--   v_cn_received := COALESCE((SELECT jsonb_agg(jsonb_build_object('connectionId', g.connection_id,
--       'resourceKind', g.resource_kind, 'scope', to_jsonb(g.scope), 'purpose', g.purpose, 'version', g.version,
--       'grantedAt', g.granted_at, 'expiresAt', g.expires_at, 'revokedAt', g.revoked_at) ORDER BY g.granted_at, g.version)
--     FROM public.consent_grants g WHERE g.grantee_user_id = p_user), '[]'::jsonb);
--   v_cn_audit := COALESCE((SELECT jsonb_agg(x.j ORDER BY x.at DESC, x.id) FROM (
--       SELECT a.created_at AS at, a.id, jsonb_build_object('action', a.action, 'at', a.created_at) AS j
--       FROM public.connect_audit a WHERE a.user_id = p_user
--       ORDER BY a.created_at DESC, a.id LIMIT c_cap + 1) x), '[]'::jsonb);
--   IF jsonb_array_length(v_cn_audit) > c_cap THEN v_cn_audit := v_cn_audit - c_cap; v_trunc := array_append(v_trunc, 'connect.audit'); END IF;
--
--   -- Privé demo requests (033)
--   v_prive := COALESCE((SELECT jsonb_agg(jsonb_build_object('hotel', h.name, 'service', r.service,
--       'status', r.status, 'demo', r.is_demo, 'createdAt', r.created_at, 'updatedAt', r.updated_at,
--       'completedAt', r.completed_at, 'cancelledAt', r.cancelled_at,
--       'steps', COALESCE((SELECT jsonb_agg(jsonb_build_object('status', ev.status, 'actor', ev.actor, 'at', ev.at) ORDER BY ev.at)
--         FROM public.prive_demo_request_events ev WHERE ev.request_id = r.id), '[]'::jsonb)) ORDER BY r.created_at DESC)
--     FROM public.prive_demo_requests r LEFT JOIN public.prive_demo_hotels h ON h.id = r.hotel_id
--     WHERE r.user_id = p_user), '[]'::jsonb);
--
--   -- Notifications, support and account history
--   v_notifications := COALESCE((SELECT jsonb_agg(x.j ORDER BY x.at DESC, x.id) FROM (
--       SELECT n.created_at AS at, n.id, jsonb_build_object('category', n.category, 'title', n.title,
--         'body', n.body, 'link', n.link, 'readAt', n.read_at, 'createdAt', n.created_at) AS j
--       FROM public.notifications n WHERE n.user_id = p_user
--       ORDER BY n.created_at DESC, n.id LIMIT c_cap + 1) x), '[]'::jsonb);
--   IF jsonb_array_length(v_notifications) > c_cap THEN v_notifications := v_notifications - c_cap; v_trunc := array_append(v_trunc, 'notifications'); END IF;
--   v_support := COALESCE((SELECT jsonb_agg(x.j ORDER BY x.at DESC, x.id) FROM (
--       SELECT tk.created_at AS at, tk.id, jsonb_build_object('reference', tk.reference, 'subject', tk.subject,
--         'category', tk.category, 'status', tk.status, 'createdAt', tk.created_at, 'updatedAt', tk.updated_at,
--         'messages', COALESCE((SELECT jsonb_agg(jsonb_build_object('from', m.author_role, 'body', m.body, 'at', m.created_at)
--             ORDER BY m.created_at, m.id)
--           FROM public.support_messages m WHERE m.ticket_id = tk.id), '[]'::jsonb)) AS j
--       FROM public.support_tickets tk WHERE tk.user_id = p_user
--       ORDER BY tk.created_at DESC, tk.id LIMIT c_cap + 1) x), '[]'::jsonb);
--   IF jsonb_array_length(v_support) > c_cap THEN v_support := v_support - c_cap; v_trunc := array_append(v_trunc, 'support'); END IF;
--   v_events := COALESCE((SELECT jsonb_agg(x.j ORDER BY x.at DESC, x.id) FROM (
--       SELECT e.created_at AS at, e.id, jsonb_build_object('eventType', e.event_type, 'subjectType', e.subject_type,
--         'subjectId', e.subject_id, 'detail', e.detail, 'at', e.created_at) AS j
--       FROM public.account_events e WHERE e.user_id = p_user
--       ORDER BY e.created_at DESC, e.id LIMIT c_cap + 1) x), '[]'::jsonb);
--   IF jsonb_array_length(v_events) > c_cap THEN v_events := v_events - c_cap; v_trunc := array_append(v_trunc, 'accountEvents'); END IF;
--
--   -- Account phone verification (039): the verified number shows only as its
--   -- last 4 digits; the codes are security values and stay out.
--   SELECT jsonb_build_object('last4', right(v.phone_e164, 4), 'verifiedAt', v.verified_at,
--       'usableFrom', v.usable_from, 'replacedAt', v.replaced_at)
--     INTO v_phone
--     FROM public.account_phone_verifications v WHERE v.user_id = p_user;
--
--   RETURN jsonb_build_object(
--     'format', 'shygon-account-export/2',
--     'exportedAt', now(),
--     'accountId', p_user,
--     'account', jsonb_build_object('profile', v_profile, 'customer', v_customer),
--     'phoneVerification', v_phone,
--     'taps', v_taps,
--     'customizations', v_customizations,
--     'modes', jsonb_build_object('states', v_mode_states, 'info', v_info, 'audit', v_mode_audit),
--     'cards', v_cards,
--     'orders', v_orders,
--     'entitlements', v_entitlements,
--     'emergency', jsonb_build_object('settings', v_em_settings, 'contacts', v_em_contacts,
--       'alerts', v_em_alerts, 'audit', v_em_audit),
--     'returnToOwner', jsonb_build_object('settings', v_rt_settings, 'threads', v_rt_threads,
--       'activeBlocks', v_rt_blocks, 'audit', v_rt_audit),
--     'connect', jsonb_build_object('settings', v_cn_settings, 'connections', v_cn_connections,
--       'consentGiven', v_cn_given, 'consentReceived', v_cn_received, 'audit', v_cn_audit),
--     'prive', v_prive,
--     'notifications', v_notifications,
--     'support', v_support,
--     'accountEvents', v_events,
--     'truncated', to_jsonb(v_trunc),
--     'excluded', jsonb_build_array(
--       jsonb_build_object('what', 'Messages written by people who found your card', 'why', 'They are the finder''s own words and may hold their contact details. Each conversation shows how many they sent.'),
--       jsonb_build_object('what', 'The other person in a Connect connection', 'why', 'Their account, name, shared details and notes are theirs.'),
--       jsonb_build_object('what', 'Your emergency contacts'' full numbers', 'why', 'They belong to your contacts. Each shows its last 4 digits, as your dashboard does.'),
--       jsonb_build_object('what', 'Visitor statistics and verification checks', 'why', 'They describe the people who opened your Tap. Your analytics page summarises them.'),
--       jsonb_build_object('what', 'Codes, keys and security values', 'why', 'Card activation codes, the chip''s serial number, one-time-code and token hashes, and internal keys protect your account and card.'),
--       jsonb_build_object('what', 'Staff records', 'why', 'Admin notes, the payment ledger and staff identities. Each order already shows its amount, payment status and references.'),
--       jsonb_build_object('what', 'Delivery details of messages SHYGON sent', 'why', 'Provider ids and retry records are internal. Each alert shows whether it was delivered.')));
-- END;
-- $$;
--
-- DROP TRIGGER IF EXISTS trg_cards_guard_transition ON public.cards;
-- DROP FUNCTION IF EXISTS public.cards_guard_transition();
-- DROP FUNCTION IF EXISTS public.card_owner_retire(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.card_owner_activate(uuid, uuid, text, integer);
-- DROP FUNCTION IF EXISTS public.card_owner_list(uuid);
-- DROP FUNCTION IF EXISTS public.card_owner_card(uuid);
-- DROP FUNCTION IF EXISTS public.card_transition(uuid, text, text, text);
-- DROP TABLE IF EXISTS public.card_events;
-- ALTER TABLE public.tap_device_auth DROP COLUMN IF EXISTS activated_counter;
-- ROLLBACK (end)
--
-- Idempotent: safe to run more than once.

DO $needs$
BEGIN
  IF to_regclass('public.tap_device_auth') IS NULL OR to_regprocedure('public.account_export_build(uuid)') IS NULL
     OR to_regclass('public.account_phone_verifications') IS NULL THEN
    RAISE EXCEPTION '041: needs migrations 037 and 039; nothing changed';
  END IF;
END
$needs$;

ALTER TABLE public.tap_device_auth ADD COLUMN IF NOT EXISTS activated_counter integer
  CHECK (activated_counter IS NULL OR (activated_counter >= 0 AND activated_counter <= 16777214));

CREATE TABLE IF NOT EXISTS public.card_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id     uuid NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  from_status text,
  to_status   text NOT NULL,
  actor       text NOT NULL CHECK (actor IN ('owner', 'support', 'system')),
  reason      text NOT NULL CHECK (length(reason) BETWEEN 1 AND 80),
  -- The transaction that wrote it: how the guard recognises card_transition's own
  -- change, with no session setting a caller could forge.
  txid        bigint NOT NULL DEFAULT txid_current(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_card_events_card ON public.card_events (card_id, created_at);
ALTER TABLE public.card_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.card_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.card_events TO service_role;
-- Append-only even for the server (the project's default privileges grant more).
REVOKE UPDATE, DELETE, TRUNCATE ON public.card_events FROM service_role;

-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.card_transition(p_card uuid, p_to text, p_actor text, p_reason text)
RETURNS public.cards
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_card public.cards;
  v_from text;
BEGIN
  SELECT * INTO v_card FROM public.cards WHERE id = p_card FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cards:card_not_found' USING ERRCODE = 'P0002'; END IF;
  v_from := v_card.status;
  IF NOT ((p_to = 'active' AND v_from IN ('pending', 'shipped'))
       OR (p_to = 'retired' AND v_from IN ('pending', 'shipped', 'active', 'suspended'))) THEN
    RAISE EXCEPTION 'cards:invalid_transition' USING ERRCODE = 'P0001', DETAIL = COALESCE(v_from, 'null') || ' -> ' || COALESCE(p_to, 'null');
  END IF;
  -- The event first: the guard (below) lets a status change through only when this
  -- transaction has already recorded it here, and no client role can write this table.
  INSERT INTO public.card_events (card_id, from_status, to_status, actor, reason)
  VALUES (p_card, v_from, p_to, p_actor, left(p_reason, 80));
  IF p_to = 'active' THEN
    -- AAROH cards do not expire (DEC-2026-047 Q6).
    UPDATE public.cards
       SET status = 'active', activated_at = COALESCE(activated_at, now()), last_activation_at = now(),
           activation_count = COALESCE(activation_count, 0) + 1, deactivated_at = NULL,
           activation_expires_at = NULL, updated_at = now()
     WHERE id = p_card RETURNING * INTO v_card;
  ELSE
    UPDATE public.cards SET status = 'retired', deactivated_at = now(), updated_at = now()
     WHERE id = p_card RETURNING * INTO v_card;
    UPDATE public.tap_device_auth SET retired_at = COALESCE(retired_at, now()) WHERE card_id = p_card;
  END IF;
  RETURN v_card;
END;
$$;

-- Any other writer: an AAROH card never becomes active, nor leaves 'retired',
-- except through card_transition. The row is left as it was (the writer's
-- statement still succeeds for its other rows) and the refusal is logged.
CREATE OR REPLACE FUNCTION public.cards_guard_transition()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  -- card_transition's own change: recorded first, in this transaction, by an owner or support.
  IF EXISTS (SELECT 1 FROM public.card_events e
             WHERE e.card_id = NEW.id AND e.to_status = NEW.status AND e.actor IN ('owner', 'support')
               AND e.txid = txid_current()) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tap_device_auth d WHERE d.card_id = NEW.id) THEN RETURN NEW; END IF;
  IF NEW.status = 'active' OR OLD.status = 'retired' THEN
    INSERT INTO public.card_events (card_id, from_status, to_status, actor, reason)
    VALUES (NEW.id, OLD.status, COALESCE(NEW.status, 'null'), 'system', 'refused: tap to activate only');
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_cards_guard_transition ON public.cards;
CREATE TRIGGER trg_cards_guard_transition BEFORE UPDATE OF status ON public.cards
  FOR EACH ROW EXECUTE FUNCTION public.cards_guard_transition();

-- One card as its owner sees it: never the activation code or the chip's UID.
CREATE OR REPLACE FUNCTION public.card_owner_card(p_card uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'cardId', c.card_id, 'nickname', c.nickname, 'status', c.status,
    'edition', CASE WHEN c.edition_design IS NOT NULL AND c.edition_serial IS NOT NULL
                    THEN jsonb_build_object('design', c.edition_design, 'number', c.edition_serial,
                                            'of', c.edition_count, 'chapterSize', c.edition_chapter_size) END,
    'activatedAt', c.activated_at, 'deactivatedAt', c.deactivated_at,
    'verifiedTap', jsonb_build_object(
      'registered', d.public_code IS NOT NULL,
      'retired', d.retired_at IS NOT NULL))
  FROM public.cards c LEFT JOIN public.tap_device_auth d ON d.card_id = c.id
  WHERE c.id = p_card;
$$;

CREATE OR REPLACE FUNCTION public.card_owner_list(p_user uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(jsonb_agg(public.card_owner_card(c.id) ORDER BY c.created_at), '[]'::jsonb)
  FROM public.cards c
  WHERE c.user_id = p_user OR c.customer_id IN (SELECT cu.id FROM public.customers cu WHERE cu.user_id = p_user);
$$;

-- Tap to activate (T-08). The possession proof's signature and expiry are
-- checked by /api/cards before this is called; here: the card is the caller's,
-- the proof names this card's chip, its counter was accepted as genuine, and it
-- has not activated anything before.
CREATE OR REPLACE FUNCTION public.card_owner_activate(p_user uuid, p_card uuid, p_code text, p_counter integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_card public.cards;
  v_d    public.tap_device_auth;
  v_tap  uuid;
BEGIN
  SELECT * INTO v_card FROM public.cards c
   WHERE c.id = p_card
     AND (c.user_id = p_user OR c.customer_id IN (SELECT cu.id FROM public.customers cu WHERE cu.user_id = p_user))
   FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'card_not_found'); END IF;
  SELECT * INTO v_d FROM public.tap_device_auth WHERE card_id = p_card FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'not_registered'); END IF;
  IF v_d.public_code IS DISTINCT FROM p_code THEN RETURN jsonb_build_object('ok', false, 'code', 'proof_mismatch'); END IF;
  IF v_card.status = 'active' THEN RETURN jsonb_build_object('ok', false, 'code', 'already_active'); END IF;
  IF v_card.status IN ('retired', 'replaced') OR v_d.retired_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'card_retired');
  END IF;
  IF v_card.status NOT IN ('pending', 'shipped') THEN RETURN jsonb_build_object('ok', false, 'code', 'not_pairable'); END IF;
  -- The proof's counter must be one this chip was accepted at (genuine), and newer
  -- than any proof used before.
  IF p_counter IS NULL OR v_d.last_counter IS NULL OR p_counter > v_d.last_counter THEN
    RETURN jsonb_build_object('ok', false, 'code', 'proof_mismatch');
  END IF;
  IF v_d.activated_counter IS NOT NULL AND p_counter <= v_d.activated_counter THEN
    RETURN jsonb_build_object('ok', false, 'code', 'proof_used');
  END IF;
  UPDATE public.tap_device_auth SET activated_counter = p_counter WHERE public_code = v_d.public_code;
  -- A card with no Tap yet opens the owner's first Tap.
  IF v_card.tap_profile_id IS NULL THEN
    SELECT t.id INTO v_tap FROM public.tap_profiles t WHERE t.user_id = p_user ORDER BY t.created_at LIMIT 1;
    IF v_tap IS NOT NULL THEN UPDATE public.cards SET tap_profile_id = v_tap WHERE id = p_card; END IF;
  END IF;
  PERFORM public.card_transition(p_card, 'active', 'owner', 'tap to activate');
  INSERT INTO public.account_events (user_id, event_type, subject_type, subject_id, detail)
  VALUES (p_user, 'card_activated', 'card', p_card::text, jsonb_build_object('method', 'tap'));
  RETURN jsonb_build_object('ok', true, 'card', public.card_owner_card(p_card));
END;
$$;

-- Report stolen (T-09): terminal for the owner; the card opens nothing.
CREATE OR REPLACE FUNCTION public.card_owner_retire(p_user uuid, p_card uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_card public.cards;
BEGIN
  SELECT * INTO v_card FROM public.cards c
   WHERE c.id = p_card
     AND (c.user_id = p_user OR c.customer_id IN (SELECT cu.id FROM public.customers cu WHERE cu.user_id = p_user))
   FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'card_not_found'); END IF;
  IF v_card.status IN ('retired', 'replaced') THEN RETURN jsonb_build_object('ok', false, 'code', 'card_retired'); END IF;
  PERFORM public.card_transition(p_card, 'retired', 'owner', 'reported stolen');
  INSERT INTO public.account_events (user_id, event_type, subject_type, subject_id, detail)
  VALUES (p_user, 'card_retired', 'card', p_card::text, jsonb_build_object('reason', 'reported stolen'));
  INSERT INTO public.notifications (user_id, category, title, body)
  VALUES (p_user, 'account', 'Card switched off',
          'You reported a card stolen, so it is switched off for good. Contact SHYGON support for a replacement.');
  RETURN jsonb_build_object('ok', true, 'card', public.card_owner_card(p_card));
END;
$$;

-- The Verified Tap lookup (037): a pending or shipped card can be paired.
CREATE OR REPLACE FUNCTION public.verify_device_lookup(p_code text, p_visitor text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_d public.tap_device_auth;
  v_card public.cards;
  v_tap public.tap_profiles;
  v_mode text;
BEGIN
  IF p_code IS NULL OR p_code !~ '^[a-z2-7]{16}$' THEN RETURN jsonb_build_object('state', 'unavailable'); END IF;
  -- One visitor: 30 checks an hour, whatever the code (no per-code signal).
  IF p_visitor IS NOT NULL AND (SELECT count(*) FROM public.tap_verify_events
        WHERE visitor_digest = p_visitor AND created_at > now() - interval '1 hour') >= 30 THEN
    RETURN jsonb_build_object('state', 'rate_limited', 'retryAfter', 3600);
  END IF;
  SELECT * INTO v_d FROM public.tap_device_auth WHERE public_code = p_code;
  IF NOT FOUND OR v_d.card_id IS NULL THEN RETURN jsonb_build_object('state', 'unavailable'); END IF;
  SELECT * INTO v_card FROM public.cards WHERE id = v_d.card_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'unavailable'); END IF;
  -- DEC-2026-047 (041): a card issued to an owner but not yet active can be
  -- tapped to activate it. The answer opens no Tap; it carries only what the
  -- check needs. A suspended or retired card is never pairable.
  IF v_card.status IN ('pending', 'shipped') AND v_card.user_id IS NOT NULL AND v_d.retired_at IS NULL THEN
    IF (SELECT count(*) FROM public.tap_verify_events
          WHERE public_code = p_code AND verdict = 'not_confirmed' AND created_at > now() - interval '1 hour') >= 20 THEN
      RETURN jsonb_build_object('state', 'rate_limited', 'retryAfter', 3600);
    END IF;
    RETURN jsonb_build_object('state', 'pairing', 'cardId', v_d.card_id, 'keyEpoch', v_d.key_epoch);
  END IF;
  IF v_card.status IS DISTINCT FROM 'active' OR v_card.tap_profile_id IS NULL THEN
    RETURN jsonb_build_object('state', 'unavailable');
  END IF;
  SELECT * INTO v_tap FROM public.tap_profiles t
   WHERE t.id = v_card.tap_profile_id AND t.status = 'active' AND t.suspended_at IS NULL AND t.published IS TRUE;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'unavailable'); END IF;
  -- One device: 20 refused checks an hour (an 8-byte MAC cannot be guessed at that rate).
  IF (SELECT count(*) FROM public.tap_verify_events
        WHERE public_code = p_code AND verdict = 'not_confirmed' AND created_at > now() - interval '1 hour') >= 20 THEN
    RETURN jsonb_build_object('state', 'rate_limited', 'retryAfter', 3600);
  END IF;
  SELECT active_mode INTO v_mode FROM public.tap_mode_state WHERE tap_profile_id = v_tap.id;
  -- A lost card (Lost mode, 036): the lifecycle answer replaces every verdict.
  IF COALESCE(v_mode, 'business') = 'lost' THEN RETURN jsonb_build_object('state', 'lost', 'slug', v_tap.slug); END IF;
  RETURN jsonb_build_object(
    'state', CASE WHEN v_d.retired_at IS NOT NULL THEN 'retired' ELSE 'ready' END,
    'slug', v_tap.slug, 'cardId', v_d.card_id, 'keyEpoch', v_d.key_epoch);
END;
$$;

-- The export (039): each card gains its history.
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
  v_phone jsonb;
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
        FROM public.tap_device_auth d WHERE d.card_id = c.id),
      -- The card's own history (041): every state change, by whom and why.
      'history', COALESCE((SELECT jsonb_agg(jsonb_build_object('from', e.from_status, 'to', e.to_status,
          'actor', e.actor, 'reason', e.reason, 'at', e.created_at) ORDER BY e.created_at, e.id)
        FROM public.card_events e WHERE e.card_id = c.id), '[]'::jsonb)) ORDER BY c.created_at)
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

  -- Account phone verification (039): the verified number shows only as its
  -- last 4 digits; the codes are security values and stay out.
  SELECT jsonb_build_object('last4', right(v.phone_e164, 4), 'verifiedAt', v.verified_at,
      'usableFrom', v.usable_from, 'replacedAt', v.replaced_at)
    INTO v_phone
    FROM public.account_phone_verifications v WHERE v.user_id = p_user;

  RETURN jsonb_build_object(
    'format', 'shygon-account-export/2',
    'exportedAt', now(),
    'accountId', p_user,
    'account', jsonb_build_object('profile', v_profile, 'customer', v_customer),
    'phoneVerification', v_phone,
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

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.card_owner_retire(uuid, uuid)',
    'public.card_owner_activate(uuid, uuid, text, integer)',
    'public.card_owner_list(uuid)',
    'public.card_owner_card(uuid)',
    'public.card_transition(uuid, text, text, text)',
    'public.cards_guard_transition()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;
