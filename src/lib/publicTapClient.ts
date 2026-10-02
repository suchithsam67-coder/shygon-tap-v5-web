import {
  DEFAULT_THEME,
  toExperience,
  type CardLook,
  type PublicCard,
  type PublicProfile,
  type PublicTapState,
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
 * There is no security difference. These are the same two SECURITY DEFINER
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
      throw new Error(`rpc ${fn} failed: ${response.status}`);
    }

    // A function returning void answers 204 with an empty body.
    if (response.status === 204) return null as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** The live Tap at this address, or null when there is not one. */
export async function fetchPublicProfile(slug: string): Promise<PublicProfile | null> {
  const row = await rpc<PublicProfile | null>('get_public_profile', { p_slug: slug });
  if (!row) return null;

  return {
    ...row,
    experience: toExperience(row.experience),
    customLinks: Array.isArray(row.customLinks) ? row.customLinks : [],
    theme: { ...DEFAULT_THEME, ...(row.theme ?? {}) },
    activeEvent: row.activeEvent ?? null,
  };
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

/**
 * What a tapped card opens (migration 022): its page's address and the card's
 * design, or why it opens nothing. Never names the owner or the card's history.
 */
export async function fetchPublicCard(code: string): Promise<PublicCard> {
  let value: PublicCard | null;
  try {
    value = await rpc<PublicCard | null>('get_public_card', { p_code: code });
  } catch (error) {
    // A database without migration 022 has no card lookup (404): no card can
    // exist there, so it is "not found", not a connection failure.
    if (error instanceof Error && / failed: 404$/.test(error.message)) return { state: 'unavailable' };
    throw error;
  }
  return value && typeof value === 'object' && 'state' in value ? value : { state: 'unavailable' };
}

/** The design of the card on a page, for a legacy chip that opens /t/<slug>?src=nfc. */
export async function fetchPublicPageCard(slug: string): Promise<CardLook | null> {
  const value = await rpc<CardLook | null>('get_public_page_card', { p_slug: slug });
  return value && typeof value === 'object' && value.design ? value : null;
}

/** A page's current address when `slug` is one it used to have. */
export async function resolveTapAlias(slug: string): Promise<string | null> {
  const value = await rpc<string | null>('resolve_tap_alias', { p_slug: slug });
  return typeof value === 'string' && value ? value : null;
}

/** Fire-and-forget analytics for a card-opened page, counted against the card. */
export async function recordCardTap(
  code: string,
  event: 'view' | 'nfc' | 'link_click',
  linkKey?: string,
): Promise<void> {
  try {
    await rpc('record_card_tap', { p_code: code, p_event: event, p_link_key: linkKey ?? null });
  } catch {
    /* analytics must never break the page */
  }
}
