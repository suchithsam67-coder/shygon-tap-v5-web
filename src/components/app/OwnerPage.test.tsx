import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { OwnerPage } from './OwnerPage';
import type { ServerFeature } from '../showroom/modes';

/**
 * Unreleased owner pages in a production build (owner, Q-C 2026-10-23): their
 * addresses go to "Your AAROH experience"; a test or preview build
 * (`VITE_AAROH_PREVIEW_PAGES=on`) keeps them, and a released feature keeps its
 * page everywhere.
 */

const flags = vi.hoisted(() => ({
  preview: false,
  released: { emergency: false, return: false, connect: false } as Record<string, boolean>,
}));
vi.mock('../showroom/modes', () => ({
  get PREVIEW_PAGES() {
    return flags.preview;
  },
  get RELEASED() {
    return flags.released;
  },
}));

afterEach(() => {
  cleanup();
  flags.preview = false;
  flags.released = { emergency: false, return: false, connect: false };
});

const PAGES: [ServerFeature, string][] = [
  ['emergency', '/shygontap/emergency'],
  ['return', '/shygontap/return-to-owner'],
  ['connect', '/shygontap/connections'],
  ['connect', '/shygontap/connect/asha'],
];

const visit = (feature: ServerFeature, path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path={path}
          element={
            <OwnerPage feature={feature}>
              <h1>The owner page</h1>
            </OwnerPage>
          }
        />
        <Route path="/shygontap/experience" element={<h1>Your AAROH experience</h1>} />
      </Routes>
    </MemoryRouter>,
  );

describe('owner pages of unreleased features', () => {
  it.each(PAGES)('production build: %s at %s goes to the experience page', (feature, path) => {
    visit(feature, path);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Your AAROH experience');
    expect(screen.queryByText('The owner page')).toBeNull();
  });

  it.each(PAGES)('test or preview build (flag on): %s at %s stays reachable', (feature, path) => {
    flags.preview = true;
    visit(feature, path);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('The owner page');
  });

  it('a released feature keeps its page in a production build; the others still redirect', () => {
    flags.released = { emergency: true, return: false, connect: false };
    visit('emergency', '/shygontap/emergency');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('The owner page');
    cleanup();
    visit('connect', '/shygontap/connections');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Your AAROH experience');
  });
});
