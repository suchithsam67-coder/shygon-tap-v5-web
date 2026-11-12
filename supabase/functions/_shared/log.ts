/** Structured, privacy-safe logs for the Supabase admin Edge Functions. */

const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

const ALLOWED_FIELDS = new Set([
  'reason', 'code', 'status', 'count', 'accepted', 'rejected', 'dispatched', 'messages',
  'orderId', 'userId', 'adminId', 'entityId',
]);
const FIXED_CODES = new Set([
  'no-session', 'not-admin', 'missing-permission', 'bad-method',
  'admin-lookup-failed', 'order-lookup-failed', 'refund-claim-failed',
  'razorpay-rejected', 'order-update-failed', 'refund-ledger-failed',
  'entitlement-revocation-failed', 'card-suspension-failed', 'claim-release-failed',
  'notification-lookup-failed', 'device-lookup-failed', 'notification-stamp-failed',
  'expo-rejected', 'expo-request-failed', 'dead-token-revoke-failed',
  'missing-configuration', 'unexpected-error',
]);

function requestIdOf(request: Request): string {
  const incoming = request.headers.get('x-request-id');
  return incoming && REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
}

function clean(fields: Record<string, unknown>): Record<string, string | number> {
  const safe: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED_FIELDS.has(key)) continue;
    if (key === 'reason' || key === 'code') {
      if (typeof value === 'string' && FIXED_CODES.has(value)) safe[key] = value;
    } else if (key === 'status') {
      if (typeof value === 'number' && Number.isInteger(value)) safe[key] = value;
    } else if (key.endsWith('Id')) {
      if (typeof value === 'string' && SAFE_ID.test(value)) safe[key] = value;
    } else if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
      safe[key] = value;
    }
  }
  return safe;
}

export function requestLog(fn: string, request: Request) {
  const requestId = requestIdOf(request);
  const write = (level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}) => {
    const line = JSON.stringify({
      ts: new Date().toISOString(), level, fn, requestId, event, ...clean(fields),
    });
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };
  return {
    requestId,
    info: (event: string, fields?: Record<string, unknown>) => write('info', event, fields),
    warn: (event: string, fields?: Record<string, unknown>) => write('warn', event, fields),
    error: (event: string, fields?: Record<string, unknown>) => write('error', event, fields),
    respond(response: Response): Response {
      response.headers.set('x-request-id', requestId);
      return response;
    },
  };
}
