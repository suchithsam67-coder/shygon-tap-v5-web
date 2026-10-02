import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase, isMissingSchema } from './supabase';
import { useAuth } from './auth-context';
import type { ProfileRow, TapEditStateRow, TapProfileRow } from './database.types';
import { EMPTY_ENTITLEMENTS, fetchEntitlements, type Entitlements } from '../services/entitlements';
import { fetchEditState, fetchMyTaps } from '../services/tap';
import { countUnread } from '../services/notifications';
import { AccountContext, type AccountContextValue } from './account-context';

/**
 * The customer's authoritative state, loaded once per session and refreshed
 * after any mutation that could change it.
 *
 * Entitlements in particular are read from here and never from local state:
 * after a purchase the app calls `refresh()` and re-renders from what the
 * database says the customer owns, rather than from what the checkout thought
 * it sold them.
 */



/** Which page the account screens are on, remembered per device. */
const SELECTED_TAP_KEY = 'shygon_selected_tap';

function readSelectedTap(): string | null {
  try {
    return localStorage.getItem(SELECTED_TAP_KEY);
  } catch {
    return null;
  }
}

function pickTap(taps: TapProfileRow[], preferred: string | null): TapProfileRow | null {
  return taps.find((t) => t.id === preferred) ?? taps[0] ?? null;
}

/** Everything the account area reads, applied as one update. */
interface AccountSnapshot {
  profile: ProfileRow | null;
  tap: TapProfileRow | null;
  taps: TapProfileRow[];
  entitlements: Entitlements;
  editState: TapEditStateRow | null;
  unreadCount: number;
  error: string | null;
  setupRequired: boolean;
}

const EMPTY_SNAPSHOT: AccountSnapshot = {
  profile: null,
  tap: null,
  taps: [],
  entitlements: EMPTY_ENTITLEMENTS,
  editState: null,
  unreadCount: 0,
  error: null,
  setupRequired: false,
};

export function AccountProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();

  const [snapshot, setSnapshot] = useState<AccountSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [notificationsVersion, setNotificationsVersion] = useState(0);
  const { profile, tap, taps, entitlements, editState, unreadCount, error, setupRequired } = snapshot;
  // Which page is selected. A ref, not state: what renders is snapshot.tap,
  // and the loader only needs to know the preference when it runs.
  const selectedRef = useRef<string | null>(null);
  if (selectedRef.current === null) selectedRef.current = readSelectedTap() ?? '';

  /** Optimistically replaces the cached Tap after a local save. */
  const setTapState = useCallback(
    (next: TapProfileRow) =>
      setSnapshot((current) => ({
        ...current,
        tap: current.tap?.id === next.id || !current.tap ? next : current.tap,
        taps: current.taps.some((t) => t.id === next.id)
          ? current.taps.map((t) => (t.id === next.id ? next : t))
          : [...current.taps, next],
      })),
    [],
  );

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * Reads everything the account area needs and RETURNS it, rather than
   * writing state as each source lands.
   *
   * Two reasons. It let the five results be applied in one update instead of
   * six, so the dashboard renders once rather than flickering through partial
   * states. And it keeps every setState inside the effect's promise callback,
   * which is where React expects data-loading writes to happen.
   */
  const read = useCallback(async (): Promise<AccountSnapshot> => {
    if (!user) return EMPTY_SNAPSHOT;

    // One failing table must not blank the whole account, so each source is
    // settled independently and the page decides what it can still render.
    const [profileResult, tapResult, entitlementResult, unreadResult] =
      await Promise.allSettled([
        supabase
          .from('profiles')
          .select(
            'id, customer_id, email, full_name, phone, bio, website, whatsapp, instagram, ' +
              'linkedin, profile_image_url, location, company, job_title, ' +
              'notify_order_updates, notify_tap_activity, created_at, updated_at',
          )
          .eq('id', user.id)
          .maybeSingle(),
        fetchMyTaps(user.id),
        fetchEntitlements(user.id),
        countUnread(user.id),
      ]);

    // The edit window is per page, so it is read for the page on screen.
    const loadedTaps = tapResult.status === 'fulfilled' ? tapResult.value : [];
    const current = pickTap(loadedTaps, selectedRef.current);
    const [editResult] = await Promise.allSettled([fetchEditState(current?.id)]);

    const next: AccountSnapshot = { ...EMPTY_SNAPSHOT };
    let firstError: string | null = null;

    if (profileResult.status === 'fulfilled') {
      if (profileResult.value.error) {
        if (isMissingSchema(profileResult.value.error)) next.setupRequired = true;
        else firstError ??= 'We could not load your profile.';
      } else {
        next.profile = (profileResult.value.data as ProfileRow | null) ?? null;
      }
    } else if (isMissingSchema(profileResult.reason)) {
      next.setupRequired = true;
    } else {
      firstError ??= 'We could not load your profile.';
    }

    if (tapResult.status === 'fulfilled') {
      next.taps = tapResult.value;
      next.tap = current;
    } else if (isMissingSchema(tapResult.reason)) next.setupRequired = true;

    if (entitlementResult.status === 'fulfilled') next.entitlements = entitlementResult.value;
    else if (isMissingSchema(entitlementResult.reason)) next.setupRequired = true;
    else firstError ??= 'We could not load what your account includes.';

    // Editing is security-sensitive: if the authoritative edit-state RPC cannot
    // be read, fail closed instead of silently enabling a write path. The database
    // trigger remains the final enforcement point.
    if (editResult.status === 'fulfilled') {
      next.editState = editResult.value;
    } else if (isMissingSchema(editResult.reason)) {
      next.setupRequired = true;
      firstError ??= 'The Tap editing rules are not installed yet.';
    } else {
      firstError ??= 'We could not verify whether your Tap can be edited right now.';
    }

    // A failing unread count is cosmetic; it never blocks the page.
    if (unreadResult.status === 'fulfilled') next.unreadCount = unreadResult.value;

    next.error = firstError;
    return next;
  }, [user]);

  useEffect(() => {
    if (authLoading) return;

    let cancelled = false;
    void read().then((next) => {
      if (cancelled || !mounted.current) return;
      setSnapshot(next);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [authLoading, read]);

  /**
   * Re-read everything. Always called from a handler (after a purchase, a save),
   * so setting the loading flag here is not a render-phase side effect the way
   * doing it inside `load` would have been.
   */
  const refresh = useCallback(async () => {
    setLoading(true);
    const next = await read();
    if (mounted.current) {
      setSnapshot(next);
      setLoading(false);
    }
  }, [read]);

  /**
   * Live notifications only change the badge, so they re-count unread rows
   * instead of re-reading the whole account (which would flash every page
   * back to its loading state on each event).
   */
  const refreshUnread = useCallback(async () => {
    if (!user) return;
    try {
      const count = await countUnread(user.id);
      if (mounted.current) setSnapshot((current) => ({ ...current, unreadCount: count }));
    } catch {
      // Cosmetic: the badge keeps its last value.
    }
    if (mounted.current) setNotificationsVersion((v) => v + 1);
  }, [user]);

  /**
   * Switches the page every account screen works on. The page itself is
   * already loaded; only its own edit window is read fresh.
   */
  const selectTap = useCallback(
    (tapId: string) => {
      selectedRef.current = tapId;
      try {
        localStorage.setItem(SELECTED_TAP_KEY, tapId);
      } catch {
        /* private mode: the choice lasts until the page reloads */
      }
      setSnapshot((currentSnapshot) => {
        const nextTap = currentSnapshot.taps.find((t) => t.id === tapId) ?? currentSnapshot.tap;
        return { ...currentSnapshot, tap: nextTap, editState: nextTap?.id === currentSnapshot.tap?.id ? currentSnapshot.editState : null };
      });
      void fetchEditState(tapId)
        .then((latest) => {
          if (!mounted.current || selectedRef.current !== tapId) return;
          setSnapshot((currentSnapshot) => ({ ...currentSnapshot, editState: latest }));
        })
        .catch(() => {
          // Fails closed: with no edit state the editor stays locked.
        });
    },
    [],
  );

  useEffect(() => {
    if (!user || !editState || editState.has_pass || editState.can_edit || !editState.next_edit_at) return;
    const timer = window.setInterval(() => {
      if (new Date(editState.next_edit_at!).getTime() <= Date.now()) {
        void fetchEditState(tap?.id).then((latest) => {
          if (!mounted.current || !latest) return;
          setSnapshot((current) => ({ ...current, editState: latest }));
        }).catch(() => {
          // Keep the server-enforced lock if a refresh fails.
        });
      }
    }, 30000);
    return () => window.clearInterval(timer);
  }, [user, editState, tap?.id]);

  const value = useMemo<AccountContextValue>(
    () => ({
      profile,
      tap,
      taps,
      selectTap,
      entitlements,
      editState,
      unreadCount,
      notificationsVersion,
      loading: authLoading || loading,
      error,
      setupRequired,
      refresh,
      refreshUnread,
      setTap: setTapState,
    }),
    [
      profile,
      tap,
      taps,
      selectTap,
      entitlements,
      editState,
      unreadCount,
      notificationsVersion,
      authLoading,
      loading,
      error,
      setupRequired,
      refresh,
      refreshUnread,
      setTapState,
    ],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
