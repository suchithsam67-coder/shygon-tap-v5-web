import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Check, ChevronRight, ShieldCheck, ShoppingCart, Truck, Zap } from 'lucide-react';
import {
  digitalPlans,
  materialLabels,
  products,
  tierLabels,
  type MaterialId,
  type TierId,
} from '../../data/shygonTapData';
import { cardPriceIndex, fetchCatalog } from '../../services/catalog';
import { supabase } from '../../lib/supabase';

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

  const [material, setMaterial] = useState<MaterialId>('pvc');
  const [tier, setTier] = useState<TierId>('standard');
  const [planId, setPlanId] = useState(digitalPlans[0]?.id ?? 'essential');
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

  if (!product) return <Navigate to="/shygontap/store" replace />;

  const plan = digitalPlans.find((p) => p.id === planId) ?? digitalPlans[0];
  const livePhysical = livePrices?.cards.get(`${product.id}-${tier}-${material}`);
  const physicalPrice = livePhysical === undefined ? product.pricing[tier][material] : Math.round(livePhysical / 100);
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
    <div className="luxury-product min-h-screen bg-[#f7f8fa] text-[#111827]">
      <header className="bg-white border-b border-[#e5e7eb] sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-4 flex items-center justify-between">
          <button onClick={() => navigate('/shygontap')} className="font-black text-xl">
            SHYGON <span className="text-[#2563eb]">TAP</span>
          </button>
          <Link to="/shygontap/store" className="text-sm font-semibold hover:text-[#2563eb]">
            All cards
          </Link>
        </div>
      </header>

      <main className="luxury-product-main max-w-7xl mx-auto px-5 sm:px-8 py-8">
        <nav className="text-sm text-[#667085] mb-6" aria-label="Breadcrumb">
          <Link to="/shygontap" className="hover:text-[#2563eb]">
            Shygon Tap
          </Link>
          <ChevronRight size={14} className="inline mx-1 -mt-0.5" />
          <Link to="/shygontap/store" className="hover:text-[#2563eb]">
            Store
          </Link>
          <ChevronRight size={14} className="inline mx-1 -mt-0.5" />
          <span className="text-[#111827] font-semibold">{product.name}</span>
        </nav>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-8">
          {/* ------------------------------------------------ gallery + copy */}
          <div className="grid md:grid-cols-[92px_1fr] gap-4">
            <div className="flex md:flex-col gap-3 order-2 md:order-1">
              {MATERIALS.map((m) => (
                <button
                  key={m}
                  onClick={() => setMaterial(m)}
                  aria-label={`View ${materialLabels[m]}`}
                  aria-pressed={material === m}
                  className={`w-[84px] h-[68px] shrink-0 bg-white border rounded-md p-2 grid place-items-center transition ${
                    material === m ? 'border-[#2563eb] ring-2 ring-[#2563eb]/25' : 'border-[#e5e7eb]'
                  }`}
                >
                  <img
                    src={product.images[m]}
                    alt=""
                    className="max-w-full max-h-full object-contain"
                  />
                </button>
              ))}
            </div>

            <div className="order-1 md:order-2">
              <div className="bg-white border border-[#e5e7eb] rounded-md aspect-[4/3] grid place-items-center p-8">
                <img
                  src={product.images[material]}
                  alt={`${product.name} in ${materialLabels[material]}`}
                  className="max-w-full max-h-full object-contain"
                />
              </div>

              <div className="mt-8">
                <p className="text-[11px] font-bold tracking-[0.18em] uppercase text-[#2563eb]">
                  {product.eyebrow}
                </p>
                <h1 className="text-3xl sm:text-4xl font-black mt-2">{product.name}</h1>
                <p className="text-[#667085] text-lg mt-4 leading-relaxed">{product.description}</p>

                <h2 className="font-black mt-8 mb-3">What you get</h2>
                <ul className="space-y-2">
                  {product.features.map((feature) => (
                    <li key={feature} className="flex gap-2.5 text-[#374151]">
                      <Check size={18} className="text-[#2563eb] shrink-0 mt-0.5" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* --------------------------------------------------- buy column */}
          <aside className="lg:sticky lg:top-24 h-fit space-y-4">
            <div className="bg-white border border-[#e5e7eb] rounded-md p-6">
              <p className="text-3xl font-black">₹{total}</p>
              <p className="text-sm text-[#667085] mt-1">
                ₹{physicalPrice} card
                {digitalPrice > 0 ? ` + ₹${digitalPrice} digital experience` : ' · Essential digital experience included'}
              </p>

              <Field label="Material">
                {MATERIALS.map((m) => (
                  <Option
                    key={m}
                    selected={material === m}
                    onClick={() => setMaterial(m)}
                    label={materialLabels[m]}
                    detail={`₹${product.pricing[tier][m]}`}
                  />
                ))}
              </Field>

              <Field label="Finish">
                {TIERS.map((t) => (
                  <Option
                    key={t}
                    selected={tier === t}
                    onClick={() => setTier(t)}
                    label={tierLabels[t]}
                    detail={`₹${product.pricing[t][material]}`}
                  />
                ))}
              </Field>

              <Field label="Digital experience">
                {digitalPlans.map((p) => (
                  <Option
                    key={p.id}
                    selected={planId === p.id}
                    onClick={() => setPlanId(p.id)}
                    label={p.name}
                    detail={p.price === 0 ? 'Included' : `+₹${p.price}`}
                  />
                ))}
              </Field>

              <div className="mt-6 space-y-2.5">
                <button
                  onClick={addToCart}
                  className="w-full inline-flex items-center justify-center gap-2 border border-[#d1d5db] bg-white py-3 font-bold rounded-md hover:bg-[#f8fafc]"
                >
                  <ShoppingCart size={17} /> {added ? 'Saved to cart' : 'Add to Cart'}
                </button>
                <button
                  onClick={buyNow}
                  className="w-full inline-flex items-center justify-center gap-2 bg-[#2563eb] text-white py-3 font-bold rounded-md hover:bg-[#1d4ed8]"
                >
                  <Zap size={16} /> Buy Now
                </button>
              </div>

              {added && (
                <p className="text-sm text-[#166534] bg-[#f0fdf4] border border-[#bbf7d0] rounded-md px-3 py-2 mt-3">
                  Saved. Continue when you're ready —{' '}
                  <Link to="/shygontap/auth" className="font-bold underline">
                    go to checkout
                  </Link>
                  .
                </p>
              )}
            </div>

            <div className="bg-white border border-[#e5e7eb] rounded-md p-5 space-y-3 text-sm text-[#667085]">
              <p className="flex gap-2.5">
                <Truck size={17} className="text-[#2563eb] shrink-0 mt-0.5" />
                Delivered across India. Shipping details are collected at checkout.
              </p>
              <p className="flex gap-2.5">
                <ShieldCheck size={17} className="text-[#2563eb] shrink-0 mt-0.5" />
                Payments are processed by Razorpay and verified on our server before your order is
                confirmed.
              </p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <p className="text-xs font-bold tracking-[0.14em] uppercase text-[#667085] mb-2">{label}</p>
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
      className={`text-left border rounded-md px-3 py-2.5 transition ${
        selected
          ? 'border-[#2563eb] bg-[#eff6ff] ring-1 ring-[#2563eb]/30'
          : 'border-[#e5e7eb] bg-white hover:border-[#c7d2fe]'
      }`}
    >
      <span className="block text-sm font-bold leading-tight">{label}</span>
      <span className="block text-xs text-[#667085] mt-0.5">{detail}</span>
    </button>
  );
}
