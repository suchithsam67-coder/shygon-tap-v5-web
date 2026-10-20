/**
 * The visitor's side of `POST /api/emergency` (AAROH-API v0.1 §10.3): whether
 * a Tap accepts visitor alerts, and the relay-only alert itself.
 *
 * Plain fetch, no SDK and no session, like publicTapClient.ts: the public Tap
 * must stay light. A visitor never receives a contact detail, a name or a
 * count; the server returns only an outcome and its safety line. Visitor alerts
 * run only where the host switch is on and the owner opted in, so today
 * `available` is false everywhere (DEC-2026-038 Q2).
 */

export type PublicAlertOutcome = 'sent' | 'sending' | 'failed' | 'not_sent';

export class PublicAlertError extends Error {
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
    response = await fetch('/api/emergency', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new PublicAlertError('We could not reach SHYGON. Check your connection and try again.', 0, 'network');
  } finally {
    clearTimeout(timer);
  }
  const result = (await response.json().catch(() => ({}))) as T & {
    error?: { code?: string; message?: string; retryAfter?: number };
  };
  if (!response.ok) {
    const retryHeader = Number(response.headers.get('Retry-After'));
    throw new PublicAlertError(
      result.error?.message ?? 'Something went wrong. Please try again.',
      response.status,
      result.error?.code ?? 'unknown',
      result.error?.retryAfter ?? (Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : undefined),
    );
  }
  return result;
}

/** One call per page view, after the profile has rendered. Any failure reads as "not available". */
export async function fetchPublicAlertsAvailable(slug: string): Promise<boolean> {
  try {
    const { available } = await post<{ available?: boolean }>({ op: 'public.status', slug });
    return available === true;
  } catch {
    return false;
  }
}

/** Sends the alert for one confirmed intent. Reuse `idempotencyKey` only to retry that same intent. */
export function sendPublicAlert(slug: string, idempotencyKey: string) {
  return post<{ outcome: PublicAlertOutcome; safety: string }>({ op: 'public.alert', slug, idempotencyKey, confirm: true });
}
