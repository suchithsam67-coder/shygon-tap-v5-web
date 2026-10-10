import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportClientError } from '../lib/reportError';

/**
 * The last line of defence for a render error (V6-018): instead of a blank
 * white page, the visitor is told what happened and offered a reload, and the
 * error is reported through the client error hook.
 *
 * Uses the public Tap's state-page styles (styles/tap.css), which every page
 * loads, so it looks the same whether the Tap or the account area failed.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportClientError(error, 'react.render', info.componentStack ?? undefined);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="tap-state-page" role="alert">
        <div>
          <h1>Something went wrong</h1>
          <p>This page hit an unexpected error. Reloading usually fixes it.</p>
          <button type="button" className="tap-state-button" onClick={() => window.location.reload()}>
            Reload the page
          </button>
        </div>
      </div>
    );
  }
}
