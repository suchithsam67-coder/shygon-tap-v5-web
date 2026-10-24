import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AAROH_EDITIONS, AAROH_FINISHES, editionById } from '../../data/aaroh';
import type { Catalog } from '../../services/catalog';

/**
 * The AAROH edition overview (2026-10-14/16): what the store promises and
 * where it hands off. The welcome and the theme are exercised in the browser
 * (e2e/journeys.spec.ts); here: the selection hands the chosen edition, finish
 * and quantity to checkout only while card sales are open and the variant is
 * in stock; the roadmap is labelled Coming soon, has no actions and no Privé; and
 * the edition switcher offers the neighbouring editions.
 */

const sales = vi.hoisted(() => ({ open: false }));
vi.mock('../../lib/commerce', async (original) => ({
  ...(await original<typeof import('../../lib/commerce')>()),
  get CARD_SALES_OPEN() {
    return sales.open;
  },
}));
vi.mock('../../hooks/useGoToTiers', () => ({ useGoToTiers: () => () => {} }));

const { default: AarohOverview } = await import('./AarohOverview');

beforeAll(() => {
  // jsdom has <dialog> without the modal API.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  window.matchMedia ??= ((query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList);
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
  localStorage.setItem('shygon_aaroh_intro_seen', '1');
});
afterEach(() => {
  cleanup();
  sales.open = false;
});

const obsidian = editionById('obsidian')!;
const premium = AAROH_FINISHES.find((f) => f.id === 'premium')!;

function catalog(stock: number): Catalog {
  return {
    aaroh: AAROH_EDITIONS.flatMap((edition) =>
      AAROH_FINISHES.map((finish) => ({
        sku: `card-aaroh-${edition.id}-${finish.id}`,
        edition: edition.id,
        finish: finish.id,
        priceInPaise: finish.id === 'premium' ? 149900 : 99900,
        stock,
        name: `SHYGON AAROH ${edition.title}`,
      })),
    ),
  } as unknown as Catalog;
}

function renderOverview(props: Partial<Parameters<typeof AarohOverview>[0]> = {}) {
  const handlers = { onClose: vi.fn(), onEdition: vi.fn(), onFinish: vi.fn(), onBuy: vi.fn() };
  render(
    <MemoryRouter>
      <AarohOverview edition={obsidian} finish={premium} catalog={catalog(5)} {...handlers} {...props} />
    </MemoryRouter>,
  );
  return handlers;
}
const selection = () => within(document.getElementById('ao-choose')!);

describe('AarohOverview', () => {
  it('hands the edition and quantity to checkout when card sales are open and the card is in stock', () => {
    sales.open = true;
    const { onBuy } = renderOverview();
    expect(selection().getAllByText('₹1,499').length).toBe(2); // the Premium Finish option and the price
    fireEvent.click(selection().getByRole('button', { name: 'One card more' }));
    fireEvent.click(selection().getByRole('button', { name: 'Choose Obsidian' }));
    expect(onBuy).toHaveBeenCalledWith(2);
  });

  it('offers no purchase while card sales are closed, and says so', () => {
    const { onBuy } = renderOverview();
    expect(selection().queryByRole('button', { name: 'Choose Obsidian' })).toBeNull();
    expect(selection().getByText('SHYGON cards are coming soon')).toBeTruthy();
    expect(selection().getByText('Pricing announced when card sales open.')).toBeTruthy();
    expect(document.getElementById('ao-choose')!.textContent).not.toContain('₹');
    expect(onBuy).not.toHaveBeenCalled();
  });

  it('offers no purchase for a variant without stock, even with sales open', () => {
    sales.open = true;
    renderOverview({ catalog: catalog(0) });
    expect(selection().queryByRole('button', { name: 'Choose Obsidian' })).toBeNull();
    expect(selection().getByText(/not in stock yet/)).toBeTruthy();
  });

  it('labels the roadmap Coming soon, gives it no action, and leaves Privé out', () => {
    renderOverview();
    const features = within(document.getElementById('ao-features')!);
    expect(features.getByRole('heading', { name: 'Upcoming SHYGON OS features' })).toBeTruthy();
    expect(features.queryByText(/Privé/)).toBeNull();
    fireEvent.click(features.getByRole('button', { name: /^Return to Owner/ }));
    // One word for the whole roadmap, the owner's (Q-B, 2026-10-23); "Planned" is gone.
    expect(features.getAllByText('Coming soon').length).toBeGreaterThan(1);
    expect(features.queryByText('Planned')).toBeNull();
    expect((features.getByRole('button', { name: 'Not available yet' }) as HTMLButtonElement).disabled).toBe(true);
    expect(features.queryByRole('link', { name: /Set up|Open|Choose|See|Manage/ })).toBeNull();
    fireEvent.click(features.getByRole('button', { name: /^Digital profile/ }));
    expect(features.getByRole('link', { name: /Set up your profile/ }).getAttribute('href')).toBe('/shygontap/tap');
  });

  it('switches to the neighbouring editions and closes on request', () => {
    const { onEdition, onClose } = renderOverview();
    fireEvent.click(screen.getByRole('button', { name: 'Next edition: Aureate' }));
    expect(onEdition).toHaveBeenCalledWith(editionById('aureate'));
    fireEvent.click(screen.getByRole('button', { name: 'Previous edition: Liquid Form' }));
    expect(onEdition).toHaveBeenLastCalledWith(editionById('liquid-form'));
    fireEvent.click(screen.getByRole('button', { name: 'Close the overview' }));
    expect(onClose).toHaveBeenCalled();
  });
});
