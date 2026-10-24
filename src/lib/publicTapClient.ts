import {
  DEFAULT_THEME,
  toExperience,
  type InfoCategory,
  type PublicInfo,
  type PublicProfile,
  type PublicTapState,
  type PublicTapView,
} from './database.types';

/**
 * The public Tap's data access, written against PostgREST directly with
 * `fetch` instead of the Supabase SDK.
 *
 * Why this exists rather than reusing `services/tap.ts`: this is the one page a
 * stranger opens on their own phone, on mobile data, in the second after
 * tapping a card — and the whole product promise is that it appears instantly.
 * Importing the SDK pulled ~57 kB gzipped of auth, realtime and storage code
 * into that path to make two anonymous reads that need none of it.
 *
 * There is no security difference. These are the same SECURITY DEFINER
 * functions, called with the same public anon key, and every clamp still runs
 * server-side. The anon key is designed to be shipped to browsers; it is
 * already in the bundle either way.
 *
 * The signed-in app keeps using the SDK — it needs the session handling.
 */

const URL_BASE = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** How long a visitor waits before we stop hoping and show a retry. */
const TIMEOUT_MS = 12_000;

/** A failed call, with its HTTP status, so a missing function can be told from a failure. */
class RpcError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function rpc<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  if (!URL_BASE || !ANON_KEY) {
    throw new Error('SHYGON Tap is not configured.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      // The message is never shown to a visitor; PublicTap maps the throw to
      // its own copy so a Postgres detail can never reach a stranger.
      throw new RpcError(`rpc ${fn} failed: ${response.status}`, response.status);
    }

    // A function returning void answers 204 with an empty body.
    if (response.status === 204) return null as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  } finally {
    clearTimeout(timer);
  }
}

function toProfile(row: PublicProfile): PublicProfile {
  return {
    ...row,
    experience: toExperience(row.experience),
    customLinks: Array.isArray(row.customLinks) ? row.customLinks : [],
    theme: { ...DEFAULT_THEME, ...(row.theme ?? {}) },
    activeEvent: row.activeEvent ?? null,
  };
}

/** The live Tap at this address, or null when there is not one. */
export async function fetchPublicProfile(slug: string): Promise<PublicProfile | null> {
  const row = await rpc<PublicProfile | null>('get_public_profile', { p_slug: slug });
  return row ? toProfile(row) : null;
}

const CATEGORIES: readonly InfoCategory[] = ['place', 'product', 'equipment', 'exhibit', 'service_point', 'instructions'];
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);

/** The five published Info fields, and only those; anything else in the payload is dropped. */
function toInfo(raw: unknown): PublicInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const title = text(row.title);
  const shortDescription = text(row.shortDescription);
  if (!title || !shortDescription) return null;
  return {
    title,
    shortDescription,
    category: CATEGORIES.includes(row.category as InfoCategory) ? (row.category as InfoCategory) : null,
    detailedInformation: text(row.detailedInformation),
    updatedAt: text(row.updatedAt),
  };
}

/**
 * What the live Tap at this address shows (AAROH-API v0.8 §6, P-6
 * `get_public_tap_mode`): its Business profile, its Info page, or null.
 *
 * Null means show nothing: the caller asks `get_public_tap_state` why, as
 * before. It never turns into the Business profile, including when an Info page
 * is switched off, missing, invalid or of an unknown shape. Only when P-6 does
 * not exist yet (a backend before v0.8, which has no Info) does this read the
 * Business profile through P-1 instead.
 */
export async function fetchPublicTap(slug: string): Promise<PublicTapView> {
  let view: unknown;
  try {
    view = await rpc<unknown>('get_public_tap_mode', { p_slug: slug });
  } catch (error) {
    if (!(error instanceof RpcError && error.status === 404)) throw error;
    const profile = await fetchPublicProfile(slug);
    return profile ? { mode: 'business', profile } : null;
  }
  if (!view || typeof view !== 'object') return null;
  const row = view as { mode?: unknown; profile?: unknown; info?: unknown };
  if (row.mode === 'business' && row.profile && typeof row.profile === 'object') {
    return { mode: 'business', profile: toProfile(row.profile as PublicProfile) };
  }
  if (row.mode === 'info') {
    const info = toInfo(row.info);
    return info ? { mode: 'info', info } : null;
  }
  return null;
}

/**
 * Why a Tap did not resolve. Deliberately says nothing about drafts, archived
 * Taps or moderation — all three come back as plain `unavailable`.
 */
export async function fetchPublicTapState(slug: string): Promise<PublicTapState> {
  const value = await rpc<string | null>('get_public_tap_state', { p_slug: slug });
  return value === 'active' || value === 'paused' ? value : 'unavailable';
}

/**
 * Fire-and-forget analytics. Never blocks rendering and never surfaces an error
 * to a visitor — a Tap that loads but fails to log is fine; the reverse is not.
 */
export async function recordTapEvent(
  slug: string,
  event: 'view' | 'nfc' | 'qr' | 'link_click',
  linkKey?: string,
): Promise<void> {
  try {
    await rpc('record_tap_event', {
      p_slug: slug,
      p_event: event,
      p_link_key: linkKey ?? null,
    });
  } catch {
    /* analytics must never break the page */
  }
}
