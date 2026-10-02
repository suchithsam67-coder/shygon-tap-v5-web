import crypto from 'node:crypto';
import { drainEmailOutbox, emailProvider } from '../lib/email.mjs';

/**
 * GET|POST /api/send-emails — sends the customer emails that are due
 * (public.email_outbox, migration 024).
 *
 * Most emails go out the moment they are queued, from the function that made
 * the change (verify-payment, the Razorpay webhook, card-otp). This endpoint
 * is for everything else — an order the Admin app marks shipped or delivered —
 * and for retries. On Netlify, send-emails-scheduled runs the same drain every
 * five minutes with no setup. On Vercel, vercel.json's cron calls this; for
 * instant order-status emails, point a Supabase Database Webhook (INSERT on
 * public.email_outbox) at it as well.
 *
 * Requires `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron sends) so
 * it cannot be triggered by anyone else. Without CRON_SECRET it refuses to run.
 */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

function authorised(request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = request.headers.get('authorization') ?? '';
  const given = header.replace(/^Bearer\s+/i, '').trim() || request.headers.get('x-cron-secret')?.trim() || '';
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async (request) => {
  if (request.method !== 'GET' && request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!process.env.CRON_SECRET?.trim()) return json({ error: 'CRON_SECRET is not set.' }, 503);
  if (!authorised(request)) return json({ error: 'Unauthorised.' }, 401);
  if (!emailProvider()) return json({ configured: false, message: 'No email provider is configured; emails stay queued.' });

  const summary = await drainEmailOutbox({ limit: 25, budgetMs: 20000 });
  return json(summary);
};
