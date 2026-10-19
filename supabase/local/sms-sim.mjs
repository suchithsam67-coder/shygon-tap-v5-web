// An SMS provider stand-in for the local stack (the emergency module, 029).
//
// Nothing here talks to Twilio or MSG91. The stack routes https://api.twilio.com
// and https://control.msg91.com here, so the real server code (netlify/lib/sms.mjs)
// runs unchanged against it:
//   - Twilio's Messages API: Basic auth with the account SID and auth token,
//     201 { sid, status: 'queued' } on acceptance;
//   - MSG91's Flow API: { type: 'success', message: <request id> };
//   - Twilio delivery receipts: deliver(sid, status) POSTs a form to the
//     StatusCallback URL the message carried, signed the way Twilio signs
//     (X-Twilio-Signature, HMAC-SHA1 with the auth token).
// Each provider call takes the next queued scenario (default 'accept'):
//   accept · reject (400, code 21211) · error (500) · busy (429) ·
//   timeout (never answers until the caller gives up) · network (connection fails)
import crypto from 'node:crypto';
import { twilioSignature } from '../../netlify/lib/sms.mjs';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function createSmsSim({ accountSid, authToken, msg91Key, log = () => {} }) {
  const messages = [];
  const scenarios = [];
  let fallback = 'accept';

  /** Queue scenarios for the next provider calls, in order. */
  const queue = (...names) => scenarios.push(...names);
  const setDefault = (name) => {
    fallback = name;
  };
  const next = () => scenarios.shift() ?? fallback;

  async function outcome(request, record) {
    const scenario = next();
    record.scenario = scenario;
    if (scenario === 'network') throw new TypeError('fetch failed: connection refused (sms-sim)');
    if (scenario === 'timeout') {
      await new Promise((resolve, reject) => {
        if (request.signal?.aborted) return reject(request.signal.reason);
        request.signal?.addEventListener('abort', () => reject(request.signal.reason), { once: true });
      });
    }
    return scenario;
  }

  async function twilio(request) {
    const { pathname } = new URL(request.url);
    const match = pathname.match(/^\/2010-04-01\/Accounts\/([^/]+)\/Messages\.json$/);
    if (request.method !== 'POST' || !match) return json(404, { code: 20404, message: 'Not found' });
    const expected = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;
    if (match[1] !== accountSid || request.headers.get('authorization') !== expected) {
      return json(401, { code: 20003, message: 'Authenticate' });
    }
    const form = new URLSearchParams(await request.text());
    const record = {
      provider: 'twilio', to: form.get('To'), body: form.get('Body'),
      from: form.get('From') ?? form.get('MessagingServiceSid'), statusCallback: form.get('StatusCallback'),
      sid: null, at: new Date().toISOString(),
    };
    messages.push(record);
    const scenario = await outcome(request, record);
    if (scenario === 'reject') return json(400, { code: 21211, message: "The 'To' number is not a valid phone number.", status: 400 });
    if (scenario === 'error') return json(500, { code: 20500, message: 'Internal Server Error', status: 500 });
    if (scenario === 'busy') return json(429, { code: 20429, message: 'Too Many Requests', status: 429 });
    record.sid = `SM${crypto.randomBytes(16).toString('hex')}`;
    log(`sms-sim: twilio accepted ${record.sid}`);
    return json(201, { sid: record.sid, status: 'queued', to: record.to });
  }

  async function msg91(request) {
    if (request.headers.get('authkey') !== msg91Key) return json(401, { type: 'error', message: 'Invalid authkey' });
    const body = await request.json().catch(() => ({}));
    const record = { provider: 'msg91', to: body?.recipients?.[0]?.mobiles, templateId: body?.template_id, vars: body?.recipients?.[0], sid: null };
    messages.push(record);
    const scenario = await outcome(request, record);
    if (scenario === 'reject') return json(200, { type: 'error', message: 'Template not approved', code: '418' });
    if (scenario === 'error') return json(500, { type: 'error', message: 'Server error' });
    if (scenario === 'busy') return json(429, { type: 'error', message: 'Too many requests' });
    record.sid = crypto.randomBytes(12).toString('hex');
    return json(200, { type: 'success', message: record.sid });
  }

  /** Sends a signed Twilio status callback for one accepted message. */
  async function deliver(sid, status, { errorCode, signature } = {}) {
    const record = messages.find((m) => m.sid === sid);
    if (!record?.statusCallback) throw new Error(`sms-sim: no callback URL for ${sid}`);
    const params = { MessageSid: sid, MessageStatus: status, AccountSid: accountSid, To: record.to };
    if (errorCode) params.ErrorCode = String(errorCode);
    const sig = signature ?? twilioSignature(authToken, record.statusCallback, params);
    const response = await fetch(record.statusCallback, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': sig },
      body: new URLSearchParams(params),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }

  return {
    messages, queue, setDefault, deliver,
    reset() {
      messages.length = 0;
      scenarios.length = 0;
      fallback = 'accept';
    },
    async api(request) {
      const { hostname } = new URL(request.url);
      if (hostname === 'api.twilio.com') return twilio(request);
      if (hostname === 'control.msg91.com') return msg91(request);
      return json(404, {});
    },
  };
}
