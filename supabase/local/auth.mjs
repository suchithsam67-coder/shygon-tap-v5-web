// The Supabase Auth (GoTrue) subset that SHYGON uses, for the local stack (V6, D-4).
//
// Users live in the local database's auth.users, so creating one fires the
// real sign-up trigger (public.handle_new_user → customers + profiles), and
// every access token is an HS256 JWT signed with the stack's secret, exactly
// what the REST layer and the server functions verify.
//
//   POST /auth/v1/signup                       email + password (+ data)
//   POST /auth/v1/token?grant_type=password    sign in
//   POST /auth/v1/token?grant_type=refresh_token
//   GET  /auth/v1/user  ·  PUT /auth/v1/user   read / change (password, data, email)
//   POST /auth/v1/logout?scope=local|global|others
//   POST /auth/v1/recover  ·  GET /auth/v1/verify   password-reset and confirm links
//   GET  /auth/v1/settings
//
// Mail is never sent. Links that would have been emailed are kept in an
// outbox that only the local stack exposes (GET /auth/v1/__local/outbox),
// so a test can follow them the way a person would follow the email.
import crypto from 'node:crypto';
import { signJwt, verifyJwt } from './jwt.mjs';

const ACCESS_TOKEN_SECONDS = 3600;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class AuthError extends Error {
  constructor(status, errorCode, message) {
    super(message);
    this.status = status;
    this.errorCode = errorCode;
  }
}

const iso = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

/** The stored form of a password (also used by tests that seed legacy accounts). */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

function passwordMatches(password, stored) {
  const [scheme, saltHex, keyHex] = String(stored ?? '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

/** Columns GoTrue keeps on auth.users that the test shim leaves out. */
export const AUTH_USERS_EXTENSION = `
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS encrypted_password TEXT;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at TIMESTAMPTZ;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_sign_in_at TIMESTAMPTZ;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_app_meta_data JSONB DEFAULT '{"provider":"email","providers":["email"]}'::jsonb;
`;

export function createAuth({ db, exclusive, secret, issuer, autoconfirm = true, minPasswordLength = 6 }) {
  const sessions = new Map(); // session id -> user id
  const refreshTokens = new Map(); // token -> { sessionId, userId, used }
  const links = new Map(); // one-time token -> { userId, type, expires }
  const outbox = [];

  const query = (sql, params) => exclusive(() => db.query(sql, params));

  function toUser(row) {
    const appMetadata = row.raw_app_meta_data ?? { provider: 'email', providers: ['email'] };
    return {
      id: row.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: row.email,
      email_confirmed_at: iso(row.email_confirmed_at),
      phone: row.phone ?? '',
      confirmed_at: iso(row.email_confirmed_at),
      last_sign_in_at: iso(row.last_sign_in_at),
      app_metadata: appMetadata,
      user_metadata: row.raw_user_meta_data ?? {},
      identities: [
        {
          identity_id: row.id,
          id: row.id,
          user_id: row.id,
          identity_data: { email: row.email, email_verified: Boolean(row.email_confirmed_at), sub: row.id },
          provider: 'email',
          created_at: iso(row.created_at),
          updated_at: iso(row.updated_at ?? row.created_at),
        },
      ],
      created_at: iso(row.created_at),
      updated_at: iso(row.updated_at ?? row.created_at),
      is_anonymous: false,
    };
  }

  async function userById(id) {
    const { rows } = await query('SELECT * FROM auth.users WHERE id = $1', [id]);
    return rows[0] ?? null;
  }

  async function userByEmail(email) {
    const { rows } = await query('SELECT * FROM auth.users WHERE lower(email) = lower($1)', [email]);
    return rows[0] ?? null;
  }

  function issueSession(row) {
    const user = toUser(row);
    const now = Math.floor(Date.now() / 1000);
    const sessionId = crypto.randomUUID();
    const accessToken = signJwt(
      {
        aud: 'authenticated',
        exp: now + ACCESS_TOKEN_SECONDS,
        iat: now,
        iss: issuer,
        sub: user.id,
        email: user.email,
        phone: user.phone,
        app_metadata: user.app_metadata,
        user_metadata: user.user_metadata,
        role: 'authenticated',
        aal: 'aal1',
        amr: [{ method: 'password', timestamp: now }],
        session_id: sessionId,
        is_anonymous: false,
      },
      secret,
    );
    const refreshToken = crypto.randomBytes(24).toString('base64url');
    sessions.set(sessionId, user.id);
    refreshTokens.set(refreshToken, { sessionId, userId: user.id, used: false });
    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: ACCESS_TOKEN_SECONDS,
      expires_at: now + ACCESS_TOKEN_SECONDS,
      refresh_token: refreshToken,
      user,
    };
  }

  function mailLink(row, type, redirectTo) {
    const token = crypto.randomBytes(20).toString('hex');
    links.set(token, { userId: row.id, type, expires: Date.now() + 3600_000 });
    const link =
      `${issuer}/verify?token=${token}&type=${type}` + (redirectTo ? `&redirect_to=${encodeURIComponent(redirectTo)}` : '');
    outbox.push({ to: row.email, type, link, at: new Date().toISOString() });
  }

  /** The signed-in user behind a bearer token, or an AuthError. */
  async function sessionUser(headers) {
    const header = headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const { payload, error } = verifyJwt(token, secret);
    if (error) throw new AuthError(403, 'bad_jwt', `invalid JWT: unable to parse or verify signature, ${error}`);
    if (!payload.sub) throw new AuthError(403, 'bad_jwt', 'invalid claim: missing sub claim');
    if (!sessions.has(payload.session_id)) {
      throw new AuthError(403, 'session_not_found', 'Session from session_id claim in JWT does not exist');
    }
    const row = await userById(payload.sub);
    if (!row) throw new AuthError(403, 'user_not_found', 'User from sub claim in JWT does not exist');
    return { row, payload };
  }

  function checkPassword(password) {
    if (typeof password !== 'string' || password.length < minPasswordLength) {
      const error = new AuthError(422, 'weak_password', `Password should be at least ${minPasswordLength} characters.`);
      error.weakPassword = { reasons: ['length'], message: error.message };
      throw error;
    }
  }

  async function signup(body, url) {
    const email = String(body?.email ?? '').trim();
    if (!EMAIL.test(email)) throw new AuthError(400, 'validation_failed', 'Unable to validate email address: invalid format');
    checkPassword(body?.password);
    if (await userByEmail(email)) throw new AuthError(422, 'user_already_exists', 'User already registered');
    const metadata = body?.data && typeof body.data === 'object' ? body.data : {};
    const { rows } = await query(
      `INSERT INTO auth.users (email, encrypted_password, raw_user_meta_data, email_confirmed_at, last_sign_in_at, updated_at)
       VALUES ($1, $2, $3::text::jsonb, CASE WHEN $4 THEN now() END, CASE WHEN $4 THEN now() END, now())
       RETURNING *`,
      [email, hashPassword(body.password), JSON.stringify(metadata), autoconfirm],
    );
    const row = rows[0];
    if (!autoconfirm) {
      mailLink(row, 'signup', url.searchParams.get('redirect_to'));
      return toUser(row);
    }
    return issueSession(row);
  }

  async function token(body, url) {
    const grant = url.searchParams.get('grant_type');
    if (grant === 'password') {
      const row = await userByEmail(String(body?.email ?? '').trim());
      if (!row || !passwordMatches(String(body?.password ?? ''), row.encrypted_password)) {
        throw new AuthError(400, 'invalid_credentials', 'Invalid login credentials');
      }
      if (!row.email_confirmed_at) throw new AuthError(400, 'email_not_confirmed', 'Email not confirmed');
      const { rows } = await query('UPDATE auth.users SET last_sign_in_at = now() WHERE id = $1 RETURNING *', [row.id]);
      return issueSession(rows[0]);
    }
    if (grant === 'refresh_token') {
      const entry = refreshTokens.get(String(body?.refresh_token ?? ''));
      if (!entry || entry.used || !sessions.has(entry.sessionId)) {
        throw new AuthError(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
      }
      entry.used = true;
      sessions.delete(entry.sessionId);
      const row = await userById(entry.userId);
      if (!row) throw new AuthError(400, 'user_not_found', 'User not found');
      return issueSession(row);
    }
    throw new AuthError(400, 'unsupported_grant_type', 'unsupported_grant_type');
  }

  async function updateUser(headers, body) {
    const { row } = await sessionUser(headers);
    let updated = row;
    if (body?.password !== undefined) {
      checkPassword(body.password);
      ({ rows: [updated] } = await query(
        'UPDATE auth.users SET encrypted_password = $2, updated_at = now() WHERE id = $1 RETURNING *',
        [row.id, hashPassword(body.password)],
      ));
    }
    if (body?.data && typeof body.data === 'object') {
      ({ rows: [updated] } = await query(
        `UPDATE auth.users SET raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || $2::text::jsonb,
         updated_at = now() WHERE id = $1 RETURNING *`,
        [row.id, JSON.stringify(body.data)],
      ));
    }
    if (typeof body?.email === 'string' && body.email.trim() && body.email.trim() !== row.email) {
      if (!EMAIL.test(body.email.trim())) throw new AuthError(400, 'validation_failed', 'Unable to validate email address: invalid format');
      if (await userByEmail(body.email.trim())) throw new AuthError(422, 'email_exists', 'A user with this email address has already been registered');
      ({ rows: [updated] } = await query('UPDATE auth.users SET email = $2, updated_at = now() WHERE id = $1 RETURNING *', [
        row.id,
        body.email.trim(),
      ]));
    }
    return toUser(updated);
  }

  async function logout(headers, url) {
    const { payload } = await sessionUser(headers);
    const scope = url.searchParams.get('scope') ?? 'global';
    for (const [sessionId, userId] of sessions) {
      if (userId !== payload.sub) continue;
      const current = sessionId === payload.session_id;
      if (scope === 'global' || (scope === 'local' && current) || (scope === 'others' && !current)) {
        sessions.delete(sessionId);
      }
    }
  }

  async function recover(body, url) {
    const row = await userByEmail(String(body?.email ?? '').trim());
    // Same answer whether or not the address has an account (no enumeration).
    if (row) mailLink(row, 'recovery', url.searchParams.get('redirect_to'));
    return {};
  }

  async function verify(url) {
    const redirectTo = url.searchParams.get('redirect_to') || 'http://127.0.0.1/';
    const entry = links.get(url.searchParams.get('token') ?? '');
    const type = url.searchParams.get('type');
    if (!entry || entry.type !== type || entry.expires < Date.now()) {
      return {
        redirect: `${redirectTo}#error=access_denied&error_code=otp_expired&error_description=${encodeURIComponent('Email link is invalid or has expired')}`,
      };
    }
    links.delete(url.searchParams.get('token'));
    let { rows } = await query('SELECT * FROM auth.users WHERE id = $1', [entry.userId]);
    if (type === 'signup') {
      ({ rows } = await query('UPDATE auth.users SET email_confirmed_at = now(), updated_at = now() WHERE id = $1 RETURNING *', [entry.userId]));
    }
    const session = issueSession(rows[0]);
    const fragment = new URLSearchParams({
      access_token: session.access_token,
      expires_at: String(session.expires_at),
      expires_in: String(session.expires_in),
      refresh_token: session.refresh_token,
      token_type: 'bearer',
      type,
    });
    return { redirect: `${redirectTo}#${fragment}` };
  }

  /** Handles one /auth/v1 request; `path` is what follows /auth/v1. */
  async function handle({ method, path, url, headers, body }) {
    const json = (status, value) => ({
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: value === undefined ? '' : JSON.stringify(value),
    });
    let parsed = null;
    if (body) {
      try {
        parsed = JSON.parse(body);
      } catch {
        return json(400, { code: 400, error_code: 'bad_json', msg: 'Could not parse request body as JSON' });
      }
    }
    try {
      if (method === 'POST' && path === '/signup') return json(200, await signup(parsed, url));
      if (method === 'POST' && path === '/token') return json(200, await token(parsed, url));
      if (method === 'GET' && path === '/user') return json(200, toUser((await sessionUser(headers)).row));
      if (method === 'PUT' && path === '/user') return json(200, await updateUser(headers, parsed));
      if (method === 'POST' && path === '/logout') {
        await logout(headers, url);
        return { status: 204, headers: {}, body: '' };
      }
      if (method === 'POST' && path === '/recover') return json(200, await recover(parsed, url));
      if (method === 'GET' && path === '/verify') {
        const { redirect } = await verify(url);
        return { status: 303, headers: { location: redirect }, body: '' };
      }
      if (method === 'GET' && path === '/settings') {
        return json(200, { external: { email: true, phone: false }, disable_signup: false, mailer_autoconfirm: autoconfirm, phone_autoconfirm: false });
      }
      if (method === 'GET' && path === '/health') return json(200, { name: 'GoTrue (SHYGON local stack)', version: 'local' });
      if (method === 'GET' && path === '/__local/outbox') {
        const to = url.searchParams.get('email');
        return json(200, outbox.filter((mail) => !to || mail.to?.toLowerCase() === to.toLowerCase()));
      }
      return json(404, { code: 404, error_code: 'not_found', msg: `${method} ${path} is not part of the local auth subset` });
    } catch (error) {
      if (error instanceof AuthError) {
        return json(error.status, {
          code: error.status,
          error_code: error.errorCode,
          msg: error.message,
          ...(error.weakPassword ? { weak_password: error.weakPassword } : {}),
        });
      }
      throw error;
    }
  }

  return { handle, outbox };
}
