import { useEffect, useMemo, useState } from 'react';
import { trackStoreEvent, useStoreEvent } from '../lib/funnel';
import { needsCardDetails, type CardProfileDetails } from '../lib/cardDetails';
import { CheckoutSteps } from './CardDetails';
import { BUTTON_LABELS } from '../lib/tierButtons';
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
  TicketPercent,
  Receipt,
  X,
  Sparkles,
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
import { checkPromoCode } from '../services/promo';
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
  /** Set by My cards when the order replaces a card (same design, same page). */
  replacesCardId?: string;
  replacesCardCode?: string | null;
  /** Filled on the Card details step (first cards only). */
  profile?: CardProfileDetails;
}

interface ShippingForm {
  name: string;
  phone: string;
  email: string;
  address: string;
  line2: string;
  locality: string;
  city: string;
  state: string;
  pincode: string;
}

const EMPTY_SHIPPING: ShippingForm = {
  name: '',
  phone: '',
  email: '',
  address: '',
  line2: '',
  locality: '',
  city: '',
  state: '',
  pincode: '',
};

interface BillingForm extends ShippingForm {
  company: string;
}

const EMPTY_BILLING: BillingForm = { ...EMPTY_SHIPPING, company: '' };

/** The GST settings checkout shows (migration 023). The server charges from the same row. */
interface TaxSettings {
  enabled: boolean;
  rate_percent: number;
  prices_include_tax: boolean;
  seller_state: string;
}

async function fetchTaxSettings(): Promise<TaxSettings | null> {
  const { data, error } = await supabase
    .from('tax_settings')
    .select('enabled, rate_percent, prices_include_tax, seller_state')
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data ? { ...(data as TaxSettings), rate_percent: Number((data as TaxSettings).rate_percent) } : null;
}

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
  // Billing: the same as shipping unless the customer says otherwise.
  const [billingSame, setBillingSame] = useState(true);
  const [billing, setBilling] = useState<BillingForm>(EMPTY_BILLING);
  const [billingErrors, setBillingErrors] = useState<Partial<Record<keyof BillingForm, string>>>({});
  const [gstin, setGstin] = useState('');
  const [gstinError, setGstinError] = useState('');
  const { data: taxSettings } = useAsync<TaxSettings | null>(fetchTaxSettings, {});
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
  useStoreEvent('checkout_started', orderType, Boolean(pending));
  const isReplacement = isPhysical && Boolean(pending?.replacesCardId);

  // Promo code: checked by the database for display; charged by the server.
  const [promoInput, setPromoInput] = useState('');
  const [promo, setPromo] = useState<{ code: string; percent?: number; discountInPaise: number } | null>(null);
  const [promoMessage, setPromoMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);

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
    // Every way into checkout (Buy Now, cart, account) passes the Card details step first.
    else if (needsCardDetails(pending) && !pending.profile?.displayName) navigate('/shygontap/card-details', { replace: true });
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
      email: current.email || profile.email || '',
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
          label: isReplacement ? `${variant.name} (replacement)` : variant.name,
          detail: isReplacement
            ? `Replaces card ${pending.replacesCardCode ?? ''} · opens the same page`.replace('  ', ' ')
            : quantity > 1
              ? `Quantity ${quantity}`
              : undefined,
          paise: variant.priceInPaise * (isReplacement ? 1 : quantity),
        });
      }
      if (!isReplacement && pending.planId && pending.planId !== 'essential') {
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
  }, [catalog, pending, orderType, isReplacement]);

  /** Cart value: what a promo code is a percentage of. Delivery is added after. */
  const subtotal = lines.reduce((sum, line) => sum + line.paise, 0);
  const deliveryPaise = isPhysical && lines.length > 0 ? (catalog?.deliveryInPaise ?? 0) : 0;
  const discountPaise = promo ? Math.min(promo.discountInPaise, subtotal) : 0;
  const beforeTax = subtotal - discountPaise + deliveryPaise;
  // Display only: /api/create-order works the GST out again from the same
  // settings and charges that, whatever this page shows.
  const taxRate = taxSettings?.enabled ? taxSettings.rate_percent : 0;
  const taxInclusive = taxSettings ? taxSettings.prices_include_tax : true;
  const taxPaise =
    taxRate > 0
      ? taxInclusive
        ? Math.round(beforeTax - (beforeTax * 100) / (100 + taxRate))
        : Math.round((beforeTax * taxRate) / 100)
      : 0;
  const total = taxInclusive ? beforeTax : beforeTax + taxPaise;
  const supplyState = (isPhysical ? shipping.state : billing.state).trim().toLowerCase();
  const intraState = supplyState !== '' && supplyState === (taxSettings?.seller_state ?? 'Karnataka').toLowerCase();

  async function applyPromo() {
    const code = promoInput.trim().toUpperCase();
    if (!code || promoBusy) return;
    setPromoBusy(true);
    setPromoMessage(null);
    try {
      const result = await checkPromoCode(code, subtotal, orderType);
      if (result.ok && typeof result.discountInPaise === 'number') {
        setPromo({ code: result.code ?? code, percent: result.percent, discountInPaise: result.discountInPaise });
        setPromoMessage({ tone: 'ok', text: result.message });
        setPromoInput('');
      } else {
        setPromo(null);
        setPromoMessage({ tone: 'error', text: result.message });
      }
    } catch (err) {
      setPromoMessage({ tone: 'error', text: describeError(err, 'We could not check that code.') });
    } finally {
      setPromoBusy(false);
    }
  }

  function removePromo() {
    setPromo(null);
    setPromoMessage(null);
  }

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
    if (shipping.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(shipping.email.trim())) next.email = 'Enter a valid email address.';

    const nextBilling: Partial<Record<keyof BillingForm, string>> = {};
    if (!billingSame) {
      if (!billing.name.trim()) nextBilling.name = 'Enter the billing name.';
      if (!billing.address.trim()) nextBilling.address = 'Enter the billing address.';
      if (!billing.city.trim()) nextBilling.city = 'Enter a city.';
      if (!billing.state.trim()) nextBilling.state = 'Enter a state.';
      if (!/^[1-9]\d{5}$/.test(billing.pincode.trim())) nextBilling.pincode = 'Enter a valid 6-digit PIN code.';
      if (billing.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billing.email.trim())) nextBilling.email = 'Enter a valid email address.';
    }
    const gstinValue = gstin.trim().toUpperCase();
    const gstinBad = gstinValue !== '' && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstinValue);
    setGstinError(gstinBad ? 'A GSTIN is 15 characters, e.g. 29ABCDE1234F1Z5.' : '');

    setFieldErrors(next);
    setBillingErrors(nextBilling);
    return Object.keys(next).length === 0 && Object.keys(nextBilling).length === 0 && !gstinBad;
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

      const base: PurchaseIntent =
        orderType === 'physical'
          ? {
              orderType: 'physical',
              productId: pending.productId!,
              material: pending.material!,
              tier: pending.tier!,
              planId: isReplacement ? undefined : pending.planId,
              quantity: isReplacement ? 1 : Math.max(1, Number(pending.quantity ?? 1)),
              ...(isReplacement ? { replacesCardId: pending.replacesCardId } : {}),
              ...(!isReplacement && pending.profile ? { profile: pending.profile } : {}),
              shipping: {
                name: shipping.name.trim(),
                phone: shipping.phone.trim(),
                address: shipping.address.trim(),
                city: shipping.city.trim(),
                state: shipping.state.trim(),
                pincode: shipping.pincode.trim(),
                email: shipping.email.trim() || undefined,
                line2: shipping.line2.trim() || undefined,
                locality: shipping.locality.trim() || undefined,
                country: 'India',
              },
            }
          : orderType === 'digitalUpgrade'
            ? { orderType: 'digitalUpgrade', planId: pending.planId! }
            : orderType === 'lifetimeCustomization'
              ? { orderType: 'lifetimeCustomization' }
              : { orderType: 'customization', customizationSkus: pending.customizationSkus ?? [] };
      const billingDetails = isPhysical
        ? billingSame
          ? { sameAsShipping: true, company: billing.company.trim() || undefined, gstin: gstin.trim().toUpperCase() || undefined }
          : {
              sameAsShipping: false,
              name: billing.name.trim(),
              company: billing.company.trim() || undefined,
              phone: billing.phone.trim() || undefined,
              email: billing.email.trim() || undefined,
              address: billing.address.trim(),
              line2: billing.line2.trim() || undefined,
              locality: billing.locality.trim() || undefined,
              city: billing.city.trim(),
              state: billing.state.trim(),
              pincode: billing.pincode.trim(),
              country: 'India',
              gstin: gstin.trim().toUpperCase() || undefined,
            }
        : gstin.trim()
          ? { sameAsShipping: false, gstin: gstin.trim().toUpperCase() }
          : undefined;
      const withBilling: PurchaseIntent = billingDetails ? { ...base, billing: billingDetails } : base;
      const intent: PurchaseIntent = promo ? { ...withBilling, promoCode: promo.code } : withBilling;

      const result = await startCheckout(intent, {
        customerName: shipping.name.trim() || profile?.full_name || undefined,
        customerEmail: user.email ?? undefined,
        customerPhone: shipping.phone.trim() || profile?.phone || undefined,
        onStage: (next) => {
          setStage(next);
          if (next === 'awaiting-payment') trackStoreEvent('payment_opened', orderType);
        },
      });

      // The server has verified the signature, marked the order paid and
      // written the entitlement rows. Re-read them rather than assuming.
      setCheckoutResult({ orderId: result.shygonOrderId, paymentId: result.razorpayPaymentId });
      trackStoreEvent('payment_success', orderType);
      trackStoreEvent('purchase_completed', orderType);
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
            trackStoreEvent('payment_cancelled', orderType);
            setError('');
            toast.info('Payment cancelled', "You haven't been charged. Your selection is saved.");
            break;
          case 'failed':
            trackStoreEvent('payment_failed', orderType);
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

      {isPhysical && !isReplacement ? (
        <CheckoutSteps active={1} />
      ) : (
        <CheckoutSteps active={0} steps={['Delivery', 'Review', 'Secure payment']} />
      )}

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
            <h1>{isReplacement ? 'Replacement card' : isPhysical ? 'Delivery details' : 'Confirm your upgrade'}</h1>
            <p>
              {isReplacement
                ? 'A new card with a new Card ID that opens the same page as the one it replaces. Tell us where to send it — payment is handled by Razorpay.'
                : isPhysical
                ? 'Tell us where to send your SHYGON Tap card. Payment is handled by Razorpay — we never see your card details.'
                : 'Review what you are buying, then pay securely through Razorpay.'}
            </p>
          </div>

          {isPhysical && !isReplacement && pending?.profile?.displayName && (
            <section className="panel">
              <div className="panel-head">
                <Sparkles size={19} />
                <div>
                  <h2>Card details</h2>
                  <p>Your new page is created with these the moment your payment is confirmed.</p>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => navigate('/shygontap/card-details')}>
                  Edit
                </button>
              </div>
              <div className="panel-body" style={{ display: 'grid', gap: 6, fontSize: 14 }}>
                <strong style={{ fontSize: 16 }}>{pending.profile.displayName}</strong>
                {(pending.profile.designation || pending.profile.company) && (
                  <span style={{ color: 'var(--muted)' }}>
                    {[pending.profile.designation, pending.profile.company].filter(Boolean).join(' · ')}
                  </span>
                )}
                <span style={{ color: 'var(--muted)' }}>
                  Buttons:{' '}
                  {(['phone', 'email', 'whatsapp', 'instagram', 'linkedin', 'website', 'location', 'youtube'] as const)
                    .filter((key) => pending.profile?.[key])
                    .map((key) => BUTTON_LABELS[key])
                    .join(', ') || 'none yet'}
                </span>
              </div>
            </section>
          )}

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
                <Field
                  label="Email"
                  value={shipping.email}
                  error={fieldErrors.email}
                  onChange={(v) => setShipping((s) => ({ ...s, email: v }))}
                  autoComplete="email"
                  inputMode="email"
                  placeholder="you@example.com"
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
                <div className="field-row">
                  <Field
                    label="Address line 2 (optional)"
                    value={shipping.line2}
                    onChange={(v) => setShipping((s) => ({ ...s, line2: v }))}
                    autoComplete="address-line2"
                    placeholder="Floor, landmark"
                  />
                  <Field
                    label="Locality / area"
                    value={shipping.locality}
                    onChange={(v) => setShipping((s) => ({ ...s, locality: v }))}
                    autoComplete="address-level3"
                    placeholder="Indiranagar"
                  />
                </div>
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
                <p className="field-hint" style={{ margin: '-4px 0 0' }}>Country: India</p>
              </div>
            </section>
          )}

          {/* --------------------------------------------------------- billing */}
          <section className="panel">
            <div className="panel-head">
              <Receipt size={19} />
              <div>
                <h2>Billing details</h2>
                <p>Printed on your GST invoice (e-bill).</p>
              </div>
            </div>
            <div className="panel-body">
              {isPhysical && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, fontWeight: 650, marginBottom: billingSame ? 14 : 18, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={billingSame}
                    onChange={(e) => setBillingSame(e.target.checked)}
                    style={{ width: 18, height: 18, accentColor: 'var(--ds-accent)' }}
                  />
                  Billing address same as delivery address
                </label>
              )}
              {isPhysical && !billingSame && (
                <>
                  <div className="field-row">
                    <Field label="Billing name" value={billing.name} error={billingErrors.name} onChange={(v) => setBilling((b) => ({ ...b, name: v }))} autoComplete="billing name" />
                    <Field label="Company (optional)" value={billing.company} onChange={(v) => setBilling((b) => ({ ...b, company: v }))} autoComplete="billing organization" />
                  </div>
                  <div className="field-row">
                    <Field label="Phone" value={billing.phone} onChange={(v) => setBilling((b) => ({ ...b, phone: v }))} autoComplete="billing tel" inputMode="tel" />
                    <Field label="Email" value={billing.email} error={billingErrors.email} onChange={(v) => setBilling((b) => ({ ...b, email: v }))} autoComplete="billing email" inputMode="email" />
                  </div>
                  <Field label="Address line 1" value={billing.address} error={billingErrors.address} onChange={(v) => setBilling((b) => ({ ...b, address: v }))} autoComplete="billing address-line1" />
                  <div className="field-row">
                    <Field label="Address line 2 (optional)" value={billing.line2} onChange={(v) => setBilling((b) => ({ ...b, line2: v }))} autoComplete="billing address-line2" />
                    <Field label="Locality / area" value={billing.locality} onChange={(v) => setBilling((b) => ({ ...b, locality: v }))} autoComplete="billing address-level3" />
                  </div>
                  <div className="field-row">
                    <Field label="City" value={billing.city} error={billingErrors.city} onChange={(v) => setBilling((b) => ({ ...b, city: v }))} autoComplete="billing address-level2" />
                    <Field label="State" value={billing.state} error={billingErrors.state} onChange={(v) => setBilling((b) => ({ ...b, state: v }))} autoComplete="billing address-level1" />
                  </div>
                  <Field
                    label="PIN code"
                    value={billing.pincode}
                    error={billingErrors.pincode}
                    onChange={(v) => setBilling((b) => ({ ...b, pincode: v.replace(/\D/g, '').slice(0, 6) }))}
                    autoComplete="billing postal-code"
                    inputMode="numeric"
                  />
                  <p className="field-hint" style={{ margin: '-4px 0 12px' }}>Country: India</p>
                </>
              )}
              {isPhysical && billingSame && (
                <Field
                  label="Company (optional)"
                  value={billing.company}
                  onChange={(v) => setBilling((b) => ({ ...b, company: v }))}
                  autoComplete="organization"
                />
              )}
              <Field
                label="GSTIN (optional, for a business invoice)"
                value={gstin}
                error={gstinError}
                onChange={(v) => setGstin(v.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 15))}
                placeholder="29ABCDE1234F1Z5"
              />
            </div>
          </section>
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

                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                    <div style={{ fontWeight: 650, fontSize: 13.5 }}>Subtotal</div>
                    <strong style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{rupees(subtotal)}</strong>
                  </div>
                  {deliveryPaise > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 14,
                        padding: '10px 0',
                        borderBottom: '1px solid var(--line)',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 650, fontSize: 13.5 }}>Shipping</div>
                        <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 3 }}>Anywhere in India</div>
                      </div>
                      <strong style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {rupees(deliveryPaise)}
                      </strong>
                    </div>
                  )}

                  {/* ------------------------------------------------ promo code */}
                  <div style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
                    {promo ? (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, fontSize: 13.5, fontWeight: 650 }}>
                          <TicketPercent size={16} color="var(--ds-color-state-success)" />
                          {promo.code}
                          {promo.percent ? ` · ${promo.percent}% off` : ''}
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={removePromo}
                            aria-label={`Remove promo code ${promo.code}`}
                            style={{ width: 26, height: 26 }}
                          >
                            <X size={13} />
                          </button>
                        </span>
                        <strong style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: 'var(--ds-color-state-success)' }}>
                          −{rupees(discountPaise)}
                        </strong>
                      </div>
                    ) : (
                      <form
                        style={{ display: 'flex', gap: 8 }}
                        onSubmit={(e) => {
                          e.preventDefault();
                          void applyPromo();
                        }}
                      >
                        <input
                          className="input"
                          value={promoInput}
                          onChange={(e) => setPromoInput(e.target.value.toUpperCase().slice(0, 32))}
                          placeholder="Promo code"
                          aria-label="Promo code"
                          autoCapitalize="characters"
                          style={{ padding: '9px 12px', fontSize: 14 }}
                        />
                        <button
                          type="submit"
                          className="btn btn-ghost btn-sm"
                          disabled={promoBusy || !promoInput.trim()}
                          style={{ flex: '0 0 auto' }}
                        >
                          {promoBusy ? <Loader2 size={14} className="spin" /> : 'Apply'}
                        </button>
                      </form>
                    )}
                    {promoMessage && (
                      <p
                        role={promoMessage.tone === 'error' ? 'alert' : 'status'}
                        style={{
                          margin: '8px 0 0',
                          fontSize: 12,
                          color: promoMessage.tone === 'ok' ? 'var(--ds-color-state-success)' : 'var(--ds-color-state-error)',
                        }}
                      >
                        {promoMessage.text}
                      </p>
                    )}
                  </div>

                  {taxRate > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 650, fontSize: 13.5 }}>
                          GST {taxRate}%{taxInclusive ? ' (included)' : ''}
                        </div>
                        <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 3 }}>
                          {supplyState === '' ? 'CGST + SGST or IGST, by delivery state' : intraState ? `CGST ${taxRate / 2}% + SGST ${taxRate / 2}%` : `IGST ${taxRate}%`}
                        </div>
                      </div>
                      <strong style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {taxInclusive ? '' : '+'}
                        {rupees(taxPaise)}
                      </strong>
                    </div>
                  )}

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
                        <Loader2 size={16} className="spin" /> Opening secure payment…
                      </>
                    ) : (
                      <>
                        <Lock size={15} /> Pay {rupees(total)} Securely
                      </>
                    )}
                  </button>
                  <p style={{ margin: '10px 0 0', fontSize: 12, lineHeight: 1.55, color: 'var(--muted)' }}>
                    Pay by card, UPI or netbanking in Razorpay&rsquo;s secure window. Card details go straight to
                    Razorpay — SHYGON never sees or stores your card number or CVV.
                  </p>

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
