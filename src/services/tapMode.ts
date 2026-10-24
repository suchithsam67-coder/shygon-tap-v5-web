import { supabase } from '../lib/supabase';
import type { InfoCategory, PublicInfo } from '../lib/database.types';

/**
 * The Tap owner's mode control, `POST /api/modes` (AAROH-API v0.8 §6;
 * DEC-2026-041). One mode is active per Tap: `business` (the default) or
 * `info`. Info is a plain-text public page about a thing or a place.
 *
 * Every change carries the version the owner last saw (`expectedVersion`), so
 * an edit made elsewhere in the meantime is refused (`stale_version`) instead
 * of overwritten. A switch also carries one idempotency key per intent, reused
 * only when retrying after a network failure. Nothing is shown as switched or
 * saved until the server answers 200. The owner's role comes from the session
 * token alone.
 */

export type TapMode = 'business' | 'info';
export type ModeReason = 'active' | 'ready' | 'needs_setup' | 'not_available';
export type PublicationStatus = 'draft' | 'ready' | 'live' | 'unavailable';
export type InfoField = 'title' | 'shortDescription' | 'category' | 'detailedInformation';

export interface ModesState {
  activeMode: TapMode;
  version: number;
  changedAt: string | null;
  modes: { mode: TapMode; available: boolean; reason: ModeReason; missing?: InfoField[] }[];
}

export interface OwnerInfo extends Omit<PublicInfo, 'title' | 'shortDescription'> {
  title: string | null;
  shortDescription: string | null;
  version: number;
}

export interface InfoState {
  info: OwnerInfo | null;
  publicationStatus: PublicationStatus;
}

export interface ActivateResult {
  activeMode: TapMode;
  previousMode: TapMode;
  version: number;
  changedAt: string;
  replayed: boolean;
}

export type InfoFields = Partial<{ title: string | null; shortDescription: string | null; category: InfoCategory | null; detailedInformation: string | null }>;

/** The limits the server enforces (§6), shown to the owner before they send. */
export const INFO_LIMITS = { title: 120, shortDescription: 280, detailedInformation: 2000 } as const;

export class ModesError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly detail: { field?: string; reason?: string; missing?: string[]; current?: Record<string, unknown> } = {},
  ) {
    super(message);
  }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ModesError('Please sign in again.', 401, 'unauthenticated');
  let response: Response;
  try {
    response = await fetch('/api/modes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ModesError(navigator.onLine === false ? 'You are offline. Reconnect and try again.' : 'We could not reach SHYGON. Try again.', 0, 'network');
  }
  const result = (await response.json().catch(() => ({}))) as T & {
    error?: { code?: string; message?: string; field?: string; reason?: string; missing?: string[]; current?: Record<string, unknown> };
  };
  if (!response.ok) {
    const e = result.error ?? {};
    throw new ModesError(e.message ?? 'Something went wrong. Please try again.', response.status, e.code ?? 'unknown', {
      field: e.field,
      reason: e.reason,
      missing: e.missing,
      current: e.current,
    });
  }
  return result;
}

export const getModesState = () => call<ModesState>({ op: 'owner.state' });
export const activateMode = (mode: TapMode, expectedVersion: number, idempotencyKey: string) =>
  call<ActivateResult>({ op: 'owner.activate', mode, expectedVersion, idempotencyKey });
export const getInfo = () => call<InfoState>({ op: 'owner.info.get' });
export const saveInfo = (fields: InfoFields, expectedVersion: number) => call<InfoState>({ op: 'owner.info.save', fields, expectedVersion });
export const clearInfo = () => call<{ cleared: boolean }>({ op: 'owner.info.clear' });
/**
 * What a visitor would get in that mode (`owner.preview`): for Info, the
 * published fields, or null when the page is incomplete. It does not apply
 * SHYGON's catalogue switch, so the page says separately when Info is off.
 */
export const previewInfo = () => call<{ mode: 'info'; view: PublicInfo | null }>({ op: 'owner.preview', mode: 'info' });
