#!/usr/bin/env node
// Supervised emergency smoke test (DEC-2026-038 Q2/Q3; provider-requirements.md §6).
//
// A human operator runs this ONCE against a deployed host, with their OWN
// account and their OWN second phone as the contact. It sends ONE real
// verification text and, after typing SEND, ONE real emergency alert text to
// that phone, then follows the alert's status until a delivery receipt arrives
// or 3 minutes pass. It prints evidence without any number, code or token.
//
//   SMOKE_BASE_URL=https://<host> \
//   SMOKE_ACCESS_TOKEN=<your own session access token> \
//   SMOKE_CONTACT_PHONE=<your own second phone, e.g. +9198xxxxxxxx> \
//   node scripts/release/emergency-smoke.mjs
//
// Nothing is stored. The contact it adds is removed at the end unless
// SMOKE_KEEP_CONTACT=true.
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { pathToFileURL } from 'node:url';

export async function runSmoke({ base, token, phone, ask, log = console.log, pollMs = 10_000, maxPolls = 18, keepContact = false }) {
  const url = new URL(base);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) throw new Error('Use an https:// host.');
  const call = async (body) => {
    const response = await fetch(new URL('/api/emergency', url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(new Error(`${body.op}: HTTP ${response.status} ${json?.error?.code ?? ''}`), { status: response.status, body: json });
    return json;
  };
  const evidence = { host: url.host, startedAt: new Date().toISOString() };

  const listed = await call({ op: 'contacts.list' });
  evidence.providerConfigured = listed.settings.providerConfigured;
  if (!listed.settings.providerConfigured) throw new Error('The host reports no SMS provider configured: stop here (BLOCKED).');

  const saved = await call({ op: 'contacts.save', name: 'Smoke test contact', relationship: 'Operator', phone });
  const contactId = saved.contact.id;
  log(`contact added: ${saved.contact.phone}`);
  try {
    const sent = await call({ op: 'contacts.verify.request', contactId });
    log(`verification text sent to ${sent.phone}; it expires at ${sent.expiresAt}`);
    const code = String(await ask('Type the 6-digit code the phone received: ')).trim();
    const confirmed = await call({ op: 'contacts.verify.confirm', contactId, code });
    if (!confirmed.contact.verified) throw new Error('verification did not complete');
    log('contact verified');

    const go = String(await ask('Type SEND to send ONE real emergency alert text to that phone: ')).trim();
    if (go !== 'SEND') {
      log('stopped by the operator before any alert was sent');
      evidence.result = 'stopped-before-alert';
      return evidence;
    }
    const idempotencyKey = crypto.randomUUID();
    const created = await call({ op: 'alerts.create', idempotencyKey });
    const event = created.event;
    evidence.eventId = event.id;
    evidence.deliveryReceipts = event.deliveryReceipts;
    log(`alert ${event.id}: ${event.status} (receipts ${event.deliveryReceipts})`);

    let latest = event;
    for (let i = 0; i < maxPolls && !['delivered', 'failed', 'not_sent', 'partial'].includes(latest.status); i++) {
      if (latest.status === 'sent' && latest.deliveryReceipts !== 'supported') break;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      latest = (await call({ op: 'alerts.get', eventId: event.id })).event;
      log(`  status ${latest.status}`);
    }
    evidence.finalStatus = latest.status;
    evidence.recipients = latest.recipients.map((r) => ({
      status: r.status, attempts: r.attempts, provider: r.provider, acceptedAt: r.acceptedAt, deliveredAt: r.deliveredAt, lastError: r.lastError,
    }));
    evidence.result = latest.status === 'delivered' ? 'delivered-confirmed' : latest.status === 'sent' ? 'accepted-unconfirmed' : latest.status;
    log('Now confirm on the phone that the text arrived and reads correctly; record that by eye in the release evidence.');
    return evidence;
  } finally {
    if (!keepContact) {
      await call({ op: 'contacts.remove', contactId }).catch(() => undefined);
      log('smoke contact removed');
    }
    evidence.finishedAt = new Date().toISOString();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const base = process.env.SMOKE_BASE_URL;
  const token = process.env.SMOKE_ACCESS_TOKEN;
  const phone = process.env.SMOKE_CONTACT_PHONE;
  if (!base || !token || !phone) {
    console.error('Set SMOKE_BASE_URL, SMOKE_ACCESS_TOKEN and SMOKE_CONTACT_PHONE (see the header).');
    process.exit(2);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const evidence = await runSmoke({ base, token, phone, ask: (q) => rl.question(q), keepContact: process.env.SMOKE_KEEP_CONTACT === 'true' });
    console.log('\nEVIDENCE (no numbers, codes or tokens):');
    console.log(JSON.stringify(evidence, null, 2));
  } catch (error) {
    console.error(`SMOKE FAILED: ${error.message}`);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}
