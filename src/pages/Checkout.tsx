import { useEffect, useMemo, useState } from 'react';
import BrandMark from '../components/brand/BrandMark';
import ThemeToggle from '../components/ThemeToggle';
import { Link, useNavigate } from 'react-router-dom';
import { LEGAL_PAGES } from '../seo/meta';
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Lock,
  ShieldCheck,
  Truck,
  BadgeCheck,
  RefreshCw,
} from 'lucide-react';
import { supabase, describeError } from '../lib/supabase';
import { useAuth } from '../lib/auth-context';
import { useAccount } from '../lib/account-context';
import { useToast } from '../components/app/toast-context';
import { ErrorState, Skeleton } from '../components/app/States';
import {
  experiencePrice,
  fetchCatalog,
  findVariant,
  rupees,
  type Catalog,
} from '../services/catalog';
import { CheckoutError, startCheckout, type PurchaseIntent } from '../services/payments';
import PaymentProgress, { type PaymentStage } from '../components/app/PaymentProgress';
import EBill from '../components/app/EBill';
import { useAsync } from '../hooks/useAsync';
import { toExperience } from '../lib/database.types';

/**
 * Checkout.
 *
 * The cart in localStorage stores a SELECTION (which card, which finish, which
 * plan). It does not store a price the customer is charged: prices shown here
 * are read from the `products` table, and the server prices the order again
 * from the same table when it creates the Razorpay order. The old flow inserted
 * the order from the browser and then marked it paid — neither happens now.
 */

const PENDING_KEY = 'shygon_pending_order';

interface PendingOrder {
  orderType?: 'physical' | 'digitalUpgrade' | 'lifetimeCustomization' | 'customization';
  productId?: string;
  material?: string;
  tier?: string;
  planId?: string;
  quantity?: number;
  customizationSkus?: string[];
  productName?: string;
}

interface ShippingForm {
  name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
}

const EMPTY_SHIPPING: ShippingForm = {
  name: '',
  phone: '',
  address: '',
  city: '',
  state: '',
  pincode: '',
};

function readPending(): PendingOrder | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingOrder) : null;
  } catch {
    return null;
  }
}

export default function Checkout() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile, refresh } = useAccount();
  const toast = useToast();

  const [pending] = useState<PendingOrder | null>(readPending);
  const [shipping, setShipping] = useState<ShippingForm>(EMPTY_SHIPPING);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof ShippingForm, string>>>({});
  const [paying, setPaying] = useState(false);
  // Order consent: never pre-ticked; required before payment (Consumer
  // Protection (E-Commerce) Rules, 2020 — explicit, affirmative consent).
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  // Drives the card transaction animation; set only by real checkout events.
  const [stage, setStage] = useState<PaymentStage | null>(null);
  const [deliveryCheck, setDeliveryCheck] = useState<{ status: 'idle' | 'checking' | 'valid' | 'invalid' | 'error'; city?: string; state?: string; postOffice?: string; minDays?: number; maxDays?: number; etd?: string; courierCount?: number; message?: string }>({ status: 'idle' });
  const [checkoutResult, setCheckoutResult] = useState<{ orderId?: string; paymentId?: string }>({});
  /**
   * Razorpay reported success but our verification call did not complete. The
   * webhook fulfils the same order independently, so the honest thing to say is
   * "received, still processing" — never "failed", and never a fake success.
   */
  const [verificationPending, setVerificationPending] = useState(false);

  const orderType = pending?.orderType ?? 'physical';
  const isPhysical = orderType === 'physical';

  const {
    data: catalog,
    loading,
    error: loadError,
    reload: loadCatalog,
  } = useAsync<Catalog>(fetchCatalog, {
    enabled: Boolean(pending),
    onError: (err) => describeError(err, 'We could not load pricing.'),
  });

  useEffect(() => {
    if (!pending) navigate('/shygontap', { replace: true });
  }, [pending, navigate]);

  // Prefill the delivery form from the account record, once it arrives.
  // Adjusted during render rather than in an effect — an effect would paint an
  // empty form first and then fill it in under the customer's cursor.
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null);
  if (profile && prefilledFor !== profile.id) {
    setPrefilledFor(profile.id);
    setShipping((current) => ({
      ...current,
      name: current.name || profile.full_name || '',
      phone: current.phone || profile.phone || '',
    }));
  }

  const pincode = shipping.pincode.trim();
  // Indian PIN codes are six digits and never start with 0.
  const pincodeComplete = isPhysical && /^[1-9]\d{5}$/.test(pincode);

  /**
   * Derived rather than stored: "no PIN typed yet" is a fact about the field,
   * so writing it into state on the way into the effect was both redundant and
   * a synchronous update from an effect body.
   */
  const delivery = pincodeComplete ? deliveryCheck : ({ status: 'idle' } as const);

  useEffect(() => {
    if (!pincodeComplete) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setDeliveryCheck({ status: 'checking' });
      try {
        const response = await fetch('/api/check-delivery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pincode }),
        });
        const result = (await response.json().catch(() => ({}))) as {
          serviceable?: boolean;
          error?: string;
          verified?: boolean;
          postal?: { city?: string; state?: string; postOffice?: string; source?: string };
          delivery?: { estimatedDays?: number | null; etd?: string | null; courierCount?: number };
          fallbackDelivery?: { minBusinessDays: number; maxBusinessDays: number };
        };
        if (cancelled) return;
        if (!response.ok || result.serviceable === false) {
          setDeliveryCheck({ status: 'invalid', message: result.error ?? 'This PIN code could not be verified.' });
          return;
        }
        // The PIN is the source of truth for city and state: overwrite what was
        // there (an earlier PIN, the saved profile), but only with values the
        // directory actually returned. Both stay editable afterwards.
        setShipping((current) => ({
          ...current,
          city: result.postal?.city || current.city,
          state: result.postal?.state || current.state,
        }));
        setDeliveryCheck({
          status: 'valid',
          city: result.postal?.city,
          state: result.postal?.state,
          postOffice: result.postal?.postOffice,
          minDays: result.delivery?.estimatedDays ?? result.fallbackDelivery?.minBusinessDays,
          maxDays: result.delivery?.estimatedDays ?? result.fallbackDelivery?.maxBusinessDays,
          etd: result.delivery?.etd ?? undefined,
          courierCount: result.delivery?.courierCount,
          // Exactly one of `delivery` / `fallbackDelivery` is ever set by the
          // server, so the label can never claim a live ETA it does not have.
          message: result.delivery
            ? 'Live courier estimate'
            : result.verified === false
              ? 'PIN accepted — address directory unavailable'
              : 'Estimated delivery window',
        });
      } catch {
        if (!cancelled) {
          setDeliveryCheck({
            status: 'error',
            message:
              navigator.onLine === false
                ? "You're offline, so we couldn't check delivery. You can still continue with a valid PIN."
                : 'We could not check delivery right now. You can still continue with a valid PIN.',
          });
        }
      }
    }, 350);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [pincode, pincodeComplete]);

  /** Line items priced from the database, never from the cart. */
  const lines = useMemo(() => {
    if (!catalog || !pending) return [];
    const items: { label: string; detail?: string; paise: number }[] = [];

    if (orderType === 'physical') {
      const product = catalog.cards.find((c) => c.category === pending.productId);
      const variant = findVariant(product, pending.tier ?? 'standard', pending.material ?? 'pvc');
      const quantity = Math.max(1, Number(pending.quantity ?? 1));
      if (variant) {
        items.push({
          label: variant.name,
          detail: quantity > 1 ? `Quantity ${quantity}` : undefined,
          paise: variant.priceInPaise * quantity,
        });
      }
      if (pending.planId && pending.planId !== 'essential') {
        const experience = experiencePrice(catalog, toExperience(pending.planId));
        if (experience && experience.priceInPaise > 0) {
          items.push({
            label: experience.name,
            detail: 'Digital experience',
            paise: experience.priceInPaise,
          });
        }
      }
    } else if (orderType === 'digitalUpgrade') {
      const experience = experiencePrice(catalog, toExperience(pending.planId));
      if (experience) {
        items.push({
          label: experience.name,
          detail: 'Digital experience',
          paise: experience.priceInPaise,
        });
      }
    } else if (orderType === 'lifetimeCustomization') {
      if (catalog.pass) {
        items.push({
          label: catalog.pass.name,
          detail: 'One-time · unlimited edits + all palettes',
          paise: catalog.pass.priceInPaise,
        });
      }
    } else if (orderType === 'customization') {
      for (const sku of pending.customizationSkus ?? []) {
        const addon = catalog.customizations.find((c) => c.sku === sku);
        if (addon) items.push({ label: addon.name, detail: 'Add-on', paise: addon.priceInPaise });
      }
    }

    return items;
  }, [catalog, pending, orderType]);

  const total = lines.reduce((sum, line) => sum + line.paise, 0);

  function validate(): boolean {
    if (!isPhysical) return true;

    const next: Partial<Record<keyof ShippingForm, string>> = {};
    if (!shipping.name.trim()) next.name = 'Enter the recipient name.';
    if (shipping.phone.replace(/\D/g, '').length < 10) next.phone = 'Enter a valid 10-digit phone number.';
    if (!shipping.address.trim()) next.address = 'Enter a delivery address.';
    if (!shipping.city.trim()) next.city = 'Enter a city.';
    if (!shipping.state.trim()) next.state = 'Enter a state.';
    if (shipping.pincode.trim().startsWith('0')) next.pincode = 'Indian PIN codes do not start with 0.';
    else if (!/^[1-9]\d{5}$/.test(shipping.pincode.trim())) next.pincode = 'Enter a valid 6-digit PIN code.';
    else if (delivery.status === 'invalid') next.pincode = delivery.message ?? 'This PIN code could not be verified.';
    else if (delivery.status === 'checking') next.pincode = 'Still checking this PIN code — one moment.';

    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function pay() {
    setError('');
    if (!pending || !user) return;

    if (!validate()) {
      setError('Please correct the highlighted delivery details.');
      return;
    }

    if (total <= 0) {
      setError('This order has nothing payable in it. Please start again.');
      return;
    }

    if (!agreed) {
      setError('Please agree to the Terms and the Cancellation and Refund Policy to continue.');
      return;
    }

    setPaying(true);

    try {
      // Keep the account record current so future orders prefill correctly.
      // upsert rather than update: a profile row may not exist for accounts
      // created before the handle_new_user trigger.
      if (isPhysical) {
        const { error: profileError } = await supabase.from('profiles').upsert(
          {
            id: user.id,
            customer_id: user.id,
            email: user.email,
            full_name: shipping.name.trim(),
            phone: shipping.phone.trim(),
          },
          { onConflict: 'id' },
        );
        // Not fatal — the order carries its own shipping details.
        if (profileError) console.warn('Profile save failed', profileError.message);
      }

      const intent: PurchaseIntent =
        orderType === 'physical'
          ? {
              orderType: 'physical',
              productId: pending.productId!,
              material: pending.material!,
              tier: pending.tier!,
              planId: pending.planId,
              quantity: Math.max(1, Number(pending.quantity ?? 1)),
              shipping: {
                name: shipping.name.trim(),
                phone: shipping.phone.trim(),
                address: shipping.address.trim(),
                city: shipping.city.trim(),
                state: shipping.state.trim(),
                pincode: shipping.pincode.trim(),
              },
            }
          : orderType === 'digitalUpgrade'
            ? { orderType: 'digitalUpgrade', planId: pending.planId! }
            : orderType === 'lifetimeCustomization'
              ? { orderType: 'lifetimeCustomization' }
              : { orderType: 'customization', customizationSkus: pending.customizationSkus ?? [] };

      const result = await startCheckout(intent, {
        customerName: shipping.name.trim() || profile?.full_name || undefined,
        customerEmail: user.email ?? undefined,
        customerPhone: shipping.phone.trim() || profile?.phone || undefined,
        onStage: setStage,
      });

      // The server has verified the signature, marked the order paid and
      // written the entitlement rows. Re-read them rather than assuming.
      setCheckoutResult({ orderId: result.shygonOrderId, paymentId: result.razorpayPaymentId });
      localStorage.removeItem(PENDING_KEY);
      window.dispatchEvent(new Event('shygon-cart-updated'));
      await refresh();

      // The server has confirmed the payment: let the confirmation land on the
      // animation for a moment before the receipt screen replaces it.
      setStage('confirmed');
      await new Promise((resolve) => window.setTimeout(resolve, 1100));
      setStage(null);
      setDone(true);
      toast.success(
        'Payment confirmed',
        orderType === 'lifetimeCustomization'
          ? 'The Customization Pass is now active on your account.'
          : isPhysical
            ? 'Your order is on its way.'
            : 'Your digital experience is now active on your account.',
      );
    } catch (err) {
      if (err instanceof CheckoutError) {
        switch (err.kind) {
          case 'auth':
            setError(err.message);
            navigate('/shygontap/auth', { state: { from: '/shygontap/checkout' } });
            break;
          case 'cancelled':
            // Not an error. Nothing was charged and the selection is still here.
            setError('');
            toast.info('Payment cancelled', "You haven't been charged. Your selection is saved.");
            break;
          case 'failed':
            setError(`${err.message} You have not been charged — you can try again or use another method.`);
            break;
          case 'verification':
            // The money may well have left. Never claim it did not.
            setVerificationPending(true);
            setError('');
            break;
          case 'network':
            setError(
              navigator.onLine === false
                ? "You're offline. Your order has not been placed and you have not been charged."
                : err.message,
            );
            break;
          default:
            setError(err.message);
        }
      } else {
        setError(describeError(err, 'Something went wrong during checkout.'));
      }
    } finally {
      setPaying(false);
      setStage((current) => (current === 'confirmed' ? current : null));
    }
  }

  if (!pending) return null;

  if (verificationPending) {
    return (
      <div className="app">
        <main
          className="app-body page-enter"
          style={{ gridTemplateColumns: '1fr', placeItems: 'center', minHeight: '100svh' }}
        >
          <div className="panel" style={{ width: 'min(560px, 100%)' }}>
            <div className="state">
              <div className="state-icon state-icon-warn">
                <Truck size={26} />
              </div>
              <h3>Payment received — we're finishing up</h3>
              <p>
                Your payment went through, but we couldn't confirm it back to your browser in time.
                Nothing is lost: our server confirms every payment independently with Razorpay and
                will finish preparing your order.
              </p>
              <p style={{ marginTop: 10 }}>
                Check <strong>Orders</strong> in a minute or two. If it still looks unfinished after
                that, contact support and we will sort it out.
              </p>
              <div
                style={{
                  display: 'flex',
                  gap: 10,
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                  marginTop: 18,
                }}
              >
                <button className="btn btn-blue" onClick={() => navigate('/shygontap/orders')}>
                  View orders
                </button>
                <button className="btn btn-ghost" onClick={() => navigate('/shygontap/support')}>
                  Contact support
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (done) {
    return (
      <div className="app">
        <main className="app-body page-enter" style={{ gridTemplateColumns: '1fr', placeItems: 'center', minHeight: '100svh' }}>
          <div className="panel" style={{ width: 'min(680px, 100%)', overflow: 'hidden' }}>
            <div style={{ padding: '34px 28px 28px', textAlign: 'center', background: 'var(--ds-surface-raised)' }}>
              <div style={{ width: 64, height: 64, borderRadius: 22, margin: '0 auto 16px', display: 'grid', placeItems: 'center', background: 'var(--ds-surface)', color: 'var(--ds-color-state-success)', border: '1px solid var(--ds-color-state-success)' }}>
                <CheckCircle2 size={32} />
              </div>
              <p className="eyebrow" style={{ margin: 0, color: 'var(--ds-color-state-success)' }}>ORDER CONFIRMED</p>
              <h1 style={{ margin: '8px 0 8px', fontSize: 'clamp(28px,5vw,42px)', letterSpacing: '-.04em' }}>You're all set.</h1>
              <p style={{ maxWidth: 520, margin: '0 auto', color: 'var(--muted)', lineHeight: 1.65 }}>
                Your payment was verified by SHYGON's server. Your order and account entitlements have been updated.
              </p>
            </div>
            <div className="panel-body">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>
                <div style={{ border: '1px solid var(--line)', borderRadius: 16, padding: 14 }}>
                  <div className="mini-label">Order</div>
                  <strong style={{ display: 'block', marginTop: 5, overflowWrap: 'anywhere' }}>{checkoutResult.orderId ?? 'Confirmed'}</strong>
                </div>
                <div style={{ border: '1px solid var(--line)', borderRadius: 16, padding: 14 }}>
                  <div className="mini-label">Payment</div>
                  <strong style={{ display: 'block', marginTop: 5, overflowWrap: 'anywhere' }}>{checkoutResult.paymentId ?? 'Verified'}</strong>
                </div>
              </div>
              <div style={{ display: 'grid', gap: 10, marginTop: 18 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 14, borderRadius: 16, background: 'var(--ds-surface-raised)' }}><BadgeCheck size={19} color="var(--ds-accent)" /><span><strong>Payment verified</strong><br /><span style={{ color: 'var(--muted)', fontSize: 12 }}>No browser-side payment confirmation was trusted.</span></span></div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 14, borderRadius: 16, background: 'var(--ds-surface-raised)' }}><Truck size={19} color="var(--ds-accent)" /><span><strong>{isPhysical ? 'Delivery details saved' : 'Digital access updated'}</strong><br /><span style={{ color: 'var(--muted)', fontSize: 12 }}>{isPhysical ? `Shipping to ${shipping.pincode}` : 'Your account is ready for the next step.'}</span></span></div>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 22 }}>
                <button className="btn btn-blue" onClick={() => navigate('/shygontap/tap')}><BadgeCheck size={16} /> Build my Tap</button>
                <button className="btn btn-ghost" onClick={() => navigate('/shygontap/orders')}>View order</button>
              </div>
            </div>
          </div>
          <EBill orderId={checkoutResult.orderId} paymentId={checkoutResult.paymentId} email={user?.email ?? undefined} />
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      {stage && <PaymentProgress stage={stage} />}
      <header className="app-topbar">
        <div className="app-topbar-inner">
          <button className="brand" onClick={() => navigate('/shygontap')} aria-label="SHYGON Tap home">
            <span className="brand-mark brand-mark-logo" aria-hidden="true"><BrandMark /></span>
            <span className="brand-copy"><strong>SHYGON <em>TAP</em></strong></span>
          </button>
          <div className="app-topbar-actions">
            <ThemeToggle />
            <span className="pill pill-green">
              <Lock size={12} /> Secure checkout
            </span>
          </div>
        </div>
      </header>

      <div style={{ width: 'min(1320px, calc(100% - 40px))', margin: '0 auto', padding: '20px 0 0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, maxWidth: 720 }}>
          {['Delivery', 'Review', 'Secure payment'].map((step, index) => (
            <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{ width: 28, height: 28, flex: '0 0 auto', borderRadius: 999, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800, background: index === 0 ? 'var(--ds-action-bg)' : 'var(--ds-surface-raised)', color: index === 0 ? 'var(--ds-action-fg)' : 'var(--ds-text-tertiary)' }}>{index + 1}</span>
              <span style={{ fontSize: 12, fontWeight: 750, color: index === 0 ? 'var(--ink)' : 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{step}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="app-body checkout-body">
        <main className="app-main page-enter">
          <button
            className="btn btn-ghost btn-sm"
            style={{ justifySelf: 'start' }}
            onClick={() => navigate(-1)}
          >
            <ArrowLeft size={15} /> Back
          </button>

          <div className="app-page-head">
            <p className="eyebrow" style={{ margin: 0 }}>Checkout</p>
            <h1>{isPhysical ? 'Delivery details' : 'Confirm your upgrade'}</h1>
            <p>
              {isPhysical
                ? 'Tell us where to send your SHYGON Tap card. Payment is handled by Razorpay — we never see your card details.'
                : 'Review what you are buying, then pay securely through Razorpay.'}
            </p>
          </div>

          {isPhysical && (
            <section className="panel">
              <div className="panel-head">
                <Truck size={19} />
                <div>
                  <h2>Where should we send it?</h2>
                  <p>Cards ship across India.</p>
                </div>
              </div>
              <div className="panel-body">
                <Field
                  label="Full name"
                  value={shipping.name}
                  error={fieldErrors.name}
                  onChange={(v) => setShipping((s) => ({ ...s, name: v }))}
                  autoComplete="name"
                />
                <Field
                  label="Phone number"
                  value={shipping.phone}
                  error={fieldErrors.phone}
                  onChange={(v) => setShipping((s) => ({ ...s, phone: v }))}
                  autoComplete="tel"
                  inputMode="tel"
                  placeholder="9876543210"
                />
                <label className="field">
                  <span>Address</span>
                  <textarea
                    className="textarea"
                    rows={3}
                    value={shipping.address}
                    aria-invalid={Boolean(fieldErrors.address)}
                    onChange={(e) => setShipping((s) => ({ ...s, address: e.target.value }))}
                    placeholder="House number, street and area"
                    autoComplete="street-address"
                  />
                  {fieldErrors.address && <p className="field-error">{fieldErrors.address}</p>}
                </label>
                {/* PIN first: once verified it fills City and State below. */}
                <Field
                  label="PIN code"
                  value={shipping.pincode}
                  error={
                    fieldErrors.pincode ??
                    (shipping.pincode.startsWith('0') ? 'Indian PIN codes do not start with 0.' : undefined)
                  }
                  onChange={(v) => setShipping((s) => ({ ...s, pincode: v.replace(/\D/g, '').slice(0, 6) }))}
                  autoComplete="postal-code"
                  inputMode="numeric"
                  placeholder="560001"
                />
                {delivery.status !== 'idle' && (
                  <div style={{ marginTop: -4, marginBottom: 8, padding: '13px 14px', borderRadius: 16, border: `1px solid ${delivery.status === 'valid' ? 'var(--ds-color-state-success)' : delivery.status === 'checking' ? 'var(--ds-border)' : 'var(--ds-color-state-error)'}`, background: 'var(--ds-surface-raised)' }}>
                    {delivery.status === 'checking' ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5 }}><RefreshCw size={16} className="spin" /> Checking PIN code and delivery availability…</div>
                    ) : delivery.status === 'valid' ? (
                      <div style={{ display: 'grid', gap: 7 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ds-color-state-success)', fontWeight: 800 }}><BadgeCheck size={17} /> Delivery available to {delivery.city || shipping.city}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink)', fontSize: 12.5 }}><Truck size={16} /> Estimated delivery: <strong>{delivery.minDays === delivery.maxDays ? `${delivery.minDays} business days` : `${delivery.minDays}–${delivery.maxDays} business days`}</strong></div>
                        {delivery.postOffice && <div style={{ color: 'var(--muted)', fontSize: 12 }}>{delivery.postOffice}{delivery.state ? ` · ${delivery.state}` : ''}{delivery.courierCount ? ` · ${delivery.courierCount} courier option${delivery.courierCount === 1 ? '' : 's'} checked` : ''}</div>}
                        <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                          {delivery.courierCount
                            ? delivery.message
                            : 'Estimated window, not a live courier quote. We will confirm the delivery date when your order ships.'}
                        </div>
                      </div>
                    ) : (
                      <div style={{ color: 'var(--ds-color-state-error)', fontSize: 12.5 }}>{delivery.message}</div>
                    )}
                  </div>
                )}
                <div className="field-row">
                  <Field
                    label="City"
                    value={shipping.city}
                    error={fieldErrors.city}
                    onChange={(v) => setShipping((s) => ({ ...s, city: v }))}
                    autoComplete="address-level2"
                  />
                  <Field
                    label="State"
                    value={shipping.state}
                    error={fieldErrors.state}
                    onChange={(v) => setShipping((s) => ({ ...s, state: v }))}
                    autoComplete="address-level1"
                  />
                </div>
              </div>
            </section>
          )}
        </main>

        <aside className="checkout-summary">
          <section className="panel">
            <div className="panel-head">
              <div>
                <p className="mini-label">Order summary</p>
                <h2>Review your order</h2>
              </div>
            </div>
            <div className="panel-body">
              {loading ? (
                <>
                  <Skeleton height={16} width="70%" />
                  <div style={{ height: 12 }} />
                  <Skeleton height={16} width="50%" />
                  <div style={{ height: 20 }} />
                  <Skeleton height={40} />
                </>
              ) : loadError ? (
                <ErrorState message={loadError} onRetry={loadCatalog} />
              ) : lines.length === 0 ? (
                <ErrorState
                  title="We could not price this order"
                  message="The products in your cart are not available. Please choose again."
                  onRetry={() => navigate('/shygontap')}
                />
              ) : (
                <>
                  {lines.map((line) => (
                    <div
                      key={line.label}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 14,
                        padding: '10px 0',
                        borderBottom: '1px solid var(--line)',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 650, fontSize: 13.5 }}>{line.label}</div>
                        {line.detail && (
                          <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 3 }}>
                            {line.detail}
                          </div>
                        )}
                      </div>
                      <strong style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {rupees(line.paise)}
                      </strong>
                    </div>
                  ))}

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      marginTop: 18,
                    }}
                  >
                    <span style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 700, letterSpacing: '.1em' }}>
                      TOTAL
                    </span>
                    <strong
                      style={{
                        fontFamily: "'Syne', sans-serif",
                        fontSize: 30,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {rupees(total)}
                    </strong>
                  </div>

                  {error && (
                    <div
                      id="checkout-error"
                      role="alert"
                      style={{
                        marginTop: 16,
                        padding: '12px 14px',
                        borderRadius: 13,
                        background: 'var(--ds-surface-raised)',
                        border: '1px solid var(--ds-color-state-error)',
                        color: 'var(--ds-color-state-error)',
                        fontSize: 13,
                        lineHeight: 1.55,
                      }}
                    >
                      {error}
                    </div>
                  )}

                  <label
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 18, fontSize: 13, lineHeight: 1.55, color: 'var(--ds-text-secondary)', cursor: 'pointer' }}
                  >
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={(e) => {
                        setAgreed(e.target.checked);
                        if (e.target.checked) setError('');
                      }}
                      style={{ width: 18, height: 18, marginTop: 2, flex: '0 0 auto', accentColor: 'var(--ds-accent)', cursor: 'pointer' }}
                    />
                    <span>
                      I agree to the{' '}
                      <Link to={LEGAL_PAGES.terms.path} target="_blank" rel="noreferrer" style={{ color: 'var(--ds-text)', textDecoration: 'underline' }}>
                        Terms<span className="sr-only"> (opens in a new tab)</span>
                      </Link>{' '}
                      and the{' '}
                      <Link to={LEGAL_PAGES.refunds.path} target="_blank" rel="noreferrer" style={{ color: 'var(--ds-text)', textDecoration: 'underline' }}>
                        Cancellation and Refund Policy<span className="sr-only"> (opens in a new tab)</span>
                      </Link>
                      .
                    </span>
                  </label>
                  {isPhysical && (
                    <p style={{ margin: '10px 0 0', fontSize: 12, lineHeight: 1.55, color: 'var(--muted)' }}>
                      Your name, phone and address are used only to deliver this order and contact you about it.{' '}
                      <Link to={LEGAL_PAGES.privacy.path} target="_blank" rel="noreferrer" style={{ color: 'var(--ds-text)', textDecoration: 'underline' }}>
                        Privacy Policy<span className="sr-only"> (opens in a new tab)</span>
                      </Link>
                    </p>
                  )}

                  <button
                    type="button"
                    className="btn btn-blue btn-block"
                    style={{ marginTop: 18 }}
                    onClick={() => void pay()}
                    disabled={paying || total <= 0}
                    aria-describedby={error ? 'checkout-error' : undefined}
                  >
                    {paying ? (
                      <>
                        <Loader2 size={16} className="spin" /> Opening Razorpay…
                      </>
                    ) : (
                      <>
                        <Lock size={15} /> Pay {rupees(total)}
                      </>
                    )}
                  </button>

                  <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
                    <p style={{ display: 'flex', alignItems: 'center', gap: 7, margin: 0, color: 'var(--muted)', fontSize: 12 }}><ShieldCheck size={14} /> Secure Razorpay payment · server verification</p>
                    <p style={{ display: 'flex', alignItems: 'center', gap: 7, margin: 0, color: 'var(--muted)', fontSize: 12 }}><Truck size={14} /> {isPhysical ? 'Delivery estimate shown after PIN verification' : 'Digital purchase activates on your account'}</p>
                  </div>
                </>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  error,
  ...rest
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        className="input"
        value={value}
        aria-invalid={Boolean(error)}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
      {error && <p className="field-error">{error}</p>}
    </label>
  );
}
