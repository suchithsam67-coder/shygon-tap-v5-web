import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AVAILABILITY_LABEL, MODES, PRIVE_DEMO, RELEASED, type ServerFeature } from '../components/showroom/modes';
import { AAROH_SHOWCASE, STATUS_LABEL } from '../data/aarohProduct';
import { AppShell } from '../components/app/AppShell';

/**
 * What a customer is told matches what is really available (owner gate
 * decisions, 2026-10-20 §1, §3, §5, §6.3).
 */

vi.mock('../lib/auth-context', () => ({ useAuth: () => ({ user: { email: 'owner@example.test' }, signOut: async () => {} }) }));
vi.mock('../lib/account-context', () => ({ useAccount: () => ({ profile: null, unreadCount: 0 }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const APPROVED: Record<ServerFeature, { name: string; description: string }> = {
  emergency: {
    name: 'Emergency Profile',
    description: 'Keep the emergency information you choose ready when it matters. You control what is stored and what may be shared.',
  },
  return: {
    name: 'Return to Owner',
    description:
      'Lost something with SHYGON? Let the finder contact you through a privacy-conscious relay, without automatically exposing your personal contact details.',
  },
  connect: {
    name: 'SHYGON Connect',
    description: 'Build meaningful connections and exchange the information you choose to share.',
  },
};

describe('customer availability', () => {
  it('uses only the approved words, and never "Live"', () => {
    expect(Object.values(AVAILABILITY_LABEL).sort()).toEqual(['Available', 'Coming soon', 'Demo', 'Setup required', 'Unavailable']);
    expect([...Object.values(AVAILABILITY_LABEL), ...Object.values(STATUS_LABEL)]).not.toContain('Live');
  });

  it('Emergency Profile, Return to Owner and SHYGON Connect: the approved wording, and "Coming soon" until released', () => {
    for (const id of Object.keys(APPROVED) as ServerFeature[]) {
      expect(MODES[id].name).toBe(APPROVED[id].name);
      expect(MODES[id].tagline).toBe(APPROVED[id].description);
      // Not released: never shown as available to a customer. Released: available.
      expect(MODES[id].availability).toBe(RELEASED[id] ? 'available' : 'coming-soon');
    }
  });

  it('the store says the same for the two it lists', () => {
    for (const [storeId, id] of [['emergency', 'emergency'], ['return-to-owner', 'return']] as const) {
      const feature = AAROH_SHOWCASE.find((f) => f.id === storeId)!;
      expect(feature.name).toBe(APPROVED[id].name);
      expect(feature.benefit).toBe(APPROVED[id].description);
      expect(feature.statusLabel ?? STATUS_LABEL[feature.status]).toBe(RELEASED[id] ? 'Available' : 'Coming soon');
      expect(feature.action).toBeUndefined();
    }
  });

  it('Privé is a labelled demo and stays off until its wording is approved', () => {
    expect(MODES.prive.availability).toBe('demo');
    expect(PRIVE_DEMO).toBe(false);
  });

  it('the account menu offers no feature that is not released', () => {
    // The menu's scroll rail measures itself; jsdom has no ResizeObserver.
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    render(
      <MemoryRouter>
        <AppShell title="Test">
          <p>page</p>
        </AppShell>
      </MemoryRouter>,
    );
    const nav = within(screen.getByRole('navigation', { name: 'Account' }));
    for (const id of Object.keys(APPROVED) as ServerFeature[]) {
      expect(nav.queryAllByRole('link', { name: APPROVED[id].name })).toHaveLength(RELEASED[id] ? 1 : 0);
    }
    expect(nav.getByRole('link', { name: 'AAROH experience' })).toBeTruthy();
  });
});
