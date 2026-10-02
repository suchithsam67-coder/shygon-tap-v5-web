import { drainEmailOutbox } from '../lib/email.mjs';

/**
 * Netlify Scheduled Function: every five minutes, send whatever customer email
 * is due (order shipped / out for delivery / delivered from the Admin app, and
 * retries). Netlify runs it on its own; it has no public URL.
 *
 * Vercel does not read this file — it uses the cron in vercel.json, which calls
 * /api/send-emails.
 */
export default async () => {
  const summary = await drainEmailOutbox({ limit: 25, budgetMs: 20000 });
  if (summary.sent || summary.failed) console.log('[send-emails-scheduled]', JSON.stringify(summary));
  return new Response(JSON.stringify(summary), { headers: { 'content-type': 'application/json' } });
};

export const config = {
  schedule: '*/5 * * * *',
};
