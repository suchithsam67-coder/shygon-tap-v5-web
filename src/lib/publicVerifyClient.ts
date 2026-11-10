/**
 * Verified Tap, `POST /api/verify` (AAROH-API v0.11 §10d). Plain fetch, no SDK
 * and no session, like the other public clients.
 *
 * A card's chip writes its address as `/d/<code>?e=<32 hex>&c=<16 hex>`: `e`
 * is its encrypted data and `c` its MAC. The page sends them once, in the body,
 * with no referrer and no caching, and keeps them nowhere else: not in storage,
 * the address bar, a log or analytics. The answer proves only that SHYGON
 * issued the chip's keys and that this read is new. It never says who holds the
 * card and never grants anything.
 */

export type Verdict = 'genuine' | 'already_checked' | 'not_confirmed' | 'needs_service' | 'unavailable' | 'not_verified';
const VERDICTS: readonly Verdict[] = ['genuine', 'already_checked', 'not_confirmed', 'needs_service', 'unavailable', 'not_verified'];

/** The card's place in its edition, sent only with `genuine`: "No. 037 of 100". */
export interface Edition {
  design: string;
  number: number;
  of: number;
  chapterSize: number | null;
}

export interface VerifyAnswer {
  slug: string;
  /** null: the Tap is in Lost mode, which shows its own page and no verdict. */
  verdict: Verdict | null;
  edition: Edition | null;
}

export class VerifyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

/** The card code: 16 characters of a–z and 2–7. Anything else is never sent. */
export const VERIFY_CODE = /^[a-z2-7]{16}$/;
const E = /^[0-9a-fA-F]{32}$/;
const C = /^[0-9a-fA-F]{16}$/;

/** The chip's values from an address's query, or null unless both are well formed. */
export function sunFrom(search: string): { e: string; c: string } | null {
  const params = new URLSearchParams(search);
  const e = params.get('e');
  const c = params.get('c');
  return e && c && E.test(e) && C.test(c) ? { e, c } : null;
}

const TIMEOUT_MS = 12_000;
const isInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;

function toEdition(raw: unknown): Edition | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.design !== 'string' || !row.design.trim() || !isInt(row.number) || !isInt(row.of) || row.number > row.of) return null;
  return { design: row.design, number: row.number, of: row.of, chapterSize: isInt(row.chapterSize) ? row.chapterSize : null };
}

/**
 * Asks SHYGON about this read. A verdict this client does not know reads as
 * `unavailable`, never as `genuine`; the edition is kept only with `genuine`.
 */
export async function verifyTap(code: string, sun: { e: string; c: string } | null): Promise<VerifyAnswer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'tap.verify', code, ...(sun ?? {}) }),
      // The page's address has carried e and c; nothing may repeat it.
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch {
    throw new VerifyError('We could not reach SHYGON. Check your connection and try again.', 0, 'network');
  } finally {
    clearTimeout(timer);
  }
  const result = (await response.json().catch(() => ({}))) as {
    slug?: unknown;
    verdict?: unknown;
    edition?: unknown;
    error?: { code?: string; message?: string; retryAfter?: number };
  };
  if (!response.ok) {
    const retryHeader = Number(response.headers.get('Retry-After'));
    throw new VerifyError(
      result.error?.message ?? 'Something went wrong. Please try again.',
      response.status,
      result.error?.code ?? 'unknown',
      result.error?.retryAfter ?? (Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : undefined),
    );
  }
  if (typeof result.slug !== 'string' || !result.slug) throw new VerifyError('Something went wrong. Please try again.', 502, 'invalid_answer');
  const verdict: Verdict | null =
    result.verdict === null ? null : VERDICTS.includes(result.verdict as Verdict) ? (result.verdict as Verdict) : 'unavailable';
  return { slug: result.slug, verdict, edition: verdict === 'genuine' ? toEdition(result.edition) : null };
}
