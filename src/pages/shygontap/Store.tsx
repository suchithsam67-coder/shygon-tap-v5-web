import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, ChevronRight, Search, SlidersHorizontal } from 'lucide-react';
import {
  materialLabels,
  products,
  tierLabels,
  type MaterialId,
  type Product,
  type TierId,
} from '../../data/shygonTapData';
import {
  AAROH_BULK_MINIMUM,
  AAROH_EDITIONS,
  AAROH_FINISHES,
  AAROH_PRODUCT_PATH,
  designPath,
} from '../../data/aaroh';
import { aarohPrice, cardPriceIndex, fetchCatalog } from '../../services/catalog';
import { useCatalog } from '../../hooks/useCatalog';
import { SITE_URL } from '../../lib/site';
import { LEGAL_PAGES, storeMeta } from '../../seo/meta';
import { usePageMeta } from '../../seo/usePageMeta';
import { editionAvailability, useEditions } from '../../lib/editions';
import { CARD_SALES_OPEN } from '../../lib/commerce';
import StoreFooter from '../../components/StoreFooter';
import AarohHeader from '../../components/aaroh/AarohHeader';
import AarohHero from '../../components/aaroh/AarohHero';
import EditionCollection from '../../components/aaroh/EditionCollection';
import CardsComingSoon from '../../components/CardsComingSoon';
import '../../styles/aaroh.css';

const META = storeMeta(SITE_URL, { cardSales: CARD_SALES_OPEN });

/**
 * The SHYGON store (DEC-2026-037): two products, launched together.
 *
 *   SHYGON TAP V5   the simple tap-to-open card: the existing catalogue, its
 *                   prices, product pages and purchase flow, unchanged.
 *   AAROH (V6)      the premium card: one product in the ten editions of the
 *                   AAROH design system and two finishes (src/data/aaroh.ts),
 *                   with its own collection page and edition overview.
 *
 * The page says what each is, compares them on verified facts, and sends a
 * visitor to the right product page. Every price is read from the catalogue
 * (with the bundled copy as a fallback) and never decides a charge: create-order
 * prices every order again from the products table.
 */

type SortKey = 'featured' | 'price-asc' | 'price-desc' | 'name';

const CATEGORY_LABELS: Record<string, string> = {
  business: 'Business',
  restaurant: 'Restaurant',
  event: 'Events',
  'google-review': 'Google Review',
};

const MATERIALS: MaterialId[] = ['pvc', 'metal', 'transparent'];
const TIERS: TierId[] = ['standard', 'premium'];
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/** V5 display prices, live from the catalogue where available (the bundled copy otherwise). */
function useCardPrices() {
  const [index, setIndex] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    let cancelled = false;
    fetchCatalog()
      .then((catalog) => { if (!cancelled) setIndex(cardPriceIndex(catalog)); })
      .catch(() => { /* fall back to the bundled copy */ });
    return () => { cancelled = true; };
  }, []);

  return useMemo(() => {
    const priceFor = (product: Product, tier: TierId, material: MaterialId): number => {
      const paise = index.get(`${product.id}-${tier}-${material}`);
      return paise === undefined ? product.pricing[tier][material] : Math.round(paise / 100);
    };
    const fromPrice = (product: Product): number =>
      Math.min(...TIERS.flatMap((tier) => MATERIALS.map((material) => priceFor(product, tier, material))));
    return { priceFor, fromPrice };
  }, [index]);
}

const EDITION_NAMES = AAROH_EDITIONS.map((e) => e.title).join(', ').replace(/, ([^,]*)$/, ' and $1');


export default function Store() {
  usePageMeta(META);
  const navigate = useNavigate();
  const catalog = useCatalog();
  const { fromPrice } = useCardPrices();
  const v5From = Math.min(...products.map(fromPrice));
  const [standardPrice, premiumPrice] = AAROH_FINISHES.map((finish) => aarohPrice(catalog, AAROH_EDITIONS[0]!.id, finish));

  return (
    <div className="store-page aaroh-store">
      <AarohHeader />

      <main className="store-main aaroh-main">
        <nav className="text-sm text-[var(--ds-text-tertiary)] mb-5" aria-label="Breadcrumb">
          <Link to="/shygontap" className="hover:text-[var(--ds-text)]">
            Shygon Tap
          </Link>
          <ChevronRight size={14} className="inline mx-1 -mt-0.5" />
          <span className="text-[var(--ds-text)] font-semibold" aria-current="page">Store</span>
        </nav>

        {/* ------------------------------------------------- two products */}
        <section className="store-intro" aria-labelledby="store-title">
          <header className="store-intro-head">
            <p className="aaroh-kicker">The SHYGON store</p>
            <h1 id="store-title">Two cards. One SHYGON profile.</h1>
            <p className="aaroh-promise">
              Tap either card with a compatible phone and your SHYGON profile opens in the browser, with no app. Preview
              SHYGON AAROH, the premium card{CARD_SALES_OPEN ? '' : ' coming soon'}, or browse SHYGON TAP V5, the simple card.
            </p>
          </header>

          <div className="store-choice">
            {/* SHYGON AAROH, the store's flagship preview (owner, 2026-10-16): no price, no purchase. */}
            <article className="store-choice-card store-choice-aaroh store-flagship" aria-labelledby="choice-aaroh">
              <div className="store-choice-art store-hero-card">
                <AarohHero compact onOpen={(edition) => navigate(designPath(edition))} headingId="choice-aaroh" />
              </div>
              {!CARD_SALES_OPEN && <p className="aaroh-preview-badge">Coming soon</p>}
              <h2 id="choice-aaroh">SHYGON AAROH</h2>
              <p className="aaroh-kicker">VERSION 01 · ONE CARD. MORE POSSIBILITIES.</p>
              <p>A physical card, connected to a digital experience powered by SHYGON OS.</p>
              <p className="store-choice-price">
                {CARD_SALES_OPEN ? (
                  <>
                    <strong>{inr(standardPrice)}</strong> Standard · <strong>{inr(premiumPrice)}</strong> Premium Finish
                  </>
                ) : (
                  <strong>Pricing announced when card sales open.</strong>
                )}
              </p>
              <p>Explore the collection, discover the planned capabilities, and preview the AAROH experience.</p>
              <div className="store-flagship-actions">
                <Link to={AAROH_PRODUCT_PATH} className="btn btn-blue">
                  Explore the collection <ArrowRight size={16} aria-hidden="true" />
                </Link>
                <Link to={designPath(AAROH_EDITIONS[0]!)} className="btn btn-ghost">
                  Preview the experience
                </Link>
              </div>
            </article>

            <article className="store-choice-card" aria-labelledby="choice-v5">
              <div className="store-choice-art">
                <img src={products[0]!.images.pvc} alt="" loading="eager" />
              </div>
              <p className="aaroh-kicker">SHYGON TAP V5</p>
              <h2 id="choice-v5">The simple tap-to-open card</h2>
              <p>
                Business, Restaurant, Event and Google Review cards, and six numbered Design Collection cards, in PVC,
                metal or transparent.
              </p>
              <p className="store-choice-price">
                From <strong>{inr(v5From)}</strong>
              </p>
              <a href="#v5" className="btn btn-ghost">
                Browse V5 cards <ArrowRight size={16} aria-hidden="true" />
              </a>
            </article>
          </div>
        </section>

        {!CARD_SALES_OPEN && <CardsComingSoon className="aaroh-coming-soon" />}

        {/* ---------------------------------------------------- compared */}
        <Comparison v5From={v5From} standardPrice={standardPrice} premiumPrice={premiumPrice} />

        {/* ------------------------------------------------ AAROH editions */}
        <section id="aaroh" className="aaroh-section" aria-labelledby="aaroh-editions-title">
          <header className="aaroh-section-head">
            <p className="aaroh-kicker">AAROH</p>
            <h2 id="aaroh-editions-title">Ten editions of the same card.</h2>
            <p>
              Every edition carries the same chip, QR code and SHYGON profile. Open one to see it up close, then choose
              its finish. {CARD_SALES_OPEN ? `From ${inr(standardPrice)} per card.` : 'Pricing is announced when card sales open.'} Ordering{' '}
              {AAROH_BULK_MINIMUM} or more for a team?{' '}
              <Link to={`${AAROH_PRODUCT_PATH}#teams`} className="aaroh-link">Request a quotation</Link>
            </p>
          </header>
          <EditionCollection />
        </section>

        {/* ------------------------------------------------- V5 catalogue */}
        <V5Catalogue />

        {/* ------------------------------------------- store information */}
        <StoreInformation />
      </main>

      <StoreFooter />
    </div>
  );
}

/**
 * The two cards side by side, on facts verified against the code (2026-10-13).
 * Both open the same SHYGON profile; the differences are the card itself.
 */
function Comparison({ v5From, standardPrice, premiumPrice }: { v5From: number; standardPrice: number; premiumPrice: number }) {
  const rows: Array<[label: string, v5: string, aaroh: string]> = [
    ['What it is', 'The simple tap-to-open NFC card', 'The premium NFC card, one product in ten editions'],
    ['Tap', 'NFC: a compatible phone opens your profile in its browser', 'The same'],
    ['QR code', 'Your Tap’s QR code, from your account, to print or share', 'Printed on the back of the card, and your Tap’s QR code in your account'],
    ['Designs', 'Business, Restaurant, Event, Google Review, and six Design Collection cards', EDITION_NAMES],
    ['Materials and finish', 'PVC, metal or transparent; standard or premium finish', 'Standard print, or a Premium Finish with each edition’s relief and foil. Materials are being validated with our manufacturer'],
    ['Numbered editions', 'Every design, in chapters of 100', 'Every edition, in chapters of 100'],
    ['Digital profile', 'Your SHYGON profile, with the same experiences and add-ons', 'The same profile, experiences and add-ons'],
    ['Price per card', `From ${inr(v5From)}`, CARD_SALES_OPEN ? `${inr(standardPrice)} Standard, ${inr(premiumPrice)} Premium Finish` : 'Announced when card sales open'],
    ['Ordering', 'Up to 10 cards per order', `Up to ${AAROH_BULK_MINIMUM - 1} per order; ${AAROH_BULK_MINIMUM} or more by quotation`],
    ['Not available yet, for both', 'Linking a card to your account, switching a lost card off, and replacements arrive with the card release', 'The same'],
  ];
  return (
    <section id="compare" className="aaroh-section" aria-labelledby="compare-title">
      <header className="aaroh-section-head">
        <p className="aaroh-kicker">Compare</p>
        <h2 id="compare-title">SHYGON TAP V5 or AAROH?</h2>
        <p>Both cards open the same SHYGON profile. The difference is the card you carry.</p>
      </header>
      <div className="aaroh-compare-scroll" tabIndex={0} role="region" aria-label="SHYGON TAP V5 and AAROH compared, scrolls sideways">
        <table className="aaroh-compare store-compare">
          <thead>
            <tr>
              <td />
              <th scope="col">SHYGON TAP V5</th>
              <th scope="col">AAROH</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, v5, aaroh]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{v5}</td>
                <td>{aaroh}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The SHYGON TAP V5 catalogue: the V6 RC store grid, with its search and filters. */
function V5Catalogue() {
  const [searchParams] = useSearchParams();
  const { priceFor, fromPrice } = useCardPrices();
  const editions = useEditions();
  const [query, setQuery] = useState('');
  // Deep links like /shygontap/store?category=restaurant land pre-filtered.
  const [categories, setCategories] = useState<string[]>(() => {
    const requested = searchParams.get('category');
    return requested && products.some((p) => p.id === requested) ? [requested] : [];
  });
  const [materials, setMaterials] = useState<MaterialId[]>([]);
  const [tier, setTier] = useState<TierId | 'any'>('any');
  const [maxPrice, setMaxPrice] = useState(1000);
  const [sort, setSort] = useState<SortKey>('featured');
  const [filtersOpen, setFiltersOpen] = useState(false);

  // A deep link to a category scrolls to the catalogue.
  useEffect(() => {
    if (searchParams.get('category')) document.getElementById('v5')?.scrollIntoView();
  }, [searchParams]);

  const toggle = <T,>(list: T[], value: T, set: (next: T[]) => void) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const matched = products.filter((product) => {
      if (categories.length > 0 && !categories.includes(product.id)) return false;

      // A product qualifies if ANY of its allowed configurations is in budget.
      const tiers = tier === 'any' ? TIERS : [tier];
      const mats = materials.length > 0 ? materials : MATERIALS;
      const cheapest = Math.min(...tiers.flatMap((t) => mats.map((m) => priceFor(product, t, m))));
      if (cheapest > maxPrice) return false;

      if (!needle) return true;
      const haystack = [product.name, product.eyebrow, product.description, ...product.features].join(' ').toLowerCase();
      return haystack.includes(needle);
    });

    const sorted = [...matched];
    if (sort === 'price-asc') sorted.sort((a, b) => fromPrice(a) - fromPrice(b));
    else if (sort === 'price-desc') sorted.sort((a, b) => fromPrice(b) - fromPrice(a));
    else if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));

    return sorted;
  }, [query, categories, materials, tier, maxPrice, sort, priceFor, fromPrice]);

  const activeFilterCount = categories.length + materials.length + (tier === 'any' ? 0 : 1) + (maxPrice < 1000 ? 1 : 0);

  const clearAll = () => {
    setCategories([]);
    setMaterials([]);
    setTier('any');
    setMaxPrice(1000);
    setQuery('');
  };

  return (
    <section id="v5" className="aaroh-section store-v5" aria-labelledby="v5-title">
      <div className="store-toolbar">
        <div>
          <p className="aaroh-kicker">SHYGON TAP V5</p>
          <h2 id="v5-title">All SHYGON TAP V5 cards</h2>
          <p className="text-[var(--ds-text-tertiary)] mt-3">
            {visible.length} {visible.length === 1 ? 'result' : 'results'}
            {activeFilterCount > 0 ? ` · ${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''} applied` : ''}
          </p>
        </div>

        <div className="store-v5-controls">
          <form onSubmit={(e) => e.preventDefault()} className="store-search store-v5-search relative" role="search">
            <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search V5 cards"
              aria-label="Search SHYGON TAP V5 cards"
              className="w-full pl-9 pr-3 py-2.5 text-sm outline-none"
            />
          </form>
          <button onClick={() => setFiltersOpen((v) => !v)} className="store-filter-toggle btn btn-ghost" aria-expanded={filtersOpen}>
            <SlidersHorizontal size={16} /> Filters
          </button>
          <label className="store-sort text-sm">
            <span className="sr-only">Sort by</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="min-h-[46px] px-4 text-sm font-semibold outline-none">
              <option value="featured">Sort: Featured</option>
              <option value="price-asc">Price: Low to High</option>
              <option value="price-desc">Price: High to Low</option>
              <option value="name">Name: A to Z</option>
            </select>
          </label>
        </div>
      </div>

      <div className="store-layout">
        <aside className={`${filtersOpen ? 'block' : 'hidden'} min-[981px]:block store-filter-panel`} aria-label="Filters">
          <div className="store-filter-section p-5 flex items-center justify-between">
            <h3 className="font-black">Filters</h3>
            {activeFilterCount > 0 && (
              <button onClick={clearAll} className="min-h-6 text-xs font-bold text-[var(--ds-accent)] hover:underline">
                Clear all
              </button>
            )}
          </div>

          <FilterGroup title="Card type">
            {products.map((product) => (
              <Checkbox
                key={product.id}
                label={CATEGORY_LABELS[product.id] ?? product.name}
                checked={categories.includes(product.id)}
                onChange={() => toggle(categories, product.id, setCategories)}
              />
            ))}
          </FilterGroup>

          <FilterGroup title="Material">
            {MATERIALS.map((material) => (
              <Checkbox key={material} label={materialLabels[material]} checked={materials.includes(material)} onChange={() => toggle(materials, material, setMaterials)} />
            ))}
          </FilterGroup>

          <FilterGroup title="Finish">
            <Radio label="Any finish" checked={tier === 'any'} onChange={() => setTier('any')} />
            {TIERS.map((t) => (
              <Radio key={t} label={tierLabels[t]} checked={tier === t} onChange={() => setTier(t)} />
            ))}
          </FilterGroup>

          <FilterGroup title="Max price">
            <input type="range" min={299} max={1000} step={100} value={maxPrice} onChange={(e) => setMaxPrice(Number(e.target.value))} className="w-full" aria-label="Maximum price" />
            <p className="text-sm text-[var(--ds-text-tertiary)] mt-1">
              Up to <span className="font-bold text-[var(--ds-text)]">₹{maxPrice}</span>
            </p>
          </FilterGroup>
        </aside>

        <div>
          {visible.length === 0 ? (
            <div className="state">
              <h3 className="text-xl font-black">No cards match those filters</h3>
              <p>Try widening your price range or clearing a filter.</p>
              <button onClick={clearAll} className="btn btn-ghost">
                Clear all filters
              </button>
            </div>
          ) : (
            <div className="store-product-grid">
              {visible.map((product) => (
                <ProductCard key={product.id} product={product} price={fromPrice(product)} edition={editionAvailability(editions, product.id)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** How it works, compatibility, ordering, delivery, returns, privacy and support: the published pages, linked. */
function StoreInformation() {
  const items: Array<[title: string, body: string, to: string, link: string]> = [
    ['How it works', 'Choose a card and a digital experience, set up your profile, and tap or scan.', `${AAROH_PRODUCT_PATH}#how-it-works`, 'How AAROH works'],
    [
      'Compatibility',
      'iPhone XS or newer and most NFC-enabled Android phones open a card without an app, and any camera phone can scan a QR code. Tested phone compatibility is published before card sales open.',
      `${AAROH_PRODUCT_PATH}#faq`,
      'Questions and answers',
    ],
    ['Ordering and delivery', 'Where we deliver, how delivery estimates work, and tracking.', LEGAL_PAGES.shipping.path, LEGAL_PAGES.shipping.name],
    ['Returns and replacements', 'Cancelling an order, a card that arrives damaged, and refunds.', LEGAL_PAGES.refunds.path, LEGAL_PAGES.refunds.name],
    ['Privacy', 'What we collect, why, and your rights. Visitors to your profile see only what you publish.', LEGAL_PAGES.privacy.path, LEGAL_PAGES.privacy.name],
    ['Support', 'Open a ticket from your account, message us on WhatsApp, or email us.', '/shygontap/support', 'Support'],
  ];
  return (
    <section id="store-info" className="aaroh-section" aria-labelledby="store-info-title">
      <header className="aaroh-section-head">
        <p className="aaroh-kicker">Before you buy</p>
        <h2 id="store-info-title">How buying from SHYGON works.</h2>
      </header>
      <ul className="store-info">
        {items.map(([title, body, to, link]) => (
          <li key={title}>
            <h3>{title}</h3>
            <p>{body}</p>
            <Link to={to} className="aaroh-link">
              {link} <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** `price` is resolved by the grid so every card shares one catalog read. */
function ProductCard({ product, price, edition }: { product: Product; price: number; edition?: string | null }) {
  return (
    <Link to={`/shygontap/store/${product.id}`} className="store-product-card flex flex-col">
      <div className="store-product-media">
        <img src={product.images.pvc} alt={`${product.name} NFC card in PVC`} loading="lazy" />
      </div>

      <div className="store-product-info flex-1">
        <p className="text-xs font-bold tracking-[0.16em] uppercase text-[var(--ds-accent)]">{product.eyebrow}</p>
        <h3>{product.name}</h3>
        <p className="edition-note mt-2">Limited · {edition ?? 'chapters of 100'}</p>
        <p className="text-sm text-[var(--ds-text-secondary)] mt-2">{product.shortDescription}</p>

        <ul className="mt-3 space-y-1">
          {product.features.slice(0, 2).map((feature) => (
            <li key={feature} className="text-xs text-[var(--ds-text-tertiary)] flex gap-1.5">
              <span className="text-[var(--ds-accent)]" aria-hidden="true">•</span>
              {feature}
            </li>
          ))}
        </ul>

        <div className="store-card-footer">
          <div>
            <p className="text-xs text-[var(--ds-text-tertiary)] mb-1.5">From</p>
            <p className="store-price text-2xl">₹{price}</p>
          </div>
          <span className="text-sm font-bold text-[var(--ds-accent)] inline-flex items-center gap-1">
            View <ChevronRight size={15} />
          </span>
        </div>
      </div>
    </Link>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="store-filter-section p-5">
      <h4 className="font-bold text-sm mb-3">{title}</h4>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex items-center gap-2.5 min-h-6 text-sm cursor-pointer">
      <input type="checkbox" checked={checked} onChange={onChange} className="w-4 h-4" />
      {label}
    </label>
  );
}

function Radio({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex items-center gap-2.5 min-h-6 text-sm cursor-pointer">
      <input type="radio" checked={checked} onChange={onChange} className="w-4 h-4" />
      {label}
    </label>
  );
}
