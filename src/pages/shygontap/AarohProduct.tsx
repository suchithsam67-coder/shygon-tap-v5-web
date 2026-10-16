import { useCallback, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, ChevronRight } from 'lucide-react';
import {
  AAROH,
  AAROH_BULK_MINIMUM,
  AAROH_DEFAULT_FINISH,
  AAROH_EDITIONS,
  AAROH_FINISHES,
  AAROH_STORE_PATH,
  aarohProductId,
  editionById,
  finishById,
  type AarohEdition,
  type AarohFinish,
} from '../../data/aaroh';
import {
  AAROH_FAQS,
  ROLES,
  SOFTWARE_FEATURES,
  STATUS_LABEL,
  STEPS,
  USE_CASES,
  type FeatureStatus,
} from '../../data/aarohProduct';
import { digitalPlans } from '../../data/shygonTapData';
import { aarohPrice, experiencePrice, rupees, type Catalog } from '../../services/catalog';
import { useCatalog } from '../../hooks/useCatalog';
import { useGoToTiers } from '../../hooks/useGoToTiers';
import { supabase } from '../../lib/supabase';
import { SITE_URL } from '../../lib/site';
import { CARD_SALES_OPEN } from '../../lib/commerce';
import { aarohProductMeta, LEGAL_PAGES } from '../../seo/meta';
import { usePageMeta } from '../../seo/usePageMeta';
import AarohHeader from '../../components/aaroh/AarohHeader';
import AarohOverview from '../../components/aaroh/AarohOverview';
import BulkEnquiry from '../../components/aaroh/BulkEnquiry';
import EditionCollection from '../../components/aaroh/EditionCollection';
import SampleProfile from '../../components/aaroh/SampleProfile';
import StoreFooter from '../../components/StoreFooter';
import '../../styles/aaroh.css';

const META = aarohProductMeta(SITE_URL, { cardSales: CARD_SALES_OPEN });

/** The experiences a customer can buy today, in order. Essential comes with a card. */
const PAID_EXPERIENCES = digitalPlans.filter((plan) => plan.price > 0);

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/** History state that marks an overview this page opened, so closing it can go back. */
type OverviewState = { aarohOverview?: boolean } | null;

/**
 * SHYGON Version 1 — AAROH: the collection page (DEC-2026-036, DEC-2026-037).
 *
 * The ten editions of the AAROH design system as a collection; choosing one
 * opens its overview (AarohOverview) over the page, at a deep link
 * (?design=<edition>), and closing it returns to the same place in the
 * collection with focus on the edition that opened it. Below the collection:
 * what the card is, how it works, the software, who sees what, what a
 * purchase includes, orders for teams and the questions people ask. Feature
 * claims come from src/data/aarohProduct.ts, where each carries its real
 * status. Prices come from the catalogue, and the server prices every order
 * again. A card can be bought only while card sales are open and the chosen
 * option is in stock; otherwise the overview says why.
 */
export default function AarohProduct() {
  usePageMeta(META);
  const navigate = useNavigate();
  const location = useLocation();
  const catalog = useCatalog();
  const [params, setParams] = useSearchParams();
  const open = editionById(params.get('design'));
  const finish = finishById(params.get('finish')) ?? finishById(AAROH_DEFAULT_FINISH)!;
  const collectionRef = useRef<HTMLUListElement>(null);
  const lastOpened = useRef<string | null>(null);
  const focusAfterClose = useRef<string | null>(null);
  const opened = (location.state as OverviewState)?.aarohOverview === true;
  const from = aarohPrice(catalog, AAROH_EDITIONS[0]!.id, AAROH_FINISHES[0]!);

  const withParam = (key: 'design' | 'finish', value: string | null) => (current: URLSearchParams) => {
    const next = new URLSearchParams(current);
    if (value === null) next.delete(key);
    else next.set(key, value);
    return next;
  };

  const openEdition = (edition: AarohEdition) => {
    lastOpened.current = edition.id;
    setParams(withParam('design', edition.id), { preventScrollReset: true, state: { aarohOverview: true } });
  };
  const switchEdition = (edition: AarohEdition) => {
    lastOpened.current = edition.id;
    setParams(withParam('design', edition.id), { replace: true, preventScrollReset: true, state: location.state });
  };
  const selectFinish = (next: AarohFinish) =>
    setParams(withParam('finish', next.id), { replace: true, preventScrollReset: true, state: location.state });

  // Opened from this page: go back, so the browser's Back button and Close agree.
  // Arrived on the deep link: drop the edition from the address instead.
  const close = useCallback(
    (target?: string) => {
      focusAfterClose.current = target ?? null;
      if (opened) navigate(-1);
      else setParams(withParam('design', null), { replace: true, preventScrollReset: true });
    },
    [opened, navigate, setParams],
  );

  // After the overview closes (Close, Escape or Back), return focus to the
  // edition that opened it, or to the section a link asked for.
  const openId = open?.id;
  useEffect(() => {
    if (openId) {
      lastOpened.current = openId;
      return;
    }
    const target = focusAfterClose.current;
    focusAfterClose.current = null;
    if (target) {
      const section = document.getElementById(target);
      section?.scrollIntoView({ block: 'start' });
      section?.querySelector<HTMLElement>('input, textarea, a, button')?.focus({ preventScroll: true });
      return;
    }
    if (lastOpened.current) {
      collectionRef.current?.querySelector<HTMLElement>(`[data-edition="${lastOpened.current}"]`)?.focus({ preventScroll: false });
    }
  }, [openId]);

  // Same handoff as the SHYGON TAP V5 pages: save the selection (never a price),
  // then sign in or go straight to checkout, which prices it from the catalogue.
  async function buy(edition: AarohEdition, quantity: number) {
    try {
      localStorage.setItem(
        'shygon_pending_order',
        JSON.stringify({ orderType: 'physical', productId: aarohProductId(edition), tier: finish.id, quantity, planId: 'essential' }),
      );
      window.dispatchEvent(new Event('shygon-cart-updated'));
    } catch {
      /* private mode: checkout will say the cart is empty */
    }
    try {
      const { data } = await supabase.auth.getSession();
      navigate(data.session ? '/shygontap/checkout' : '/shygontap/auth');
    } catch {
      navigate('/shygontap/auth');
    }
  }

  return (
    <div className="store-page aaroh-store aaroh-product">
      <AarohHeader />

      <main className="store-main aaroh-main">
        <nav className="text-sm text-[var(--ds-text-tertiary)] mb-5" aria-label="Breadcrumb">
          <Link to="/shygontap" className="hover:text-[var(--ds-text)]">Shygon Tap</Link>
          <ChevronRight size={14} className="inline mx-1 -mt-0.5" />
          <Link to={AAROH_STORE_PATH} className="hover:text-[var(--ds-text)]">Store</Link>
          <ChevronRight size={14} className="inline mx-1 -mt-0.5" />
          <span className="text-[var(--ds-text)] font-semibold" aria-current="page">AAROH</span>
        </nav>

        {/* ------------------------------------------------ collection */}
        <section className="aaroh-collection" aria-labelledby="aaroh-product-title">
          <header className="aaroh-collection-head">
            <p className="aaroh-kicker">SHYGON · {AAROH.version}</p>
            <h1 id="aaroh-product-title" className="aaroh-product-title">AAROH</h1>
            <p className="aaroh-collection-headline">{AAROH.headline}</p>
            <p className="aaroh-buy-lede">{AAROH.lede}</p>
            <p className="aaroh-collection-price">
              From <strong>{inr(from)}</strong> per card, paid once. Choose an edition to see it up close.
            </p>
            {!CARD_SALES_OPEN && <p className="aaroh-muted">AAROH cards are not on sale yet. The editions are shown as concept renders.</p>}
          </header>
          <EditionCollection ref={collectionRef} onOpen={openEdition} current={open?.id} finish={finish.id} />
          <p className="aaroh-bulk-link">
            Ordering {AAROH_BULK_MINIMUM} or more, for example for your team?{' '}
            <a href="#teams" className="aaroh-link">Request a quotation <ArrowRight size={14} aria-hidden="true" /></a>
          </p>
        </section>

        {/* ---------------------------------------------- A. overview */}
        <section id="overview" className="aaroh-section" aria-labelledby="aaroh-overview-title">
          <header className="aaroh-section-head">
            <p className="aaroh-kicker">Overview</p>
            <h2 id="aaroh-overview-title">A card you hold. Software that works for you.</h2>
            <p>AAROH is two things that work together: the physical card, and the SHYGON profile and account it opens.</p>
          </header>
          <div className="aaroh-two">
            <div>
              <h3>The card</h3>
              <ul className="aaroh-ticks">
                <li>A physical smart card, in one of ten editions and two finishes</li>
                <li>An NFC chip: someone taps it with a compatible phone</li>
                <li>A QR code on the back, for phones without NFC</li>
                <li>It carries a link, not your details. Change your profile and every tap shows the new version, with no new card</li>
              </ul>
            </div>
            <div>
              <h3>The software</h3>
              <ul className="aaroh-ticks">
                <li>Your SHYGON profile, a web page at your own link</li>
                <li>Your SHYGON account, where you edit it and choose its look</li>
                <li>Analytics, order updates and support</li>
                <li>Experiences and add-ons that decide how far you can customise it</li>
              </ul>
            </div>
          </div>
        </section>

        {/* ------------------------------------------ B. how it works */}
        <section id="how-it-works" className="aaroh-section" aria-labelledby="aaroh-how-title">
          <header className="aaroh-section-head">
            <p className="aaroh-kicker">How AAROH works</p>
            <h2 id="aaroh-how-title">Four steps, from choosing to tapping.</h2>
          </header>
          <ol className="aaroh-steps">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="aaroh-step-number">{String(index + 1).padStart(2, '0')}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
                {step.note && <p className="aaroh-step-note">{step.note}</p>}
              </li>
            ))}
          </ol>
          <p className="aaroh-policies">
            <Link to={LEGAL_PAGES.shipping.path} className="aaroh-link">Shipping Policy</Link>
            <Link to={LEGAL_PAGES.refunds.path} className="aaroh-link">Refund Policy</Link>
          </p>
        </section>

        {/* ----------------------------------------- C. the software */}
        <section id="software" className="aaroh-section" aria-labelledby="aaroh-software-title">
          <header className="aaroh-section-head">
            <p className="aaroh-kicker">The AAROH software experience</p>
            <h2 id="aaroh-software-title">More Than a Card. A Connected Digital Experience.</h2>
            <p>Each feature shows whether you have it now, whether it depends on what you buy, or whether it arrives with the card release.</p>
          </header>
          <div className="aaroh-software">
            <ul className="aaroh-features">
              {SOFTWARE_FEATURES.map((feature) => (
                <li key={feature.title}>
                  <StatusBadge status={feature.status} />
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                </li>
              ))}
            </ul>
            <SampleProfile className="aaroh-software-preview" />
          </div>
        </section>

        {/* ----------------------------- D. cardholder and recipient */}
        <section id="who" className="aaroh-section" aria-labelledby="aaroh-who-title">
          <header className="aaroh-section-head">
            <p className="aaroh-kicker">Two sides of a tap</p>
            <h2 id="aaroh-who-title">You hold the card. They see your profile.</h2>
          </header>
          <div className="aaroh-two">
            <div>
              <h3>The cardholder</h3>
              <ul className="aaroh-ticks">{ROLES.cardholder.map((line) => <li key={line}>{line}</li>)}</ul>
            </div>
            <div>
              <h3>The person you meet</h3>
              <ul className="aaroh-ticks">{ROLES.recipient.map((line) => <li key={line}>{line}</li>)}</ul>
            </div>
          </div>
        </section>

        {/* -------------------------------- E. one card, many uses */}
        <section id="possibilities" className="aaroh-section" aria-labelledby="aaroh-uses-title">
          <header className="aaroh-section-head">
            <p className="aaroh-kicker">One card</p>
            <h2 id="aaroh-uses-title">One card, many possibilities.</h2>
            <p>
              AAROH is one card for individuals, not a set of separate cards for separate jobs, and an organisation can
              order the same card for its team. Each use below says where it stands today.
            </p>
          </header>
          <ul className="aaroh-uses">
            {USE_CASES.map((use) => (
              <li key={use.title}>
                <StatusBadge status={use.status} />
                <h3>{use.title}</h3>
                <p>{use.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ------------------------------------------ G. what's included */}
        <Included catalog={catalog} selected={open ?? AAROH_EDITIONS[0]!} />

        {/* ------------------------------------ H. orders for teams */}
        <BulkEnquiry id="teams" />

        {/* ----------------------------------------------------- I. FAQ */}
        <section id="faq" className="aaroh-section" aria-labelledby="aaroh-faq-title">
          <header className="aaroh-section-head">
            <p className="aaroh-kicker">Questions</p>
            <h2 id="aaroh-faq-title">Frequently asked questions</h2>
          </header>
          <div className="aaroh-faq">
            {AAROH_FAQS.map(([question, answer]) => (
              <details key={question}>
                <summary>{question}</summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <StoreFooter />

      {open && (
        <AarohOverview
          edition={open}
          finish={finish}
          catalog={catalog}
          onClose={close}
          onEdition={switchEdition}
          onFinish={selectFinish}
          onBuy={(quantity) => void buy(open, quantity)}
        />
      )}
    </div>
  );
}

/** What a purchase includes, with today's prices from the catalogue. */
function Included({ catalog, selected }: { catalog: Catalog | null; selected: AarohEdition }) {
  const goToTiers = useGoToTiers();
  const experiencePriceOf = (plan: (typeof PAID_EXPERIENCES)[number]) => {
    const live = experiencePrice(catalog, plan.id);
    return live ? rupees(live.priceInPaise) : inr(plan.price);
  };

  return (
    <section id="included" className="aaroh-section" aria-labelledby="aaroh-included-title">
      <header className="aaroh-section-head">
        <p className="aaroh-kicker">What is included</p>
        <h2 id="aaroh-included-title">Know what you get before you pay.</h2>
        <p>Not every feature comes with every purchase. Here is exactly what each part includes.</p>
      </header>
      <div className="aaroh-included">
        <article>
          <StatusBadge status="available" />
          <h3>Your SHYGON profile, today</h3>
          <p>A new profile starts with one of these experiences, each a one-time payment:</p>
          <ul className="aaroh-price-list">
            {PAID_EXPERIENCES.map((plan) => (
              <li key={plan.id}>
                <span>{plan.name}</span>
                <strong>{experiencePriceOf(plan)}</strong>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-blue" onClick={goToTiers}>
            Choose your experience <ArrowRight size={16} aria-hidden="true" />
          </button>
        </article>

        <article>
          <StatusBadge status={CARD_SALES_OPEN ? 'available' : 'card-release'} />
          <h3>With an AAROH card</h3>
          <ul className="aaroh-ticks">
            <li>One AAROH card in the edition and finish you choose</li>
            <li>Its NFC chip and QR code, linked to your profile</li>
            <li>The Essential experience, included with the card</li>
          </ul>
          <ul className="aaroh-price-list">
            {AAROH_FINISHES.map((item) => (
              <li key={item.id}>
                <span>{item.title}</span>
                <strong>{inr(aarohPrice(catalog, selected.id, item))}</strong>
              </li>
            ))}
            <li>
              <span>{AAROH_BULK_MINIMUM} cards or more</span>
              <strong>Quotation</strong>
            </li>
          </ul>
        </article>

        <article>
          <StatusBadge status="addon" />
          <h3>Optional extras, bought once</h3>
          {catalog ? (
            <ul className="aaroh-price-list">
              {catalog.customizations.map((addon) => (
                <li key={addon.sku}>
                  <span>{addon.name}</span>
                  <strong>{rupees(addon.priceInPaise)}</strong>
                </li>
              ))}
              {catalog.pass && (
                <li>
                  <span>{catalog.pass.name}</span>
                  <strong>{rupees(catalog.pass.priceInPaise)}</strong>
                </li>
              )}
            </ul>
          ) : (
            <p className="aaroh-muted">Buttons such as WhatsApp, Instagram, LinkedIn, Website and Location, and the Customization Pass. Prices are shown before you pay.</p>
          )}
        </article>
      </div>
      <p className="aaroh-included-note">
        No subscription: cards, experiences, add-ons and the Customization Pass are one-time payments. See our{' '}
        <Link to={LEGAL_PAGES.refunds.path} className="aaroh-link">Refund Policy</Link> and{' '}
        <Link to={LEGAL_PAGES.shipping.path} className="aaroh-link">Shipping Policy</Link>.
      </p>
    </section>
  );
}

function StatusBadge({ status }: { status: FeatureStatus }) {
  return <span className={`aaroh-status aaroh-status-${status}`}>{STATUS_LABEL[status]}</span>;
}
