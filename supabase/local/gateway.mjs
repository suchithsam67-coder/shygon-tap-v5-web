// The local stack's Supabase-compatible HTTP gateway (V6, D-4).
//
// One port, the same paths as a hosted project:
//   /rest/v1/*      rest.mjs     (PostgREST subset, real SQL under the caller's role)
//   /auth/v1/*      auth.mjs     (Auth subset, users in auth.users)
//   /realtime/v1/websocket       (accepts subscriptions, delivers nothing)
//   /storage/v1/*, /functions/v1/*   501: not part of the local stack
//
// Requests need an `apikey` (the stack's anon or service-role key), as the
// hosted API gateway requires. The bearer token decides the database role,
// exactly as PostgREST does: anon key → anon, a user's access token →
// authenticated with that user's claims, the service-role key → service_role.
import http from 'node:http';
import { verifyJwt } from './jwt.mjs';
import { handleRest, httpStatusFor, loadSchema, RestError } from './rest.mjs';
import { createAuth } from './auth.mjs';
import { acceptRealtime } from './realtime.mjs';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
  'access-control-allow-headers':
    'authorization, apikey, content-type, prefer, range, accept, accept-profile, content-profile, x-client-info, x-supabase-api-version, x-region',
  'access-control-expose-headers': 'content-range, content-location, x-supabase-api-version',
  'access-control-max-age': '600',
};

/** Serialises database work: PGlite has one connection. */
export function createMutex() {
  let tail = Promise.resolve();
  return (fn) => {
    const result = tail.then(() => fn());
    tail = result.catch(() => {});
    return result;
  };
}

class CallerError extends Error {
  constructor(status, body) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

function resolveCaller(headers, secret) {
  const apikey = headers.apikey;
  if (!apikey) {
    throw new CallerError(401, { message: 'No API key found in request', hint: 'No `apikey` request header or url param was found.' });
  }
  const key = verifyJwt(apikey, secret);
  if (key.error || !['anon', 'service_role'].includes(key.payload.role)) {
    throw new CallerError(401, { message: 'Invalid API key', hint: 'Double check your Supabase `anon` or `service_role` API key.' });
  }
  const authorization = headers.authorization ?? '';
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : apikey;
  const token = verifyJwt(bearer, secret);
  if (token.error) {
    throw new CallerError(401, token.error === 'expired'
      ? { code: 'PGRST303', message: 'JWT expired', details: null, hint: null }
      : { code: 'PGRST301', message: 'JWSError (CompactDecodeError Invalid number of parts: Expected 3 parts; got 1)', details: null, hint: null });
  }
  const role = token.payload.role;
  if (!['anon', 'authenticated', 'service_role'].includes(role)) {
    throw new CallerError(401, { code: 'PGRST301', message: `role "${role}" does not exist`, details: null, hint: null });
  }
  return { role, claims: token.payload, authenticated: role !== 'anon' };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

/**
 * @param {object} options
 * @param {import('@electric-sql/pglite').PGlite} options.db
 * @param {string} options.secret   the stack's JWT secret
 * @param {string} options.publicUrl  e.g. http://127.0.0.1:54321
 */
export async function createGateway({ db, secret, publicUrl, autoconfirm = true, log = () => {} }) {
  const exclusive = createMutex();
  let schema = await exclusive(() => loadSchema(db));
  const auth = createAuth({ db, exclusive, secret, issuer: `${publicUrl}/auth/v1`, autoconfirm });

  async function rest(request, url, path, body) {
    const headers = request.headers;
    let caller;
    try {
      caller = resolveCaller(headers, secret);
    } catch (error) {
      return { status: error.status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(error.body) };
    }
    // PostgREST hands the request headers to SQL; Supabase's edge adds the
    // client address, which record_tap_event reads.
    const requestHeaders = { ...headers, 'x-forwarded-for': headers['x-forwarded-for'] ?? request.socket.remoteAddress ?? '' };
    try {
      return await exclusive(() =>
        db.transaction(async (tx) => {
          await tx.query(
            `SELECT set_config('role', $1, true), set_config('request.jwt.claims', $2, true),
                    set_config('request.jwt.claim.sub', $3, true), set_config('request.jwt.claim.role', $1, true),
                    set_config('request.headers', $4, true), set_config('request.method', $5, true),
                    set_config('request.path', $6, true)`,
            [caller.role, JSON.stringify(caller.claims), caller.claims.sub ?? '', JSON.stringify(requestHeaders), request.method, url.pathname],
          );
          return handleRest(tx, schema, { method: request.method, path, url, headers, body });
        }),
      );
    } catch (error) {
      if (error instanceof RestError) {
        return { status: error.status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(error.body) };
      }
      if (typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)) {
        return {
          status: httpStatusFor(error.code, caller.authenticated),
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code: error.code, details: error.detail ?? null, hint: error.hint ?? null, message: error.message }),
        };
      }
      log(`gateway: unexpected error on ${request.method} ${url.pathname}: ${error?.stack ?? error}`);
      return { status: 500, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'local gateway error' }) };
    }
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, publicUrl);
    const send = ({ status, headers = {}, body = '' }) => {
      response.writeHead(status, { ...CORS, ...headers });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    try {
      if (request.method === 'OPTIONS') return send({ status: 204 });
      const body = await readBody(request);
      if (url.pathname.startsWith('/rest/v1/')) {
        const result = await rest(request, url, url.pathname.slice('/rest/v1/'.length), body);
        log(`${request.method} ${url.pathname} ${result.status}`);
        return send(result);
      }
      if (url.pathname.startsWith('/auth/v1/')) {
        const path = url.pathname.slice('/auth/v1'.length);
        // Links followed from an email carry no API key; everything else does.
        if (path !== '/verify' && path !== '/__local/outbox') {
          try {
            resolveCaller({ apikey: request.headers.apikey, authorization: `Bearer ${request.headers.apikey ?? ''}` }, secret);
          } catch (error) {
            return send({ status: error.status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(error.body) });
          }
        }
        const result = await auth.handle({ method: request.method, path, url, headers: request.headers, body });
        log(`${request.method} /auth/v1${path} ${result.status}`);
        return send(result);
      }
      if (url.pathname.startsWith('/storage/v1/') || url.pathname.startsWith('/functions/v1/')) {
        return send({
          status: 501,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ statusCode: '501', error: 'Not Implemented', message: `${url.pathname.split('/')[1]} is not part of the local stack` }),
        });
      }
      return send({ status: 404, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'no Route matched with those values' }) });
    } catch (error) {
      log(`gateway: ${error?.stack ?? error}`);
      return send({ status: 500, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'local gateway error' }) });
    }
  });

  server.on('upgrade', (request, socket) => {
    const url = new URL(request.url, publicUrl);
    const key = verifyJwt(url.searchParams.get('apikey') ?? '', secret);
    if (url.pathname !== '/realtime/v1/websocket' || key.error) {
      socket.destroy();
      return;
    }
    acceptRealtime(request, socket);
  });

  return {
    server,
    auth,
    exclusive,
    async reloadSchema() {
      schema = await exclusive(() => loadSchema(db));
    },
  };
}
