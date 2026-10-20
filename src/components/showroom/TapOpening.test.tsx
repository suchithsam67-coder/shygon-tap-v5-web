import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { TapOpening } from './TapOpening';

/** The opening's own guarantees (owner gate decisions, 2026-10-20 §2). */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (!document.getElementById('test-opening-rule')) {
    const rule = document.createElement('style');
    rule.id = 'test-opening-rule';
    rule.textContent = '.tap-opening { position: fixed; }';
    document.head.appendChild(rule);
  }
});

describe('the SHYGON opening', () => {
  it('says it can be skipped, and a key ends it', async () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<TapOpening onDone={onDone} />);
    expect(screen.getByText('Tap to skip')).toBeTruthy();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('never holds content that is not ready longer than the content takes, and lifts at once with minMs 0', async () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    const { rerender } = render(<TapOpening onDone={onDone} ready={false} minMs={0} />);
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(onDone).not.toHaveBeenCalled();
    rerender(<TapOpening onDone={onDone} ready minMs={0} />);
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('if its stylesheet failed to load, it leaves at once and the normal page shows', () => {
    document.getElementById('test-opening-rule')?.remove();
    const onDone = vi.fn();
    render(<TapOpening onDone={onDone} />);
    // Before any timer: the layout effect saw no curtain styles and finished.
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
