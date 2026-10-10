/**
 * The client error hook (V6-018).
 *
 * Every unexpected error in the browser comes through here: render errors
 * caught by the ErrorBoundary, uncaught exceptions and unhandled promise
 * rejections. Today it writes one console line and raises a `shygon:error`
 * event on window. No error-tracking provider is wired in yet (choosing one is
 * an owner decision, because it sends data to a third party); when one is
 * chosen it subscribes to that event, and nothing else in the app changes.
 *
 * What is reported is the error's name and message, where it happened and
 * when. Never form contents, tokens or the session.
 */
export interface ClientErrorReport {
  name: string;
  message: string;
  source: string;
  path: string;
  at: string;
  componentStack?: string;
}

const MAX = 500;

export function reportClientError(error: unknown, source: string, componentStack?: string): ClientErrorReport {
  const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown error');
  const report: ClientErrorReport = {
    name: err.name,
    message: err.message.slice(0, MAX),
    source,
    path: typeof window !== 'undefined' ? window.location.pathname : '',
    at: new Date().toISOString(),
    ...(componentStack ? { componentStack: componentStack.slice(0, MAX) } : {}),
  };
  console.error('[shygon] client error', report);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('shygon:error', { detail: report }));
  return report;
}

/** Uncaught exceptions and unhandled rejections, reported once each. */
export function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (event) => reportClientError(event.error ?? event.message, 'window.error'));
  window.addEventListener('unhandledrejection', (event) => reportClientError(event.reason, 'unhandledrejection'));
}
