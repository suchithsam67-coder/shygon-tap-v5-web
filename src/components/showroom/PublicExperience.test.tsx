import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../../App';
import { DEFAULT_THEME, type PublicProfile } from '../../lib/database.types';
import { liveModesFor, MODES, MODE_ORDER } from './modes';

/**
 * The AAROH public experience: opening → showroom → mode → back (brief §2–§10).
 * The data layer is replaced at its boundary (src/lib/publicTapClient.ts), as
 * in PublicTap.test.tsx; what the server returns is proven against the real
 * schema in supabase/tests/public-tap.mjs and golden-public-tap.mjs.
 */

const client = vi.hoisted(() => ({
  fetchPublicProfile: vi.fn(),
  fetchPublicTapState: vi.fn(),
  recordTapEvent: vi.fn(),
}));
vi.mock('../../lib/publicTapClient', () => client);

function profile(overrides: Partial<PublicProfile> = {}): PublicProfile {
  return {
    slug: 'asha',
    experience: 'business',
    displayName: 'Asha Rao',
    headline: 'Architect, Bengaluru',
    designation: null,
    company: null,
    bio: null,
    avatarUrl: null,
    location: null,
    phone: null,
    whatsapp: null,
    email: null,
    website: null,
    instagram: null,
    linkedin: null,
    youtube: null,
    customLinks: [],
    theme: DEFAULT_THEME,
    activeEvent: null,
    ...overrides,
  };
}

function visit(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

const name = (text: string) => screen.findByRole('heading', { level: 1, name: text });
const cardTitles = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);

function reducedMotion(on: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: on && query.includes('reduce'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  client.fetchPublicProfile.mockReset();
  client.fetchPublicTapState.mockReset();
  client.recordTapEvent.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
  reducedMotion(false);
});
afterEach(() => {
  cleanup();
  // @ts-expect-error jsdom has no matchMedia of its own; remove the stand-in.
  delete window.matchMedia;
});

describe('which modes a real Tap shows (FE-D8)', () => {
  it('derives them from what the owner published, and never lists a planned, blocked or demo mode', () => {
    expect(liveModesFor(profile())).toEqual(['identity', 'owner']);
    expect(liveModesFor(profile({ company: 'Rao Studio' }))).toEqual(['identity', 'business', 'owner']);
    expect(liveModesFor(profile({ email: 'a@example.test' }))).toEqual(['identity', 'contact', 'owner']);
    expect(liveModesFor(profile({ customLinks: [{ label: 'Work', url: 'example.test' }] }))).toEqual(['identity', 'links', 'owner']);
    // A custom link with no address is not a link.
    expect(liveModesFor(profile({ customLinks: [{ label: 'Empty', url: '  ' }] }))).toEqual(['identity', 'owner']);
    const everything = profile({ company: 'x', phone: '1', website: 'x' });
    for (const id of liveModesFor(everything)) expect(MODES[id].availability).toBe('available');
  });

  it('never puts a demo, coming-soon or unsupported mode on a real Tap; Emergency and Return only when the server said so', () => {
    const everything = profile({ company: 'x', phone: '1', website: 'x' });
    expect(liveModesFor(everything)).toEqual(['identity', 'business', 'contact', 'links', 'owner']);
    expect(liveModesFor(everything, { emergency: true, rescue: true })).toEqual([
      'identity', 'business', 'contact', 'links', 'emergency', 'return', 'owner',
    ]);
    // Privé is demo-only (and off, FE-D5); Verify and Access are not part of AAROH (DEC-2026-037).
    expect(MODES.prive.availability).toBe('demo');
    expect(MODE_ORDER).not.toContain('prive');
    expect([MODES.verify.availability, MODES.access.availability]).toEqual(['unsupported', 'unsupported']);
    // Nothing is called "Live" to a customer (AAROH-API §12).
    expect(Object.values(MODES).map((m) => m.availability)).not.toContain('live');
  });
});

describe('the public Tap: opening, showroom, mode, back', () => {
  it('opens with the SHYGON opening over a showroom that is already there; a key ends it', async () => {
    client.fetchPublicProfile.mockResolvedValue(profile({ company: 'Rao Studio', phone: '+919800000000' }));
    visit('/t/asha');
    expect(await name('Asha Rao')).toBeTruthy();
    const opening = screen.getByTestId('tap-opening');
    expect(opening.getAttribute('aria-hidden')).toBe('true');
    expect(within(opening).getByText('AAROH')).toBeTruthy();
    // The cards and their real actions are in the page under the curtain.
    expect(cardTitles()).toEqual(['Profile', 'Business', 'Contact', 'Owner access']);
    expect(document.querySelector('a[href="tel:+919800000000"]')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('tap-opening')).toBeNull());
  });

  it('a tap on the opening ends it and is not passed through to the page', async () => {
    client.fetchPublicProfile.mockResolvedValue(profile());
    visit('/t/asha');
    await name('Asha Rao');
    const opening = screen.getByTestId('tap-opening');
    const event = new Event('pointerdown', { bubbles: true, cancelable: true });
    act(() => {
      opening.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(screen.queryByTestId('tap-opening')).toBeNull());
  });

  it('is the loading state: it is there before the profile arrives', async () => {
    let answer: (value: PublicProfile) => void = () => {};
    client.fetchPublicProfile.mockReturnValue(new Promise<PublicProfile>((resolve) => (answer = resolve)));
    visit('/t/asha');
    expect(screen.getByTestId('tap-opening')).toBeTruthy();
    expect(screen.getByText('Loading Tap…')).toBeTruthy();
    answer(profile());
    expect(await name('Asha Rao')).toBeTruthy();
  });

  it('lifts as soon as the page is ready when the owner turned their opening off, and never plays under reduced motion', async () => {
    client.fetchPublicProfile.mockResolvedValue(profile({ theme: { ...DEFAULT_THEME, animation: 'none' } }));
    const started = Date.now();
    visit('/t/asha');
    await name('Asha Rao');
    await waitFor(() => expect(screen.queryByTestId('tap-opening')).toBeNull(), { timeout: 1500 });
    expect(Date.now() - started).toBeLessThan(1500);
    cleanup();

    reducedMotion(true);
    client.fetchPublicProfile.mockResolvedValue(profile());
    visit('/t/asha');
    expect(screen.queryByTestId('tap-opening')).toBeNull();
    await name('Asha Rao');
    expect(screen.queryByTestId('tap-opening')).toBeNull();
  });

  it('a Tap that is not available is not held behind the opening', async () => {
    client.fetchPublicProfile.mockResolvedValue(null);
    client.fetchPublicTapState.mockResolvedValue('unavailable');
    visit('/t/nobody');
    expect(await screen.findByText('Tap not found')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('tap-opening')).toBeNull(), { timeout: 1500 });
  });

  it('opens a mode, and Back returns to the showroom with focus on the card that was opened', async () => {
    client.fetchPublicProfile.mockResolvedValue(profile({ company: 'Rao Studio', designation: 'Principal', location: 'Bengaluru' }));
    visit('/t/asha');
    await name('Asha Rao');
    // As a visitor does: the curtain swallows taps, and any key lifts it first.
    fireEvent.keyDown(window, { key: 'Tab' });
    await waitFor(() => expect(screen.queryByTestId('tap-opening')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /Business details/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Business' })).toBeTruthy();
    expect(screen.getByText('Principal')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Directions/ }).getAttribute('href')).toContain('google.com/maps');
    // The opening never replays over a mode or on the way back.
    expect(screen.queryByTestId('tap-opening')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Showroom/ }));
    await name('Asha Rao');
    await waitFor(() => expect(document.activeElement?.id).toBe('sr-open-business'));
    expect(screen.queryByTestId('tap-opening')).toBeNull();
  });

  it('the profile card is the owner’s own paid design, with a way back', async () => {
    client.fetchPublicProfile.mockResolvedValue(profile({ bio: 'Designs calm houses.' }));
    visit('/t/asha?mode=identity');
    expect(await screen.findByText('Designs calm houses.')).toBeTruthy();
    expect(document.querySelector('.tap-experience-business')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Showroom/ }));
    expect(await name('Asha Rao')).toBeTruthy();
  });

  it('a link to a mode opens it directly, keeps src=nfc for analytics, and an unknown or unavailable mode falls back to the showroom', async () => {
    client.fetchPublicProfile.mockResolvedValue(profile({ email: 'asha@example.test' }));
    visit('/t/asha?src=nfc&mode=contact');
    expect(await screen.findByRole('heading', { level: 1, name: 'Contact' })).toBeTruthy();
    // A link to a mode does not replay the reveal: the curtain only covers the load.
    await waitFor(() => expect(screen.queryByTestId('tap-opening')).toBeNull(), { timeout: 1500 });
    await waitFor(() => expect(client.recordTapEvent.mock.calls).toEqual([['asha', 'view'], ['asha', 'nfc']]));
    cleanup();

    for (const path of ['/t/asha?mode=emergency', '/t/asha?mode=business', '/t/asha?mode=nonsense']) {
      visit(path);
      expect(await name('Asha Rao')).toBeTruthy();
      expect(screen.queryByText(/emergency/i)).toBeNull();
      cleanup();
    }
  });

  it('records a click on a quick action like the profile card does', async () => {
    client.fetchPublicProfile.mockResolvedValue(profile({ whatsapp: '+91 98000 00000' }));
    visit('/t/asha');
    await name('Asha Rao');
    const whatsapp = screen.getAllByRole('link', { name: /WhatsApp/ })[0]!;
    expect(whatsapp.getAttribute('href')).toBe('https://wa.me/919800000000');
    fireEvent.click(whatsapp);
    await waitFor(() => expect(client.recordTapEvent).toHaveBeenCalledWith('asha', 'link_click', 'whatsapp'));
  });

  it('keyboard: Left/Right/Home/End move between cards', async () => {
    client.fetchPublicProfile.mockResolvedValue(profile({ company: 'Rao Studio', email: 'a@example.test' }));
    visit('/t/asha');
    await name('Asha Rao');
    const cards = screen.getAllByRole('group').filter((el) => el.getAttribute('aria-roledescription') === 'slide');
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Profile, 1 of 4',
      'Business, 2 of 4',
      'Contact, 3 of 4',
      'Owner access, 4 of 4',
    ]);
    const rail = cards[0]!.parentElement!;
    fireEvent.keyDown(rail, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(cards[1]);
    expect(screen.getByRole('button', { name: 'Show Business' }).getAttribute('aria-current')).toBe('true');
    fireEvent.keyDown(rail, { key: 'End' });
    expect(document.activeElement).toBe(cards[3]);
    expect(screen.getByRole('button', { name: 'Next card' })).toHaveProperty('disabled', true);
    fireEvent.keyDown(rail, { key: 'Home' });
    expect(document.activeElement).toBe(cards[0]);
    expect(screen.getByRole('button', { name: 'Previous card' })).toHaveProperty('disabled', true);
  });

  it('owner access leads to the ordinary sign-in and shows nothing private', async () => {
    client.fetchPublicProfile.mockResolvedValue(profile());
    visit('/t/asha?mode=owner');
    expect(await screen.findByRole('heading', { level: 1, name: 'Owner access' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /I’m the owner: sign in/ }).getAttribute('href')).toBe('/shygontap/auth');
    expect(screen.getByText(/never signs anyone in/)).toBeTruthy();
    expect(document.querySelector('input, textarea, select')).toBeNull();
  });

  it('renders only the published fields: anything else in the payload never reaches the page', async () => {
    const leaky = { ...profile({ company: 'Rao Studio' }), user_id: 'a1b2c3-private-user-id', login_email: 'private@example.test' };
    client.fetchPublicProfile.mockResolvedValue(leaky);
    const { container } = visit('/t/asha');
    await name('Asha Rao');
    for (const mode of ['', '?mode=identity', '?mode=business', '?mode=owner']) {
      if (mode) {
        cleanup();
        visit(`/t/asha${mode}`);
        await screen.findAllByRole('heading', { level: 1 });
      }
      expect(document.body.innerHTML).not.toContain('a1b2c3-private-user-id');
      expect(document.body.innerHTML).not.toContain('private@example.test');
    }
    expect(container).toBeTruthy();
  });
});

describe('the demo showroom (/aaroh/experience)', () => {
  it('is labelled a demo, not indexed, and shows every mode under its real status', async () => {
    visit('/aaroh/experience');
    expect(await screen.findByRole('heading', { level: 1, name: 'Sample Profile' })).toBeTruthy();
    expect(screen.getByRole('note').textContent).toMatch(/Demo.*not a real person/);
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toContain('noindex');
    expect(cardTitles()).toEqual(MODE_ORDER.map((id) => MODES[id].name));
    // Planned modes say so, and have nothing to press.
    for (const id of MODE_ORDER.filter((m) => MODES[m].availability === 'coming-soon' || MODES[m].availability === 'unsupported')) {
      const card = document.querySelector(`[data-mode="${id}"]`) as HTMLElement;
      expect(within(card).getByText(MODES[id].availability === 'unsupported' ? 'Unsupported' : 'Coming soon')).toBeTruthy();
      // Only a labelled walkthrough has a button, and it says it is a demo.
      if (MODES[id].demoWalkthrough) expect(within(card).getByRole('button', { name: /Try the demo/ })).toBeTruthy();
      else expect(card.querySelector('button')).toBeNull();
    }
    // Privé is off until the owner settles FE-D5 / DEC-2026-038 Q6.
    expect(document.querySelector('[data-mode="prive"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/\bLive\b/);
    expect(client.fetchPublicProfile).not.toHaveBeenCalled();
  });

  it('the emergency walkthrough asks for intent, works once, sends nothing, and never claims an alert went out', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    visit('/aaroh/experience?mode=emergency');
    expect(await screen.findByRole('heading', { level: 1, name: 'Emergency' })).toBeTruthy();
    expect(screen.getByText(/Nothing here is sent to anyone/)).toBeTruthy();
    expect(screen.getByText(/SHYGON never contacts the police/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Call 112/ }).getAttribute('href')).toBe('tel:112');

    fireEvent.click(screen.getByRole('button', { name: 'Walk through an alert' }));
    const submit = screen.getByRole('button', { name: /review \(demo\)/ });
    expect(submit).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByLabelText('I found this card'));
    expect(submit).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByLabelText(/I understand a real alert/));
    expect(submit).toHaveProperty('disabled', false);
    fireEvent.click(submit);

    expect(await screen.findByRole('heading', { name: 'Demo finished. No alert was sent.' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /review \(demo\)/ })).toBeNull();
    expect(screen.queryByText(/alert (was )?sent to|contacts (were|have been) (alerted|notified)/i)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
