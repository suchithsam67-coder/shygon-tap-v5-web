import { useEffect, useMemo, useState } from 'react';
import BrandMark from '../../components/brand/BrandMark';
import ThemeToggle from '../../components/ThemeToggle';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal, ShoppingCart, ChevronRight } from 'lucide-react';
import {
  products,
  materialLabels,
  tierLabels,
  type MaterialId,
  type Product,
  type TierId,
} from '../../data/shygonTapData';
import { cardPriceIndex, fetchCatalog } from '../../services/catalog';
import { SITE_URL } from '../../lib/site';
import { storeMeta } from '../../seo/meta';
import { usePageMeta } from '../../seo/usePageMeta';
import { editionAvailability, useEditions } from '../../lib/editions';
import StoreFooter from '../../components/StoreFooter';

const META = storeMeta(SITE_URL);

/**
 * Amazon-style catalog grid.
 *
 * Prices shown here are for display and come from the same catalog the rest of
 * the site uses. They are never what the customer is charged: /api/create-order
 * re-reads the price from the products table server-side and ignores anything
 * the browser sends.
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

/**
 * Display prices, live from the catalog where available.
 *
 * The static prices in `shygonTapData` are the fallback for when the catalog
 * cannot be reached. Neither decides a charge: /api/create-order re-reads the
 * price from the products table server-side and ignores what the browser sends.
 */
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

export default function Store() {
  const navigate = useNavigate();
  usePageMeta(META);
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
      const haystack = [product.name, product.eyebrow, product.description, ...product.features]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });

    const sorted = [...matched];
    if (sort === 'price-asc') sorted.sort((a, b) => fromPrice(a) - fromPrice(b));
    else if (sort === 'price-desc') sorted.sort((a, b) => fromPrice(b) - fromPrice(a));
    else if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));

    return sorted;
    // priceFor/fromPrice change once, when the live catalog arrives; without
    // them here the budget filter and price sort would keep using the static
    // fallback prices for the rest of the session.
  }, [query, categories, materials, tier, maxPrice, sort, priceFor, fromPrice]);

  const activeFilterCount =
    categories.length + materials.length + (tier === 'any' ? 0 : 1) + (maxPrice < 1000 ? 1 : 0);

  const clearAll = () => {
    setCategories([]);
    setMaterials([]);
    setTier('any');
    setMaxPrice(1000);
    setQuery('');
  };

  return (
    <div className="store-page">
      {/* ---------------------------------------------------------------- nav */}
      <header className="store-header">
        <div className="store-header-inner py-4 flex items-center gap-4">
          <Link to="/shygontap" className="store-brand text-xl shrink-0">
            <BrandMark className="store-brand-mark" />
            SHYGON <span>TAP</span>
          </Link>

          <form
            onSubmit={(e) => e.preventDefault()}
            className="store-search flex-1 max-w-2xl relative"
            role="search"
          >
            <Search
              size={17}
              className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Shygon Tap cards"
              aria-label="Search products"
              className="w-full pl-9 pr-3 py-2.5 text-sm outline-none"
            />
          </form>

          <ThemeToggle />
          <button
            onClick={() => navigate('/shygontap/checkout')}
            className="hidden sm:inline-flex items-center gap-2 text-sm font-semibold shrink-0 hover:text-[var(--ds-accent)]"
          >
            <ShoppingCart size={18} /> Cart
          </button>
        </div>
      </header>

      <main className="store-main">
        <nav className="text-sm text-[var(--ds-text-tertiary)] mb-5" aria-label="Breadcrumb">
          <Link to="/shygontap" className="hover:text-[var(--ds-text)]">
            Shygon Tap
          </Link>
          <ChevronRight size={14} className="inline mx-1 -mt-0.5" />
          <span className="text-[var(--ds-text)] font-semibold" aria-current="page">Store</span>
        </nav>

        <div className="store-toolbar">
          <div>
            <h1>All Shygon Tap cards</h1>
            <p className="text-[var(--ds-text-tertiary)] mt-3">
              {visible.length} {visible.length === 1 ? 'result' : 'results'}
              {activeFilterCount > 0 ? ` · ${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''} applied` : ''}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setFiltersOpen((v) => !v)}
              className="store-filter-toggle btn btn-ghost"
              aria-expanded={filtersOpen}
            >
              <SlidersHorizontal size={16} /> Filters
            </button>

            <label className="store-sort text-sm">
              <span className="sr-only">Sort by</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="min-h-[46px] px-4 text-sm font-semibold outline-none"
              >
                <option value="featured">Sort: Featured</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="price-desc">Price: High to Low</option>
                <option value="name">Name: A to Z</option>
              </select>
            </label>
          </div>
        </div>

        <div className="store-layout">
          {/* ------------------------------------------------------- filters */}
          <aside
            className={`${filtersOpen ? 'block' : 'hidden'} min-[981px]:block store-filter-panel`}
          >
            <div className="store-filter-section p-5 flex items-center justify-between">
              <h2 className="font-black">Filters</h2>
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
                <Checkbox
                  key={material}
                  label={materialLabels[material]}
                  checked={materials.includes(material)}
                  onChange={() => toggle(materials, material, setMaterials)}
                />
              ))}
            </FilterGroup>

            <FilterGroup title="Finish">
              <Radio label="Any finish" checked={tier === 'any'} onChange={() => setTier('any')} />
              {TIERS.map((t) => (
                <Radio
                  key={t}
                  label={tierLabels[t]}
                  checked={tier === t}
                  onChange={() => setTier(t)}
                />
              ))}
            </FilterGroup>

            <FilterGroup title="Max price">
              <input
                type="range"
                min={299}
                max={1000}
                step={100}
                value={maxPrice}
                onChange={(e) => setMaxPrice(Number(e.target.value))}
                className="w-full"
                aria-label="Maximum price"
              />
              <p className="text-sm text-[var(--ds-text-tertiary)] mt-1">
                Up to <span className="font-bold text-[var(--ds-text)]">₹{maxPrice}</span>
              </p>
            </FilterGroup>
          </aside>

          {/* ---------------------------------------------------------- grid */}
          <section>
            {visible.length === 0 ? (
              <div className="state">
                <h2 className="text-xl font-black">No cards match those filters</h2>
                <p>
                  Try widening your price range or clearing a filter.
                </p>
                <button
                  onClick={clearAll}
                  className="btn btn-ghost"
                >
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
          </section>
        </div>
      </main>

      <StoreFooter />
    </div>
  );
}

/** `price` is resolved by the grid so every card shares one catalog read. */
function ProductCard({ product, price, edition }: { product: Product; price: number; edition?: string | null }) {
  return (
    <Link
      to={`/shygontap/store/${product.id}`}
      className="store-product-card flex flex-col"
    >
      <div className="store-product-media">
        <img
          src={product.images.pvc}
          alt={`${product.name} NFC card in PVC`}
          loading="lazy"
        />
      </div>

      <div className="store-product-info flex-1">
        <p className="text-xs font-bold tracking-[0.16em] uppercase text-[var(--ds-accent)]">
          {product.eyebrow}
        </p>
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
      <h3 className="font-bold text-sm mb-3">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-center gap-2.5 min-h-6 text-sm cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="w-4 h-4"
      />
      {label}
    </label>
  );
}

function Radio({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-center gap-2.5 min-h-6 text-sm cursor-pointer">
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        className="w-4 h-4"
      />
      {label}
    </label>
  );
}
