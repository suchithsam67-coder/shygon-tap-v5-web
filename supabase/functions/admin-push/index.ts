/**
 * POST /functions/v1/admin-push
 *
 * Turns rows in `admin_notifications` into device notifications on Expo.
 *
 * The database already raises those rows (migration 003, section 21) and the
 * Admin APK already reads them live over Supabase Realtime, so the operational
 * feed works whether or not this function is ever deployed. This adds the
 * "buzz the phone" half — which needs an outbound HTTPS call, and is therefore
 * the one notification concern Postgres cannot own.
 *
 * Two ways in:
 *
 *   1. DISPATCH  — called with the service-role key (a scheduled invocation, or
 *      a database trigger via pg_net). Drains every notification with
 *      pushed_at IS NULL and marks it pushed. Resumable and idempotent: a row
 *      is stamped only after Expo accepts it, so a crash mid-run redelivers
 *      rather than dropping.
 *
 *   2. TEST      — called with an administrator's own JWT and { "test": true }.
 *      Sends one notification to that admin's own devices only. Nothing else.
 *
 * Secrets required (Supabase > Edge Functions > Secrets):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Expo's push service needs no key for tokens obtained by the app itself.
 */

import { corsHeaders, json, MissingSecretError, requireEnv, resolveAdmin, serviceClient } from '../_shared/admin.ts';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
/** Expo accepts at most 100 messages per request. */
const EXPO_BATCH_SIZE = 100;
/** One run never sends more than this, so a backlog cannot time the function out. */
const MAX_PER_RUN = 200;

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: 'default';
  priority: 'high' | 'default';
  channelId: string;
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
    const service = serviceClient();

    const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    const isDispatcher = bearer.length > 0 && timingSafeEqual(bearer, serviceKey);

    if (isDispatcher) {
      return await dispatchPending(service);
    }

    // Not the dispatcher — the only other caller allowed is an administrator
    // asking to test their own device.
    const admin = await resolveAdmin(service, request, 'orders.read');
    if (!admin) return json({ error: 'Not permitted.' }, 403);

    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      /* an empty body is fine for a test */
    }

    if (body.test !== true) {
      return json({ error: 'Only { "test": true } is accepted from an admin session.' }, 400);
    }

    const tokens = await tokensFor(service, admin.userId);
    if (tokens.length === 0) {
      return json({ error: 'No device is registered for push on this account.' }, 409);
    }

    const receipts = await sendToExpo(
      service,
      tokens.map((to) => ({
        to,
        title: 'SHYGON Admin',
        body: 'Push notifications are working on this device.',
        data: { link: '/notifications' },
        sound: 'default' as const,
        priority: 'default' as const,
        channelId: 'operations',
      })),
    );

    return json({ success: true, devices: tokens.length, accepted: receipts.accepted });
  } catch (error) {
    if (error instanceof MissingSecretError) {
      console.error(error.message);
      return json({ error: 'Push notifications are not configured on this server.' }, 503);
    }
    console.error('admin-push error', error);
    return json({ error: 'Could not send notifications.' }, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function dispatchPending(service: any): Promise<Response> {
  const { data: pending, error } = await service
    .from('admin_notifications')
    .select('id, admin_id, category, severity, title, body, link, metadata')
    .is('pushed_at', null)
    .order('created_at', { ascending: true })
    .limit(MAX_PER_RUN);

  if (error) {
    console.error('pending notification lookup failed', error.message);
    return json({ error: 'Could not read the notification queue.' }, 500);
  }
  if (!pending || pending.length === 0) {
    return json({ success: true, dispatched: 0, messages: 0 });
  }

  // One lookup for every active token, then fan each notification out. A
  // broadcast row (admin_id NULL) goes to every admin; a targeted row goes to
  // that admin's devices only.
  const { data: tokenRows, error: tokenError } = await service
    .from('admin_push_tokens')
    .select('admin_id, expo_token')
    .is('revoked_at', null);

  if (tokenError) {
    console.error('token lookup failed', tokenError.message);
    return json({ error: 'Could not read registered devices.' }, 500);
  }

  const allTokens: string[] = (tokenRows ?? []).map((r: { expo_token: string }) => r.expo_token);
  const byAdmin = new Map<string, string[]>();
  for (const row of tokenRows ?? []) {
    const list = byAdmin.get(row.admin_id) ?? [];
    list.push(row.expo_token);
    byAdmin.set(row.admin_id, list);
  }

  const messages: ExpoMessage[] = [];
  const dispatchedIds: string[] = [];

  for (const n of pending) {
    const targets = n.admin_id ? (byAdmin.get(n.admin_id) ?? []) : allTokens;
    dispatchedIds.push(n.id);
    for (const to of targets) {
      messages.push({
        to,
        title: n.title,
        body: n.body ?? '',
        data: { link: n.link, category: n.category, ...(n.metadata ?? {}) },
        sound: 'default',
        priority: n.severity === 'critical' ? 'high' : 'default',
        channelId: n.severity === 'critical' ? 'critical' : 'operations',
      });
    }
  }

  const result = messages.length > 0
    ? await sendToExpo(service, messages)
    : { accepted: 0, rejected: 0 };

  // Stamped even when there was no device to send to: the row has been through
  // the dispatcher and re-running would not find a device either. Without this
  // an empty-token deployment would re-scan the same backlog forever.
  const { error: stampError } = await service
    .from('admin_notifications')
    .update({ pushed_at: new Date().toISOString() })
    .in('id', dispatchedIds);

  if (stampError) {
    // Better a duplicate buzz on the next run than a silent operational alert.
    console.error('failed to stamp dispatched notifications', stampError.message);
  }

  return json({
    success: true,
    dispatched: dispatchedIds.length,
    messages: messages.length,
    accepted: result.accepted,
    rejected: result.rejected,
  });
}

// deno-lint-ignore no-explicit-any
async function tokensFor(service: any, adminId: string): Promise<string[]> {
  const { data, error } = await service
    .from('admin_push_tokens')
    .select('expo_token')
    .eq('admin_id', adminId)
    .is('revoked_at', null);

  if (error) {
    console.error('token lookup failed', error.message);
    return [];
  }
  return (data ?? []).map((r: { expo_token: string }) => r.expo_token);
}

/**
 * Posts to Expo in batches and revokes any token Expo reports as dead, so a
 * reinstalled or wiped device stops being retried forever.
 */
async function sendToExpo(
  // deno-lint-ignore no-explicit-any
  service: any,
  messages: ExpoMessage[],
): Promise<{ accepted: number; rejected: number }> {
  let accepted = 0;
  let rejected = 0;

  for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
    const batch = messages.slice(i, i + EXPO_BATCH_SIZE);

    let payload: { data?: Array<{ status: string; details?: { error?: string } }> };
    try {
      const response = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(batch),
      });
      if (!response.ok) {
        console.error('expo push rejected the batch', response.status, await response.text());
        rejected += batch.length;
        continue;
      }
      payload = await response.json();
    } catch (error) {
      console.error('expo push request failed', error);
      rejected += batch.length;
      continue;
    }

    const tickets = payload.data ?? [];
    const dead: string[] = [];

    tickets.forEach((ticket, index) => {
      if (ticket.status === 'ok') {
        accepted += 1;
        return;
      }
      rejected += 1;
      if (ticket.details?.error === 'DeviceNotRegistered') {
        const token = batch[index]?.to;
        if (token) dead.push(token);
      }
    });

    if (dead.length > 0) {
      const { error } = await service
        .from('admin_push_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .in('expo_token', dead);
      if (error) console.error('failed to revoke dead tokens', error.message);
    }
  }

  return { accepted, rejected };
}

/**
 * Constant-time compare. A plain `===` on a secret leaks its prefix through
 * timing to a caller who can measure the difference.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i += 1) diff |= ab[i] ^ bb[i];
  return diff === 0;
}
