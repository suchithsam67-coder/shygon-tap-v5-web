import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  AtSign,
  Globe,
  Instagram,
  Linkedin,
  Lock,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Sparkles,
  Youtube,
} from 'lucide-react';
import BrandMark from '../components/brand/BrandMark';
import ThemeToggle from '../components/ThemeToggle';
import { useAuth } from '../lib/auth-context';
import { useAccount } from '../lib/account-context';
import { cardArt, digitalPlans, materialLabels, products, tierLabels, type MaterialId, type TierId } from '../data/shygonTapData';
import { nextEdition, useEditions } from '../lib/editions';
import { toExperience, type Experience } from '../lib/database.types';
import { BUTTON_LABELS, TIER_LABELS, buttonsFor, tierIncluding } from '../lib/tierButtons';
import {
  CARD_NAME_MAX,
  needsCardDetails,
  readPendingOrder,
  savePendingProfile,
  type CardProfileDetails,
} from '../lib/cardDetails';
import { usePageMeta } from '../seo/usePageMeta';

/**
 * Buy Now → **Card details** → Delivery → Payment.
 *
 * The customer writes what goes on the card and the buttons their page will
 * have — only the buttons their chosen experience includes are open; the rest
 * say which tier unlocks them. Their limited-edition number is shown the way a
 * watch's caseback shows it. Everything is kept in the pending order and sent
 * with the purchase; the server fills the new page with it once paid.
 */

type ButtonField = 'whatsapp' | 'instagram' | 'linkedin' | 'website' | 'location' | 'youtube';

const BUTTON_FIELDS: { key: ButtonField; icon: typeof Phone; placeholder: string; hint?: string }[] = [
  { key: 'whatsapp', icon: MessageCircle, placeholder: '+91 98765 43210' },
  { key: 'instagram', icon: Instagram, placeholder: '@yourname or profile link' },
  { key: 'linkedin', icon: Linkedin, placeholder: 'linkedin.com/in/yourname' },
  { key: 'website', icon: Globe, placeholder: 'yourbusiness.com' },
  { key: 'location', icon: MapPin, placeholder: 'Office address or Google Maps link' },
  { key: 'youtube', icon: Youtube, placeholder: 'youtube.com/@yourchannel' },
];

const META = {
  title: 'Card details | SHYGON Tap',
  description: 'What goes on your SHYGON Tap card and page.',
  path: '/shygontap/card-details',
  noindex: true,
};

export default function CardDetails() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile } = useAccount();
  usePageMeta(META);
  const editions = useEditions();

  const [pending] = useState(readPendingOrder);
  const product = products.find((p) => p.id === pending?.productId);
  const material = (pending?.material as MaterialId) ?? 'pvc';
  const finish = (pending?.tier as TierId) ?? 'standard';
  const experience: Experience = toExperience(pending?.planId);
  const plan = digitalPlans.find((p) => p.id === experience);
  const included = useMemo(() => new Set(buttonsFor(experience)), [experience]);
  const numbered = product?.collection !== 'custom';
  const edition = numbered && product ? nextEdition(editions, product.id) : null;
  const quantity = Math.max(1, Math.min(10, Number(pending?.quantity ?? 1) || 1));
  // Several cards take consecutive numbers: "037–038".
  const numberLabel = edition
    ? quantity > 1 && edition.number + quantity - 1 <= edition.size
      ? `${edition.numberLabel}–${String(edition.number + quantity - 1).padStart(String(edition.size).length, '0')}`
      : edition.numberLabel
    : null;

  const [form, setForm] = useState<CardProfileDetails>(() => ({
    displayName: pending?.profile?.displayName ?? '',
    designation: pending?.profile?.designation ?? '',
    company: pending?.profile?.company ?? '',
    phone: pending?.profile?.phone ?? '',
    email: pending?.profile?.email ?? '',
    whatsapp: pending?.profile?.whatsapp ?? '',
    instagram: pending?.profile?.instagram ?? '',
    linkedin: pending?.profile?.linkedin ?? '',
    website: pending?.profile?.website ?? '',
    location: pending?.profile?.location ?? '',
    youtube: pending?.profile?.youtube ?? '',
  }));
  const [errors, setErrors] = useState<Partial<Record<keyof CardProfileDetails, string>>>({});
  const [prefilled, setPrefilled] = useState(false);

  // Nothing to fill in for a replacement or a digital purchase: straight on.
  useEffect(() => {
    if (!pending) navigate('/shygontap/store', { replace: true });
    else if (!needsCardDetails(pending)) navigate('/shygontap/checkout', { replace: true });
  }, [pending, navigate]);

  // Start from the account once it loads, without overwriting anything typed.
  if (!prefilled && (profile || user) && !pending?.profile) {
    setPrefilled(true);
    setForm((f) => ({
      ...f,
      displayName: f.displayName || (profile?.full_name ?? '').slice(0, CARD_NAME_MAX),
      phone: f.phone || (profile?.phone ?? ''),
      email: f.email || (user?.email ?? ''),
    }));
  }

  const set = (key: keyof CardProfileDetails) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  function validate(): boolean {
    const next: typeof errors = {};
    const name = form.displayName.trim();
    if (name.length < 2) next.displayName = 'Enter the name to print on your card.';
    else if (name.length > CARD_NAME_MAX) next.displayName = `Up to ${CARD_NAME_MAX} characters fit on the card.`;
    const phone = (form.phone ?? '').replace(/[\s-]/g, '');
    if (!/^\+?\d{10,13}$/.test(phone)) next.phone = 'Enter a 10-digit mobile number (with +91 if you like).';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = 'Enter a valid email address.';
    const wa = (form.whatsapp ?? '').replace(/[\s-]/g, '');
    if (wa && !/^\+?\d{10,13}$/.test(wa)) next.whatsapp = 'Enter a WhatsApp number, e.g. +91 98765 43210.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function next() {
    if (!validate()) return;
    const clean: CardProfileDetails = { displayName: form.displayName.trim() };
    for (const [key, value] of Object.entries(form) as [keyof CardProfileDetails, string | undefined][]) {
      if (key === 'displayName') continue;
      const v = (value ?? '').trim();
      // Buttons the tier does not include are not kept: the page could not show them.
      if (v && (!BUTTON_LABELS[key] || included.has(key))) clean[key] = v;
    }
    savePendingProfile(clean);
    navigate('/shygontap/checkout');
  }

  if (!pending || !product) return null;

  const locked = BUTTON_FIELDS.filter((f) => !included.has(f.key));

  return (
    <div className="app card-details-page">
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

      <CheckoutSteps active={0} />

      <div className="app-body checkout-body">
        <main className="app-main page-enter">
          <button className="btn btn-ghost btn-sm" style={{ justifySelf: 'start' }} onClick={() => navigate(-1)}>
            <ArrowLeft size={15} /> Back
          </button>

          <div className="app-page-head">
            <p className="eyebrow" style={{ margin: 0 }}>Step 1 of 4</p>
            <h1>Card details</h1>
            <p>
              What goes on your card and the page it opens. Your page is created with these details the moment your
              payment is confirmed — you can change them later from your account.
            </p>
          </div>

          <section className="panel">
            <div className="panel-head">
              <AtSign size={19} />
              <div>
                <h2>On your card</h2>
                <p>Printed on the card and shown at the top of your page.</p>
              </div>
            </div>
            <div className="panel-body">
              <Field
                label="Name on card"
                value={form.displayName}
                onChange={set('displayName')}
                error={errors.displayName}
                maxLength={CARD_NAME_MAX}
                autoComplete="name"
                placeholder="Arjun Mehta"
                hint={`${form.displayName.trim().length}/${CARD_NAME_MAX}`}
              />
              <div className="field-row">
                <Field label="Title (optional)" value={form.designation ?? ''} onChange={set('designation')} maxLength={80} placeholder="Founder" />
                <Field label="Company (optional)" value={form.company ?? ''} onChange={set('company')} maxLength={80} placeholder="Mehta Studio" autoComplete="organization" />
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <Sparkles size={19} />
              <div>
                <h2>Your buttons · {TIER_LABELS[experience]}</h2>
                <p>
                  {TIER_LABELS[experience]} includes {buttonsFor(experience).filter((k) => k !== 'links' && k !== 'gallery').map((k) => BUTTON_LABELS[k]).join(', ')}
                  {experience === 'premium' || experience === 'goat' ? ', custom links' : ''}
                  {experience === 'goat' ? ' and a photo gallery' : ''}. Leave any of them empty to hide it.
                </p>
              </div>
            </div>
            <div className="panel-body">
              <div className="field-row">
                <Field label="Call · mobile number" icon={Phone} value={form.phone ?? ''} onChange={set('phone')} error={errors.phone} inputMode="tel" autoComplete="tel" placeholder="98765 43210" />
                <Field label="Email" icon={Mail} value={form.email ?? ''} onChange={set('email')} error={errors.email} inputMode="email" autoComplete="email" placeholder="you@example.com" />
              </div>
              {BUTTON_FIELDS.filter((f) => included.has(f.key)).map(({ key, icon, placeholder }) => (
                <Field
                  key={key}
                  label={BUTTON_LABELS[key]!}
                  icon={icon}
                  value={(form[key] as string) ?? ''}
                  onChange={set(key)}
                  error={errors[key]}
                  placeholder={placeholder}
                  maxLength={200}
                />
              ))}

              {locked.length > 0 && (
                <div className="card-details-locked">
                  <p className="card-details-locked-title">
                    <Lock size={13} /> Not in {TIER_LABELS[experience]}
                  </p>
                  <div className="card-details-locked-grid">
                    {locked.map(({ key, icon: Icon }) => {
                      const tier = tierIncluding(key) ?? 'goat';
                      return (
                        <span key={key} className="card-details-locked-item">
                          <Icon size={14} /> {BUTTON_LABELS[key]}
                          <em>{TIER_LABELS[tier]}+</em>
                        </span>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => navigate(`/shygontap/store/${product.id}`)}
                  >
                    Choose a higher experience
                  </button>
                </div>
              )}
            </div>
          </section>
        </main>

        <aside className="checkout-summary">
          <section className="panel" style={{ position: 'sticky', top: 90 }}>
            <div className="panel-body" style={{ display: 'grid', gap: 18 }}>
              <img
                src={cardArt(product, material, finish)}
                alt={`${product.name} card`}
                style={{ width: '100%', borderRadius: 14, display: 'block', boxShadow: '0 18px 40px rgba(0,0,0,.35)' }}
              />
              <div>
                <p className="eyebrow" style={{ margin: 0 }}>Your card</p>
                <h2 style={{ margin: '4px 0 2px', fontSize: 20 }}>{product.name}</h2>
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13.5 }}>
                  {materialLabels[material]} · {tierLabels[finish]} · {plan?.name ?? TIER_LABELS[experience]} experience
                </p>
              </div>

              {numbered ? (
                <EditionCaseback
                  name={edition?.name ?? product.name.replace(/^Shygon Tap\s+/i, '')}
                  chapter={edition?.chapterRoman ?? 'I'}
                  number={numberLabel}
                  size={edition?.size ?? 100}
                  cardName={form.displayName.trim() || 'YOUR NAME'}
                />
              ) : (
                <p className="field-hint" style={{ margin: 0 }}>
                  Made to order with your own artwork — custom cards are not part of a numbered edition.
                </p>
              )}

              <button type="button" className="btn btn-blue" style={{ width: '100%' }} onClick={next}>
                Continue to delivery <ArrowRight size={16} />
              </button>
              <p className="field-hint" style={{ margin: 0 }}>
                Next: delivery address, then secure payment through Razorpay.
              </p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

/** The four checkout steps; shared look with the checkout page. */
export function CheckoutSteps({ active, steps = ['Card details', 'Delivery', 'Review', 'Secure payment'] }: { active: number; steps?: string[] }) {
  return (
    <div style={{ width: 'min(1320px, calc(100% - 40px))', margin: '0 auto', padding: '20px 0 0' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${steps.length},1fr)`, gap: 8, maxWidth: 880 }}>
        {steps.map((step, index) => {
          const on = index <= active;
          return (
            <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{ width: 28, height: 28, flex: '0 0 auto', borderRadius: 999, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800, background: on ? 'var(--ds-action-bg)' : 'var(--ds-surface-raised)', color: on ? 'var(--ds-action-fg)' : 'var(--ds-text-tertiary)' }}>{index + 1}</span>
              <span style={{ fontSize: 12, fontWeight: 750, color: index === active ? 'var(--ink)' : 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{step}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The limited-edition number, engraved like a watch caseback: a dial of 60
 * ticks, the chapter on the ring, the number at the centre.
 */
function EditionCaseback({ name, chapter, number, size, cardName }: { name: string; chapter: string; number: string | null; size: number; cardName: string }) {
  const ring = `CHAPTER ${chapter} · ${name.toUpperCase()} · LIMITED EDITION · `;
  return (
    <figure className="edition-caseback" aria-label={`Chapter ${chapter}, number ${number ?? 'assigned at payment'} of ${size}`}>
      <svg viewBox="0 0 200 200" role="img" aria-hidden="true">
        <defs>
          <radialGradient id="cb-metal" cx="38%" cy="32%" r="75%">
            <stop offset="0%" stopColor="#f3e3b3" />
            <stop offset="45%" stopColor="#b8924a" />
            <stop offset="100%" stopColor="#5e4520" />
          </radialGradient>
          <radialGradient id="cb-face" cx="50%" cy="42%" r="70%">
            <stop offset="0%" stopColor="#1f2226" />
            <stop offset="100%" stopColor="#0b0c0e" />
          </radialGradient>
          <path id="cb-ring" d="M100,100 m-74,0 a74,74 0 1,1 148,0 a74,74 0 1,1 -148,0" />
        </defs>
        <circle cx="100" cy="100" r="98" fill="url(#cb-metal)" />
        <circle cx="100" cy="100" r="90" fill="url(#cb-face)" />
        {Array.from({ length: 60 }, (_, i) => (
          <line
            key={i}
            x1="100"
            y1={i % 5 === 0 ? 13 : 15}
            x2="100"
            y2="20"
            stroke={i % 5 === 0 ? '#e7c77c' : '#8a7446'}
            strokeWidth={i % 5 === 0 ? 1.6 : 0.8}
            transform={`rotate(${i * 6} 100 100)`}
          />
        ))}
        <text fontSize="7.4" letterSpacing="1.6" fill="#d9bc78" fontWeight="700">
          <textPath href="#cb-ring" startOffset="0">{ring.repeat(2).slice(0, 88)}</textPath>
        </text>
        <circle cx="100" cy="100" r="58" fill="none" stroke="#3a3326" strokeWidth="1" />
        <text x="100" y="80" textAnchor="middle" fontSize="9" letterSpacing="3" fill="#a88f5c" fontWeight="700">Nº</text>
        <text x="100" y="116" textAnchor="middle" fontSize={!number ? 16 : number.length > 4 ? 24 : 38} fontWeight="800" fill="#f4e6c1" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {number ?? 'at payment'}
        </text>
        <text x="100" y="134" textAnchor="middle" fontSize="10" letterSpacing="2" fill="#a88f5c" fontWeight="700">/ {size}</text>
      </svg>
      <figcaption>
        <strong>Chapter {chapter} · Nº {number ?? '—'} of {size}</strong>
        <span>Engraved for {cardName}</span>
        <small>Your number is fixed the moment your payment is confirmed. If someone pays a moment earlier, you get the next one.</small>
      </figcaption>
    </figure>
  );
}

function Field({
  label,
  value,
  onChange,
  error,
  hint,
  icon: Icon,
  ...rest
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  icon?: typeof Phone;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <label className="field">
      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        {label}
        {hint && <small style={{ color: 'var(--muted)', fontWeight: 600 }}>{hint}</small>}
      </span>
      {Icon ? (
        <div className="input-prefixed">
          <Icon size={15} />
          <input value={value} aria-invalid={Boolean(error)} onChange={(e) => onChange(e.target.value)} {...rest} />
        </div>
      ) : (
        <input className="input" value={value} aria-invalid={Boolean(error)} onChange={(e) => onChange(e.target.value)} {...rest} />
      )}
      {error && <p className="field-error">{error}</p>}
    </label>
  );
}
