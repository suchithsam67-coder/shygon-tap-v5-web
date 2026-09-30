import { useEffect, useMemo, useState } from 'react';
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
  const [searchParams] = useSearchParams();

  const { priceFor, fromPrice } = useCardPrices();
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
    <div className="luxury-store min-h-screen bg-[#f7f8fa] text-[#111827]">
      {/* ---------------------------------------------------------------- nav */}
      <header className="bg-white border-b border-[#e5e7eb] sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-4 flex items-center gap-4">
          <button onClick={() => navigate('/shygontap')} className="font-black text-xl shrink-0">
            SHYGON <span className="text-[#2563eb]">TAP</span>
          </button>

          <form
            onSubmit={(e) => e.preventDefault()}
            className="flex-1 max-w-2xl relative"
            role="search"
          >
            <Search
              size={17}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ds-text-tertiary)] pointer-events-none"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Shygon Tap cards"
              aria-label="Search products"
              className="w-full border border-[#d1d5db] rounded-md pl-9 pr-3 py-2.5 text-sm outline-none"
            />
          </form>

          <button
            onClick={() => navigate('/shygontap/checkout')}
            className="hidden sm:inline-flex items-center gap-2 text-sm font-semibold shrink-0"
          >
            <ShoppingCart size={18} /> Cart
          </button>
        </div>
      </header>

      <main className="luxury-store-main max-w-7xl mx-auto px-5 sm:px-8 py-8">
        <nav className="text-sm text-[#667085] mb-5" aria-label="Breadcrumb">
          <Link to="/shygontap" className="hover:text-[#2563eb]">
            Shygon Tap
          </Link>
          <ChevronRight size={14} className="inline mx-1 -mt-0.5" />
          <span className="text-[var(--ds-text)] font-semibold">Store</span>
        </nav>

        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl sm:text-4xl font-black">All Shygon Tap cards</h1>
            <p className="text-[#667085] mt-2">
              {visible.length} {visible.length === 1 ? 'result' : 'results'}
              {activeFilterCount > 0 ? ` · ${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''} applied` : ''}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setFiltersOpen((v) => !v)}
              className="lg:hidden inline-flex items-center gap-2 border border-[#d1d5db] bg-white px-4 py-2.5 text-sm font-bold rounded-md"
              aria-expanded={filtersOpen}
            >
              <SlidersHorizontal size={16} /> Filters
            </button>

            <label className="text-sm text-[#667085]">
              <span className="sr-only">Sort by</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="border border-[#d1d5db] bg-white px-3 py-2.5 text-sm font-semibold rounded-md outline-none"
              >
                <option value="featured">Sort: Featured</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="price-desc">Price: High to Low</option>
                <option value="name">Name: A to Z</option>
              </select>
            </label>
          </div>
        </div>

        <div className="grid lg:grid-cols-[250px_1fr] gap-6">
          {/* ------------------------------------------------------- filters */}
          <aside
            className={`${filtersOpen ? 'block' : 'hidden'} lg:block bg-white border border-[#e5e7eb] rounded-md h-fit`}
          >
            <div className="p-5 border-b border-[#e5e7eb] flex items-center justify-between">
              <h2 className="font-black">Filters</h2>
              {activeFilterCount > 0 && (
                <button onClick={clearAll} className="text-xs font-bold text-[#2563eb]">
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
                className="w-full accent-[#2563eb]"
                aria-label="Maximum price"
              />
              <p className="text-sm text-[#667085] mt-1">
                Up to <span className="font-bold text-[var(--ds-text)]">₹{maxPrice}</span>
              </p>
            </FilterGroup>
          </aside>

          {/* ---------------------------------------------------------- grid */}
          <section>
            {visible.length === 0 ? (
              <div className="bg-white border border-[#e5e7eb] rounded-md p-12 text-center">
                <h2 className="text-xl font-black">No cards match those filters</h2>
                <p className="text-[#667085] mt-2">
                  Try widening your price range or clearing a filter.
                </p>
                <button
                  onClick={clearAll}
                  className="mt-5 border border-[#d1d5db] px-5 py-2.5 font-bold rounded-md"
                >
                  Clear all filters
                </button>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
                {visible.map((product) => (
                  <ProductCard key={product.id} product={product} price={fromPrice(product)} />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

/** `price` is resolved by the grid so every card shares one catalog read. */
function ProductCard({ product, price }: { product: Product; price: number }) {
  return (
    <Link
      to={`/shygontap/store/${product.id}`}
      className="group bg-white border border-[#e5e7eb] rounded-md overflow-hidden flex flex-col hover:shadow-lg hover:border-[#c7d2fe] transition"
    >
      <div className="aspect-[4/3] bg-[#f1f5f9] grid place-items-center p-6 overflow-hidden">
        <img
          src={product.images.pvc}
          alt={product.name}
          loading="lazy"
          className="max-w-full max-h-full object-contain group-hover:scale-[1.04] transition-transform duration-300"
        />
      </div>

      <div className="p-5 flex flex-col flex-1">
        <p className="text-xs font-bold tracking-[0.16em] uppercase text-[#2563eb]">
          {product.eyebrow}
        </p>
        <h3 className="font-black text-lg mt-1.5 leading-snug">{product.name}</h3>
        <p className="text-sm text-[#667085] mt-2 flex-1">{product.shortDescription}</p>

        <ul className="mt-3 space-y-1">
          {product.features.slice(0, 2).map((feature) => (
            <li key={feature} className="text-xs text-[#667085] flex gap-1.5">
              <span className="text-[#2563eb]">•</span>
              {feature}
            </li>
          ))}
        </ul>

        <div className="mt-4 pt-4 border-t border-white/10 flex items-end justify-between">
          <div>
            <p className="text-xs text-[#667085]">From</p>
            <p className="text-2xl font-black leading-none">₹{price}</p>
          </div>
          <span className="text-sm font-bold text-[#2563eb] inline-flex items-center gap-1">
            View <ChevronRight size={15} />
          </span>
        </div>
      </div>
    </Link>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-5 border-b border-[#e5e7eb] last:border-b-0">
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
    <label className="flex items-center gap-2.5 text-sm cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="w-4 h-4 accent-[#2563eb]"
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
    <label className="flex items-center gap-2.5 text-sm cursor-pointer">
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        className="w-4 h-4 accent-[#2563eb]"
      />
      {label}
    </label>
  );
}
