import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary';
import type { ClientErrorReport } from '../lib/reportError';

/**
 * A render error shows the reload page instead of a blank one, and is reported
 * once through the client error hook, with its message but nothing else of the
 * page (V6-018).
 */

function Broken(): never {
  throw new TypeError('profile is undefined');
}

afterEach(cleanup);

describe('ErrorBoundary', () => {
  it('renders its children when nothing fails', () => {
    render(<ErrorBoundary><p>All good</p></ErrorBoundary>);
    expect(screen.getByText('All good')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('replaces a failed render with a way out, and reports the error once', () => {
    const reports: ClientErrorReport[] = [];
    const listen = (event: Event) => reports.push((event as CustomEvent<ClientErrorReport>).detail);
    window.addEventListener('shygon:error', listen);
    // React logs the caught error too; keep the test output to real failures.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<ErrorBoundary><Broken /></ErrorBoundary>);
    } finally {
      window.removeEventListener('shygon:error', listen);
    }

    expect(screen.getByRole('alert').textContent).toContain('Something went wrong');
    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeTruthy();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ name: 'TypeError', message: 'profile is undefined', source: 'react.render' });
    expect(typeof reports[0].componentStack).toBe('string');
  });
});
