import { supabase } from '../lib/supabase';
import { toExperience, type Experience, type ProductRow } from '../lib/database.types';

/**
 * The catalog, loaded from the database.
 *
 * Price, stock and availability come from `products` and nowhere else — the
 * server re-reads them again at checkout, so the numbers rendered here are
 * display-only and can never decide what a customer is charged.
 *
 * Marketing copy and card photography stay in `src/data/shygonTapData.ts`.
 * That is static presentation, not commerce data, and keeping it out of the
 * database avoids a migration every time a sentence changes.
 */

export interface CardVariant {
  sku: string;
  material: string;
  tier: string;
  priceInPaise: number;
  stock: number | null;
  name: string;
}

/** A card family (business / restaurant / event / google-review). */
export interface CardProduct {
  category: string;
  name: string;
  shortDescription: string | null;
  variants: CardVariant[];
  /** Cheapest in-stock configuration, in paise. */
  fromPriceInPaise: number;
  inStock: boolean;
}

export interface ExperienceProduct {
  sku: string;
  /** The experience id. Since migration 004 this is also the SKU suffix. */
  id: Experience;
  name: string;
  priceInPaise: number;
  shortDescription: string | null;
}

export interface PassProduct {
  sku: string;
  name: string;
  priceInPaise: number;
  shortDescription: string | null;
}

export interface CustomizationProduct {
  sku: string;
  /** Entitlement key — the sku without its `addon-` prefix. */
  key: string;
  name: string;
  priceInPaise: number;
  shortDescription: string | null;
}

export interface Catalog {
  cards: CardProduct[];
  experiences: ExperienceProduct[];
  customizations: CustomizationProduct[];
  /** The one-time ₹999 Customization Pass. */
  pass: PassProduct | null;
  /** The delivery charge on every order with a physical card (migration 023). */
  deliveryInPaise: number;
}

/**
 * What checkout shows for delivery when the catalogue has no delivery row yet.
 * Display only — /api/create-order applies the same fallback server-side.
 */
export const DELIVERY_FALLBACK_IN_PAISE = 4900;

const PRODUCT_COLUMNS =
  'id, sku, name, category, material, tier, ui_tier, price, price_in_paise, ' +
  'description, short_description, image_url, features, badge, stock, ' +
  'product_type, sort_order, active';

/** `card-business-standard-pvc` -> category `business`. Falls back to the column. */
function categoryOf(row: ProductRow): string {
  return row.category ?? row.sku?.split('-')[1] ?? 'card';
}

/**
 * Several components price themselves independently — the landing page hero,
 * the configurator, the store grid, the product detail page — and each used to
 * issue its own identical `products` query on mount. That was measured at four
 * identical full-table fetches for a single view of /shygontap.
 *
 * They are deduplicated here rather than by lifting state, because the callers
 * are deliberately independent: any of them may be rendered on its own. A
 * request already in flight is shared, and the result is reused for a short
 * window so a route change does not re-fetch what was just read.
 *
 * The window is deliberately short. Price and stock still come from the
 * database, and checkout re-reads both server-side, so the worst a stale entry
 * can do is show a price a few seconds out of date — never charge one.
 */
const CATALOG_TTL_MS = 30_000;
let inFlight: Promise<Catalog> | null = null;
let cached: { at: number; catalog: Catalog } | null = null;

/** Drops the cache so the next read hits the database (e.g. after a purchase). */
export function invalidateCatalog(): void {
  cached = null;
  inFlight = null;
}

export function fetchCatalog(): Promise<Catalog> {
  if (cached && Date.now() - cached.at < CATALOG_TTL_MS) {
    return Promise.resolve(cached.catalog);
  }
  if (inFlight) return inFlight;

  inFlight = loadCatalog()
    .then((catalog) => {
      cached = { at: Date.now(), catalog };
      return catalog;
    })
    .finally(() => {
      // Cleared either way: a failed load must not be retried from a stale
      // rejected promise, and the next caller should get a fresh attempt.
      inFlight = null;
    });

  return inFlight;
}

async function loadCatalog(): Promise<Catalog> {
  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_COLUMNS)
    .eq('active', true)
    .order('sort_order', { ascending: true });

  if (error) throw error;

  const rows = (data ?? []) as unknown as ProductRow[];
  const priced = rows.filter((row) => typeof row.price_in_paise === 'number');

  const byCategory = new Map<string, CardProduct>();

  for (const row of priced.filter((r) => r.product_type === 'card')) {
    const category = categoryOf(row);
    const existing = byCategory.get(category) ?? {
      category,
      name: row.name.split('—')[0]!.trim(),
      shortDescription: row.short_description,
      variants: [],
      fromPriceInPaise: Number.POSITIVE_INFINITY,
      inStock: false,
    };

    existing.variants.push({
      sku: row.sku!,
      material: row.material ?? 'pvc',
      tier: row.tier ?? 'standard',
      priceInPaise: row.price_in_paise!,
      stock: row.stock,
      name: row.name,
    });

    byCategory.set(category, existing);
  }

  const cards = [...byCategory.values()].map((product) => {
    // "From" price only counts configurations a customer can actually buy.
    const available = product.variants.filter((v) => v.stock === null || v.stock > 0);
    const pool = available.length > 0 ? available : product.variants;
    return {
      ...product,
      fromPriceInPaise: Math.min(...pool.map((v) => v.priceInPaise)),
      inStock: available.length > 0,
    };
  });

  // There are exactly four experiences and the storefront must never offer a
  // fifth, whatever an unmigrated database happens to still be listing.
  const experiences: ExperienceProduct[] = priced
    .filter(
      (row) =>
        row.product_type === 'digital_plan' &&
        // Retired by 004 and delisted, but a database that has not been
        // migrated yet would still return them.
        !['plan-custom', 'plan-pro', 'plan-3d'].includes(row.sku ?? ''),
    )
    .map((row) => ({
      sku: row.sku!,
      id: toExperience(row.ui_tier ?? row.sku!.replace(/^plan-/, '')),
      name: row.name,
      priceInPaise: row.price_in_paise!,
      shortDescription: row.short_description,
    }));

  // 002 seeded this as `plan-lifetime`; 004 replaces it with `pass-customization`
  // and delists the old row. Either can answer, newest first.
  const passRow =
    priced.find((row) => row.sku === 'pass-customization') ??
    priced.find((row) => row.product_type === 'lifetime_plan');
  const pass: PassProduct | null = passRow
    ? {
        sku: passRow.sku!,
        name: passRow.name,
        priceInPaise: passRow.price_in_paise!,
        shortDescription: passRow.short_description,
      }
    : null;

  const customizations: CustomizationProduct[] = priced
    .filter((row) => row.product_type === 'customization')
    .map((row) => ({
      sku: row.sku!,
      key: row.sku!.replace(/^addon-/, ''),
      name: row.name,
      priceInPaise: row.price_in_paise!,
      shortDescription: row.short_description,
    }));

  const deliveryRow = priced.find((row) => row.sku === 'delivery-standard');
  const deliveryInPaise = deliveryRow?.price_in_paise ?? DELIVERY_FALLBACK_IN_PAISE;

  return { cards, experiences, customizations, pass, deliveryInPaise };
}

/**
 * The cheapest listed price for an experience, or null when the catalog does
 * not offer it. Several SKUs could map to one experience, so this takes the
 * lowest rather than assuming there is exactly one.
 */
export function experiencePrice(
  catalog: Catalog | null,
  experience: Experience,
): ExperienceProduct | null {
  const candidates = (catalog?.experiences ?? []).filter((item) => item.id === experience);
  if (candidates.length === 0) return null;
  return candidates.reduce((cheapest, item) =>
    item.priceInPaise < cheapest.priceInPaise ? item : cheapest,
  );
}

/**
 * Card prices, keyed by `<category>-<tier>-<material>`, for the storefront.
 *
 * The storefront's static copy in `src/data/shygonTapData.ts` carries a price
 * too. That one is a fallback for when the catalog cannot be reached — the
 * database is the source of truth, and the server prices the order again from
 * the same table at checkout, so a stale constant can never decide a charge.
 */
export function cardPriceIndex(catalog: Catalog | null): Map<string, number> {
  const index = new Map<string, number>();
  for (const card of catalog?.cards ?? []) {
    for (const variant of card.variants) {
      index.set(`${card.category}-${variant.tier}-${variant.material}`, variant.priceInPaise);
    }
  }
  return index;
}

export function findVariant(
  product: CardProduct | undefined,
  tier: string,
  material: string,
): CardVariant | undefined {
  return product?.variants.find((v) => v.tier === tier && v.material === material);
}

export function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

export function priceLabel(paise: number): string {
  return paise === 0 ? 'Free' : rupees(paise);
}
