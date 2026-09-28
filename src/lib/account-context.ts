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
  tap: TapProfileRow | null;
  entitlements: Entitlements;
  /**
   * The 14-day editing window, as decided by the database. Null until it has
   * been read, or when the customer has no Tap yet. The UI uses it to explain
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
