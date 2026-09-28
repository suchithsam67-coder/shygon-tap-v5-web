import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

/**
 * Load something once on mount, with retry.
 *
 * Every page in the account area had its own copy of this: a `loading` flag, an
 * `error` string, a `load()` that set all three, and an effect that called it.
 * Besides the duplication, that shape sets state synchronously inside the
 * effect body — which React flags (`react-hooks/set-state-in-effect`) because it
 * causes a second render pass before the browser has painted the first.
 *
 * The fix is in the shape, not a suppression: the initial state is already
 * `loading`, so nothing needs setting on the way in. State is only ever written
 * from inside the promise callback — after an await, which is exactly where
 * React expects it — or from `reload()`, which is an event handler.
 *
 * A `reload()` triggered by the customer DOES set `loading` synchronously, and
 * that is correct: it happens in a click handler, not during render.
 */

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  /** Null until something fails. Carries whatever the caller's mapper produced. */
  error: string | null;
  /** Re-runs the loader. Safe to pass straight to an onClick. */
  reload: () => void;
  /**
   * Re-runs the loader in the background: what is on screen stays on screen,
   * with no skeleton, and a failed background refresh keeps the current data
   * rather than replacing it with an error. For updates nobody clicked for — a
   * status change pushed from elsewhere. Skipped while a load is already
   * running, since that load will return fresh data anyway.
   */
  refresh: () => void;
  /**
   * Updates the loaded value in place, for optimistic changes. Marking a
   * notification read should show instantly, not wait for a refetch.
   */
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

export function useAsync<T>(
  load: () => Promise<T>,
  {
    /** Turns a thrown value into the message the customer sees. */
    onError,
    /** Skip loading entirely — for a page that needs a signed-in user first. */
    enabled = true,
    /**
     * Re-run when any of these change: a user id, a date range. Values only,
     * never functions — the loader itself is held in a ref precisely so that an
     * inline arrow does not restart the request on every render.
     */
    deps = [],
  }: {
    onError?: (error: unknown) => string;
    enabled?: boolean;
    deps?: readonly (string | number | boolean | null | undefined)[];
  } = {},
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Kept in refs so an inline arrow does not restart the request on every
  // render. Updated in an effect rather than during render, and declared before
  // the loading effect so it is current by the time the loader runs.
  const loadRef = useRef(load);
  const errorRef = useRef(onError);
  useEffect(() => {
    loadRef.current = load;
    errorRef.current = onError;
  });

  // Whether the next run was asked for by `refresh()`, and whether one is running.
  const silentRef = useRef(false);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const silent = silentRef.current;
    silentRef.current = false;
    inFlightRef.current = true;

    // No setState before this point: the initial state is already `loading`,
    // and a reload set it in its own handler.
    loadRef
      .current()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((thrown) => {
        if (cancelled) return;
        // A background refresh that fails keeps what the customer is already
        // looking at; the next refresh, or a manual retry, will try again.
        if (silent) {
          console.warn('Background refresh failed; keeping current data.', thrown);
          return;
        }
        setError(errorRef.current ? errorRef.current(thrown) : 'Something went wrong.');
      })
      .finally(() => {
        if (cancelled) return;
        inFlightRef.current = false;
        setLoading(false);
      });

    return () => {
      cancelled = true;
      inFlightRef.current = false;
    };
    // `deps` is spread so each value is its own dependency; the array identity
    // changes every render and would restart the request forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, attempt, ...deps]);

  const reload = useCallback(() => {
    // A retry the customer asked for is never silent, even if a background
    // refresh was queued in the same tick.
    silentRef.current = false;
    setLoading(true);
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  const refresh = useCallback(() => {
    if (inFlightRef.current) return;
    silentRef.current = true;
    setAttempt((n) => n + 1);
  }, []);

  return { data, loading, error, reload, refresh, setData };
}
