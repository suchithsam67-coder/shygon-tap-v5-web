/**
 * State for the first-visit privacy notice (components/PrivacyNotice.tsx).
 * Kept apart from the component so React Fast Refresh can hot-update it.
 */

export const PRIVACY_NOTICE_KEY = 'shygon_privacy_notice';
/** Bump to show a changed notice to everyone again. */
export const PRIVACY_NOTICE_VERSION = 1;
export const PRIVACY_NOTICE_REOPEN_EVENT = 'shygon-privacy-notice';

export function privacyNoticeAcknowledged(): boolean {
  try {
    const raw = localStorage.getItem(PRIVACY_NOTICE_KEY);
    return raw ? (JSON.parse(raw) as { v?: number }).v === PRIVACY_NOTICE_VERSION : false;
  } catch {
    return false;
  }
}

export function acknowledgePrivacyNotice(): void {
  try {
    localStorage.setItem(
      PRIVACY_NOTICE_KEY,
      JSON.stringify({ v: PRIVACY_NOTICE_VERSION, at: new Date().toISOString() }),
    );
  } catch {
    // Storage blocked: the notice simply shows again next visit.
  }
}

/** Shows the notice again (Cookie Policy page). */
export function reopenPrivacyNotice(): void {
  window.dispatchEvent(new Event(PRIVACY_NOTICE_REOPEN_EVENT));
}
