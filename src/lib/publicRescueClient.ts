/**
 * The finder's side of the Return-to-Owner relay, `POST /api/rescue`
 * (AAROH-API v0.2 §10a). Plain fetch, no SDK and no session, like the other
 * public clients.
 *
 * The finder never receives an owner detail: only the thread (their messages,
 * the owner's replies, system notes) and whether they may write. The finder
 * token is the only key to the conversation. It is kept in sessionStorage for
 * this tab and, if the finder asks, in the address's fragment (#…), which
 * browsers never send to a server. It never goes in a path, a query string,
 * analytics or a log (contract §10a).
 */

export interface FinderMessage {
  from: 'finder' | 'owner' | 'system';
  body: string;
  at: string;
}

export interface FinderThread {
  status: 'open' | 'owner_replied' | 'closed';
  canWrite: boolean;
  expiresAt: string;
  messages: FinderMessage[];
}

export class RescueError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 12_000;

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch('/api/rescue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new RescueError('We could not reach SHYGON. Check your connection and try again.', 0, 'network');
  } finally {
    clearTimeout(timer);
  }
  const result = (await response.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string; retryAfter?: number } };
  if (!response.ok) {
    const retryHeader = Number(response.headers.get('Retry-After'));
    throw new RescueError(
      result.error?.message ?? 'Something went wrong. Please try again.',
      response.status,
      result.error?.code ?? 'unknown',
      result.error?.retryAfter ?? (Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : undefined),
    );
  }
  return result;
}

/** One call per page view, after the profile has rendered. Any failure reads as "not available". */
export async function fetchRescueStatus(slug: string): Promise<{ available: boolean; hint: string | null }> {
  try {
    const result = await post<{ available?: boolean; hint?: string | null }>({ op: 'public.status', slug });
    return { available: result.available === true, hint: result.available === true ? (result.hint ?? null) : null };
  } catch {
    return { available: false, hint: null };
  }
}

export const startThread = (slug: string, idempotencyKey: string, message: string) =>
  post<{ finderToken: string; replayed: boolean; thread: FinderThread }>({ op: 'public.start', slug, idempotencyKey, message });

export const viewThread = (finderToken: string) => post<{ thread: FinderThread }>({ op: 'finder.view', finderToken });

export const postToThread = (finderToken: string, clientKey: string, message: string) =>
  post<{ replayed: boolean; thread: FinderThread }>({ op: 'finder.post', finderToken, clientKey, message });

/* The token's two permitted homes. Both wrapped: storage can be unavailable. */

const storageKey = (slug: string) => `shygon.rescue.${slug}`;

export function rememberToken(slug: string, token: string) {
  try {
    window.sessionStorage.setItem(storageKey(slug), token);
  } catch {
    /* private mode: the finder can still save the link */
  }
}

export function recallToken(slug: string): string | null {
  const fromFragment = /(?:^#|&)rt=([A-Za-z0-9_-]{20,128})(?:&|$)/.exec(window.location.hash)?.[1] ?? null;
  if (fromFragment) return fromFragment;
  try {
    return window.sessionStorage.getItem(storageKey(slug));
  } catch {
    return null;
  }
}

export function forgetToken(slug: string) {
  try {
    window.sessionStorage.removeItem(storageKey(slug));
  } catch {
    /* nothing to forget */
  }
}

/** A link the finder can keep: the Tap's address with the token in the fragment only. */
export function savedLink(slug: string, token: string): string {
  return `${window.location.origin}/t/${slug}?mode=return#rt=${token}`;
}
