import { createContext, useContext } from 'react';
import type { ProfileRow, TapEditStateRow, TapProfileRow } from './database.types';
import type { Entitlements } from '../services/entitlements';

/**
 * The customer's authoritative state: profile, Tap, entitlements, edit rule.
 *
 * Split out of the provider file so that one exports only components — React
 * Fast Refresh refuses to hot-update a module that also exports a hook, which
 * made every edit to the provider reload the whole app.
 */

export interface AccountContextValue {
  profile: ProfileRow | null;
  /**
   * The page the account screens are working on: the one picked in the page
   * switcher, or the customer's first page. Every screen that edits "your Tap"
   * edits this one.
   */
  tap: TapProfileRow | null;
  /** Every page the customer owns (one per card since migration 022), oldest first. */
  taps: TapProfileRow[];
  /** Switches the page the account screens work on. Remembered on this device. */
  selectTap: (tapId: string) => void;
  entitlements: Entitlements;
  /**
   * The 14-day editing window of the selected page, as decided by the
   * database. Null until it has been read, or when the customer has no Tap yet. The UI uses it to explain
   * itself; the rule is enforced by a trigger regardless of what is here.
   */
  editState: TapEditStateRow | null;
  unreadCount: number;
  /**
   * Bumped whenever a notification arrives or is read elsewhere (see
   * LiveNotifications), so a page showing the feed knows to re-read it.
   */
  notificationsVersion: number;
  loading: boolean;
  error: string | null;
  /** True when the tables exist but the migration has not been applied. */
  setupRequired: boolean;
  refresh: () => Promise<void>;
  /** Re-counts unread notifications only, without the page-level loading state. */
  refreshUnread: () => Promise<void>;
  /** Optimistically replaces the cached Tap after a local save. */
  setTap: (tap: TapProfileRow) => void;
}

export const AccountContext = createContext<AccountContextValue | null>(null);

export function useAccount(): AccountContextValue {
  const context = useContext(AccountContext);
  if (!context) throw new Error('useAccount must be used inside <AccountProvider>');
  return context;
}
