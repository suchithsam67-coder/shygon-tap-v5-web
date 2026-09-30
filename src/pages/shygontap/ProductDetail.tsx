import { useEffect, useMemo, useState } from 'react';
import BrandMark from '../../components/brand/BrandMark';
import ThemeToggle from '../../components/ThemeToggle';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Check, ChevronRight, ShieldCheck, ShoppingCart, Truck, Zap } from 'lucide-react';
import {
  cardArt,
  cardDesignNames,
  digitalPlans,
  materialLabels,
  products,
  tierLabels,
  type MaterialId,
  type TierId,
} from '../../data/shygonTapData';
import { cardPriceIndex, fetchCatalog } from '../../services/catalog';
import { supabase } from '../../lib/supabase';
import { SITE_URL } from '../../lib/site';
import { productMeta, productPath } from '../../seo/meta';
import { usePageMeta } from '../../seo/usePageMeta';
import StoreFooter from '../../components/StoreFooter';
import { editionAvailability, useEditions } from '../../lib/editions';
import NotFound from '../NotFound';

/**
 * Amazon-style product detail page.
 *
 * Writes the same `shygon_pending_order` shape the configurator on the home
 * page uses, so the existing auth -> account -> checkout flow picks it up
 * unchanged. The totals here are for display; /api/create-order recomputes the
 * charge from the products table and ignores whatever the browser sends.
 */

const MATERIALS: MaterialId[] = ['pvc', 'metal', 'transparent'];
const TIERS: TierId[] = ['standard', 'premium'];

export default function ProductDetail() {
  const { productId } = useParams();
  // Keying on the id remounts the configurator when the customer moves between
  // products, so no stale material/finish selection carries over.
  return <ProductDetailView key={productId ?? ''} productId={productId} />;
}

function ProductDetailView({ productId }: { productId?: string }) {
  const navigate = useNavigate();

  const product = useMemo(() => products.find((p) => p.id === productId), [productId]);
  usePageMeta(useMemo(() => (product ? productMeta(SITE_URL, product) : null), [product]));

  const [material, setMaterial] = useState<MaterialId>('pvc');
  const [tier, setTier] = useState<TierId>('standard');
  const [planId, setPlanId] = useState(digitalPlans[0]?.id ?? 'essential');
  const [face, setFace] = useState<'front' | 'back'>('front');
  const editions = useEditions();
  const [added, setAdded] = useState(false);

  // Display prices come from the catalog, with the static copy as a fallback.
  // The server prices the order again at checkout regardless.
  const [livePrices, setLivePrices] = useState<{ cards: Map<string, number>; experiences: Map<string, number> } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchCatalog()
      .then((catalog) => {
        if (cancelled) return;
        setLivePrices({
          cards: cardPriceIndex(catalog),
          experiences: new Map(catalog.experiences.map((item) => [item.id, item.priceInPaise])),
        });
      })
      .catch(() => { /* the page still renders from its own copy */ });
    return () => { cancelled = true; };
  }, []);

  // A mistyped or retired card id is a missing page, not the catalog.
  if (!product) return <NotFound />;

  const plan = digitalPlans.find((p) => p.id === planId) ?? digitalPlans[0];
  /** One card price for a material and finish together (live, else the static copy). */
  const cardPrice = (t: TierId, m: MaterialId) => {
    const live = livePrices?.cards.get(`${product.id}-${t}-${m}`);
    return live === undefined ? product.pricing[t][m] : Math.round(live / 100);
  };
  const physicalPrice = cardPrice(tier, material);
  const liveDigital = plan ? livePrices?.experiences.get(plan.id) : undefined;
  const digitalPrice = liveDigital === undefined ? (plan?.price ?? 0) : Math.round(liveDigital / 100);
  const total = physicalPrice + digitalPrice;

  const save = () => {
    const pendingOrder = {
      orderType: 'physical',
      productId: product.id,
      material,
      tier,
      planId,
      physicalPrice,
      digitalPrice,
      total,
    };
    localStorage.setItem('shygon_pending_order', JSON.stringify(pendingOrder));
    localStorage.setItem(
      'shygon_builder_selection',
      JSON.stringify({ productId: product.id, material, tier, planId }),
    );
    window.dispatchEvent(new Event('shygon-cart-updated'));
  };

  const addToCart = () => {
    save();
    setAdded(true);
  };

  const choose = (apply: () => void) => {
    apply();
    setAdded(false);
  };

  const buyNow = () => {
    save();
    void goToCheckout();
  };

  // A signed-in customer skips the sign-in detour.
  async function goToCheckout() {
    try {
      const { data } = await supabase.auth.getSession();
      navigate(data.session ? '/shygontap/checkout' : '/shygontap/auth');
    } catch {
      navigate('/shygontap/auth');
    }
  }

  return (
    <div className="product-page">
      <header className="product-header">
        <div className="product-header-inner py-4 flex items-center justify-between">
          <Link to="/shygontap" className="store-brand text-xl">
            <BrandMark className="store-brand-mark" />
            SHYGON <span>TAP</span>
          </Link>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link to="/shygontap/store" className="text-sm font-semibold hover:text-[var(--ds-accent)]">
              All cards
            </Link>
          </div>
        </div>
      </header>

      <main className="product-main">
        <nav className="text-sm text-[var(--ds-text-tertiary)] mb-6" aria-label="Breadcrumb">
          <Link to="/shygontap" className="hover:text-[var(--ds-text)]">
            Shygon Tap
          </Link>
          <ChevronRight size={14} className="inline mx-1 -mt-0.5" />
          <Link to="/shygontap/store" className="hover:text-[var(--ds-text)]">
            Store
          </Link>
          <ChevronRight size={14} className="inline mx-1 -mt-0.5" />
          <span className="text-[var(--ds-text)] font-semibold" aria-current="page">{product.name}</span>
        </nav>

        <div className="product-detail-layout">
          {/* ------------------------------------------------ gallery + copy */}
          <div className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[92px_minmax(0,1fr)] gap-4">
            <div className="flex md:flex-col gap-3 order-2 md:order-1">
              {MATERIALS.map((m) => (
                <button
                  key={m}
                  onClick={() => choose(() => { setMaterial(m); setFace('front'); })}
                  aria-label={`View ${materialLabels[m]}`}
                  aria-pressed={material === m && face === 'front'}
                  className="product-thumb w-[84px] h-[68px] shrink-0 p-2 grid place-items-center"
                >
                  <img
                    src={cardArt(product, m, tier)}
                    alt=""
                    className="max-w-full max-h-full object-contain"
                  />
                </button>
              ))}
              <button
                onClick={() => setFace(face === 'back' ? 'front' : 'back')}
                aria-label={face === 'back' ? 'View the front' : 'View the back'}
                aria-pressed={face === 'back'}
                className="product-thumb product-thumb-back w-[84px] h-[68px] shrink-0 p-2 grid place-items-center"
              >
                <img src={cardArt(product, material, tier, 'back')} alt="" className="max-w-full max-h-full object-contain" />
                <span>Back</span>
              </button>
            </div>

            <div className="order-1 md:order-2">
              <div className="product-gallery-stage">
                <button
                  type="button"
                  className="card-flip"
                  onClick={() => setFace(face === 'back' ? 'front' : 'back')}
                  aria-label={`Show the ${face === 'back' ? 'front' : 'back'} of the card`}
                >
                  <img
                    key={`${material}-${tier}-${face}`}
                    className="card-art-swap"
                    src={cardArt(product, material, tier, face)}
                    alt={`${product.name} in ${materialLabels[material]}, ${tierLabels[tier]} finish, ${face}`}
                  />
                </button>
                <p className="product-gallery-caption">
                  <strong>{cardDesignNames[product.id]}</strong> · {materialLabels[material]} · {tierLabels[tier]} · {face === 'back' ? 'Back' : 'Front'}
                  <span> — click the card to turn it over</span>
                </p>
              </div>

              <div className="product-copy mt-8">
                <p className="text-xs font-bold tracking-[0.18em] uppercase text-[var(--ds-accent)]">
                  {product.eyebrow}
                </p>
                <h1 className="mt-3">{product.name}</h1>
                <p className="edition-note mt-4">
                  Limited edition · {editionAvailability(editions, product.id) ?? 'numbered in chapters of 100'}
                </p>
                <p className="text-[var(--ds-text-secondary)] text-lg mt-5 leading-relaxed">{product.description}</p>

                <h2 className="font-black mt-8 mb-3">What you get</h2>
                <ul className="space-y-2">
                  {product.features.map((feature) => (
                    <li key={feature} className="flex gap-2.5 text-[var(--ds-text-secondary)]">
                      <Check size={18} className="text-[var(--ds-accent)] shrink-0 mt-0.5" aria-hidden="true" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* --------------------------------------------------- buy column */}
          <aside className="product-configurator">
            <div>
              <p className="product-price text-4xl">₹{total}</p>
              <p className="text-sm text-[var(--ds-text-tertiary)] mt-2">
                ₹{physicalPrice} card
                {digitalPrice > 0 ? ` + ₹${digitalPrice} digital experience` : ' · Essential digital experience included'}
              </p>

              <Field label="Material">
                {MATERIALS.map((m) => (
                  <Option
                    key={m}
                    selected={material === m}
                    onClick={() => choose(() => setMaterial(m))}
                    label={materialLabels[m]}
                    detail={`₹${cardPrice(tier, m)}`}
                  />
                ))}
              </Field>

              <Field label="Finish">
                {TIERS.map((t) => (
                  <Option
                    key={t}
                    selected={tier === t}
                    onClick={() => choose(() => setTier(t))}
                    label={tierLabels[t]}
                    detail={
                      t === tier || cardPrice(t, material) === physicalPrice
                        ? `₹${cardPrice(t, material)}`
                        : `₹${cardPrice(t, material)} · ${cardPrice(t, material) > physicalPrice ? '+' : '−'}₹${Math.abs(cardPrice(t, material) - physicalPrice)}`
                    }
                  />
                ))}
              </Field>
              <p className="price-explainer text-sm">
                Material and finish set one card price together — they are not added up.
              </p>

              <Field label="Digital experience">
                {digitalPlans.map((p) => (
                  <Option
                    key={p.id}
                    selected={planId === p.id}
                    onClick={() =>
                      choose(() =>
                        // Choosing a selected paid experience again removes it.
                        setPlanId(planId === p.id && p.id !== 'essential' ? 'essential' : p.id),
                      )
                    }
                    label={p.name}
                    detail={p.price === 0 ? 'Included' : planId === p.id ? `+₹${p.price} · tap to remove` : `+₹${p.price}`}
                  />
                ))}
              </Field>

              <div className="product-actions">
                <button
                  onClick={addToCart}
                  className="btn btn-ghost btn-block"
                >
                  <ShoppingCart size={17} /> {added ? 'Saved to cart' : 'Add to Cart'}
                </button>
                <button
                  onClick={buyNow}
                  className="btn btn-blue btn-block"
                >
                  <Zap size={16} /> Buy Now
                </button>
              </div>

              {added && (
                <p role="status" className="product-saved text-sm px-3 py-2.5 mt-3">
                  Saved. Continue when you're ready —{' '}
                  <button type="button" onClick={() => void goToCheckout()} className="font-bold underline">
                    go to checkout
                  </button>
                  .
                </p>
              )}
            </div>

            <div className="product-trust mt-5 text-sm">
              <p className="flex gap-2.5">
                <Truck size={17} className="text-[var(--ds-accent)] shrink-0 mt-0.5" aria-hidden="true" />
                Delivered across India. Shipping details are collected at checkout.
              </p>
              <p className="flex gap-2.5">
                <ShieldCheck size={17} className="text-[var(--ds-accent)] shrink-0 mt-0.5" aria-hidden="true" />
                Payments are processed by Razorpay and verified on our server before your order is
                confirmed.
              </p>
            </div>
          </aside>
        </div>

        <section className="product-related" aria-labelledby="product-related-title">
          <h2 id="product-related-title">More cards</h2>
          <ul>
            {products
              .filter((other) => other.id !== product.id)
              .map((other) => (
                <li key={other.id}>
                  <Link to={productPath(other)}>
                    <img src={cardArt(other, 'pvc')} alt="" loading="lazy" />
                    <span>
                      <strong>{other.name}</strong>
                      <small>{other.shortDescription}</small>
                    </span>
                    <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      </main>

      <StoreFooter />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <p className="text-xs font-bold tracking-[0.14em] uppercase text-[var(--ds-text-tertiary)] mb-2">{label}</p>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </div>
  );
}

function Option({
  selected,
  onClick,
  label,
  detail,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  detail: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className="product-option flex items-start justify-between gap-2"
    >
      <span className="min-w-0">
        <span className="block text-sm font-bold leading-tight">{label}</span>
        <span className="block text-xs text-[var(--ds-text-secondary)] mt-1">{detail}</span>
      </span>
      {selected && <Check size={15} className="shrink-0 mt-0.5" aria-hidden="true" />}
    </button>
  );
}
