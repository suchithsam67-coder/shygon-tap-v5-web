import crypto from 'node:crypto';

/**
 * Structured logs for the server functions (V6-018, V6-075).
 *
 * One JSON line per event, so the host's log search can filter by function,
 * request and event:
 *
 *   {"ts":"…","level":"warn","fn":"razorpay-webhook","requestId":"…",
 *    "event":"webhook.rejected","reason":"bad-signature"}
 *
 * The request id comes from the caller when it sends one (x-request-id, or the
 * id Netlify / Vercel stamp on every request) and is returned on the response,
 * so a customer's "it failed" can be matched to the exact log lines.
 *
 * Nothing secret or personal is ever written: values under keys that look like
 * a credential, a signature, a token or contact details are replaced before the
 * line is built, and long strings are cut. Log the ids you need to find a
 * record (order id, Razorpay ids, user id), never its contents.
 */

const REDACT = /secret|password|passwd|token|authorization|signature|api[-_]?key|service[-_]?role|cookie|email|phone|contact|address|pincode/i;
const MAX_STRING = 300;
const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

function clean(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value !== 'object') return value;
  if (value instanceof Error) return { name: value.name, message: clean(value.message, depth + 1) };
  if (depth > 3) return '[nested]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => clean(v, depth + 1));
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = REDACT.test(key) ? '[redacted]' : clean(v, depth + 1);
  }
  return out;
}

/** The caller's request id when it is well-formed, else a new one. */
export function requestIdOf(request) {
  const headers = request?.headers;
  for (const name of ['x-request-id', 'x-nf-request-id', 'x-vercel-id']) {
    const value = headers?.get?.(name);
    if (value && REQUEST_ID.test(value)) return value;
  }
  return crypto.randomUUID();
}

/**
 * A logger bound to one function invocation.
 * @returns {{ requestId: string, info: Function, warn: Function, error: Function, respond: (response: Response) => Response }}
 */
export function requestLog(fn, request) {
  const requestId = requestIdOf(request);
  const write = (level, event, fields = {}) => {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, fn, requestId, event, ...clean(fields) });
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };
  return {
    requestId,
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
    /** Stamps the request id on the response, so support can quote it. */
    respond(response) {
      response.headers.set('x-request-id', requestId);
      return response;
    },
  };
}

export const __testing = { clean };
