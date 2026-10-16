import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import BrandMark from '../components/brand/BrandMark';
import ThemeToggle from '../components/ThemeToggle';
import {
  ArrowDownRight,
  ArrowRight,
  BadgeCheck,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Globe2,
  Instagram,
  Layers3,
  Linkedin,
  Mail,
  MapPin,
  Menu,
  MessageCircle,
  MoveUpRight,
  Nfc,
  Palette,
  Phone,
  Play,
  QrCode,
  Search,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Star,
  UserRound,
  X,
  Zap,
} from 'lucide-react'
import {
  WHATSAPP_NUMBER,
  CUSTOMIZATION_PASS_PRICE,
  cardArt,
  cardDesignNames,
  digitalPlans,
  faqsFor,
  featuresFor,
  howItWorksFor,
  materialLabels,
  products,
  siteContent,
  tierLabels,
  type DigitalPlan,
  type DigitalPlanId,
  type MaterialId,
  type Product,
  type ProductId,
  type TierId,
} from '../data/shygonTapData'
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { SITE_URL } from "../lib/site";
import { aarohVariant, cardPriceIndex, fetchCatalog, rupees } from "../services/catalog";
import { useCatalog } from '../hooks/useCatalog'
import { AAROH_EDITIONS, AAROH_FINISHES, AAROH_IMAGE_SIZE_SMALL, AAROH_PRODUCT_PATH, aarohImages, designPath } from '../data/aaroh'
import { homeMeta, LEGAL_PAGES, productPath } from "../seo/meta";
import { usePageMeta } from "../seo/usePageMeta";
import { editionAvailability, useEditions } from "../lib/editions";
import { CARD_SALES_OPEN, TIERS_PATH } from '../lib/commerce'
import CardsComingSoon from '../components/CardsComingSoon'
import AarohHero from '../components/aaroh/AarohHero'
import '../styles/aaroh.css'

const HOME_META = homeMeta(SITE_URL, { cardSales: CARD_SALES_OPEN })

const currency = (value: number) => value === 0 ? 'Free' : `₹${value.toLocaleString('en-IN')}`

/**
 * Live prices from the `products` table, with the static copy in
 * `shygonTapData` as the fallback when the catalog cannot be reached.
 *
 * The database is the source of truth for money, and the server re-prices every
 * order from the same table at checkout — so this only ever affects what a
 * visitor is SHOWN, never what they are charged. Showing a stale number is
 * still worth avoiding, which is why this exists.
 */
function useLivePrices() {
  const [cards, setCards] = useState<Map<string, number>>(new Map())
  const [experiences, setExperiences] = useState<Map<string, number>>(new Map())
  const [lifetime, setLifetime] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchCatalog()
      .then((catalog) => {
        if (cancelled) return
        setCards(cardPriceIndex(catalog))
        setExperiences(new Map(catalog.experiences.map((item) => [item.id, item.priceInPaise])))
        setLifetime(catalog.pass?.priceInPaise ?? null)
      })
      .catch(() => {
        /* the storefront still renders from its own copy */
      })
    return () => { cancelled = true }
  }, [])

  return useMemo(() => ({
    /** Rupees for a card configuration, or the static price when unknown. */
    card: (product: Product, tier: TierId, material: MaterialId) => {
      const paise = cards.get(`${product.id}-${tier}-${material}`)
      return paise === undefined ? product.pricing[tier][material] : Math.round(paise / 100)
    },
    experience: (plan: DigitalPlan) => {
      const paise = experiences.get(plan.id)
      return paise === undefined ? plan.price : Math.round(paise / 100)
    },
    lifetime: lifetime === null ? CUSTOMIZATION_PASS_PRICE : Math.round(lifetime / 100),
  }), [cards, experiences, lifetime])
}

/**
 * A signed-in customer goes straight to checkout; anyone else signs in first and
 * is returned there by the auth page, which reads the same pending selection.
 */
async function continueToCheckout(navigate: (to: string) => void) {
  try {
    const { data } = await supabase.auth.getSession()
    navigate(data.session ? '/shygontap/checkout' : '/shygontap/auth')
  } catch {
    navigate('/shygontap/auth')
  }
}

/** The builder selection saved on the visitor's last visit, if it is still readable. */
function readSavedSelection(): Partial<{
  productId: ProductId
  material: MaterialId
  tier: TierId
  planId: DigitalPlanId
}> {
  try {
    const raw = localStorage.getItem('shygon_builder_selection')
    return raw ? JSON.parse(raw) : {}
  } catch {
    // Unparseable or unavailable storage: fall back to the defaults rather than
    // leaving a broken value in place.
    try { localStorage.removeItem('shygon_builder_selection') } catch { /* private mode */ }
    return {}
  }
}

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <a className="brand" href="#home" aria-label="Shygon Tap home">
      <span className="brand-mark brand-mark-logo" aria-hidden="true"><BrandMark /></span>
      <span className="brand-copy">
        <strong>SHYGON <em>TAP</em></strong>
        {!compact && <small>by Shygon Technologies</small>}
      </span>
    </a>
  )
}

function Header() {
  const [open, setOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [loggedIn, setLoggedIn] = useState(false)
  const [cartCount, setCartCount] = useState(() => localStorage.getItem('shygon_pending_order') ? 1 : 0)
  const [scrolled, setScrolled] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const links = [
    ['Cards', 'cards'], ['Designs', 'design-collection'], ['AAROH', 'aaroh'], ['Digital Experience', 'digital-experience'],
    ['How It Works', 'how-it-works'], ['About', 'about'],
  ]

  useEffect(() => {
    let active = true
    supabase.auth.getUser().then(({ data }) => { if (active) setLoggedIn(!!data.user) })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setLoggedIn(!!session?.user))
    const syncCart = () => setCartCount(localStorage.getItem('shygon_pending_order') ? 1 : 0)
    const onScroll = () => setScrolled(window.scrollY > 8)
    window.addEventListener('shygon-cart-updated', syncCart)
    window.addEventListener('storage', syncCart)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { active = false; listener.subscription.unsubscribe(); window.removeEventListener('shygon-cart-updated', syncCart); window.removeEventListener('storage', syncCart); window.removeEventListener('scroll', onScroll) }
  }, [])

  useEffect(() => { if (searchOpen) searchInputRef.current?.focus() }, [searchOpen])

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault()
    const q = search.trim().toLowerCase()
    setSearchOpen(false)
    if (!q) return scrollToId('cards')
    const match = products.find((item) => `${item.name} ${item.description}`.toLowerCase().includes(q))
    const edition = match ? undefined : AAROH_EDITIONS.find((item) => `aaroh ${item.title} ${item.character} ${item.description}`.toLowerCase().includes(q))
    setSearch('')
    if (edition) return navigate(designPath(edition))
    if (match) { scrollToId('cards'); window.setTimeout(() => document.getElementById(`product-${match.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250) }
    else scrollToId('cards')
  }

  return <>
    <header className={`site-header ${scrolled ? 'site-header-scrolled' : ''}`}>
      <div className="nav-shell">
        <Logo compact />
        <nav className="desktop-nav" aria-label="Primary">
          {links.map(([label, id]) => <a key={id} href={`#${id}`}>{label}</a>)}
          <Link to="/shygontap/store">Shop</Link>
        </nav>
        <div className="nav-utility">
          <ThemeToggle />
          <button className={`nav-icon-btn ${searchOpen ? 'is-active' : ''}`} aria-label={searchOpen ? 'Close search' : 'Search'} aria-expanded={searchOpen} onClick={() => setSearchOpen(v => !v)}>
            {searchOpen ? <X size={17} /> : <Search size={17} />}
          </button>
          <div className="account-menu-wrap">
            <button className="nav-icon-btn" aria-label={loggedIn ? 'Your account' : 'Sign in'} onClick={() => loggedIn ? navigate('/shygontap/account') : setAccountOpen(v => !v)}>
              <UserRound size={17} />
            </button>
            {accountOpen && !loggedIn && <div className="account-popover"><strong>Welcome to Shygon Tap</strong><p>Sign in to keep your cart, profile and orders together.</p><button className="button" onClick={() => navigate('/shygontap/auth')}>Sign in</button><button className="popover-link" onClick={() => navigate('/shygontap/auth')}>Create your Shygon account</button></div>}
          </div>
          <button className="nav-icon-btn nav-cart" aria-label={`Cart, ${cartCount} item${cartCount === 1 ? '' : 's'}`} onClick={() => window.dispatchEvent(new Event('shygon-open-cart'))}>
            <ShoppingCart size={17} />
            {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
          </button>
        </div>
        <button className="menu-button" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button>
      </div>
      <div className={`nav-search-bar ${searchOpen ? 'is-open' : ''}`}>
        <form className="container nav-search-inner" onSubmit={submitSearch} role="search">
          <Search size={17} aria-hidden="true" />
          <input ref={searchInputRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search Shygon Tap — cards, materials, digital experiences" aria-label="Search Shygon Tap" />
          <button type="button" className="nav-search-close" aria-label="Close search" onClick={() => setSearchOpen(false)}><X size={16} /></button>
        </form>
      </div>
      {open && <nav className="mobile-nav" aria-label="Mobile navigation">
        {links.map(([label, id]) => <a key={id} href={`#${id}`} onClick={() => setOpen(false)}>{label}<ArrowDownRight size={17} /></a>)}
        <Link to="/shygontap/store" onClick={() => setOpen(false)}>Shop all cards<ArrowDownRight size={17} /></Link>
        <button type="button" className="mobile-nav-action" onClick={() => { setOpen(false); navigate(loggedIn ? '/shygontap/account' : '/shygontap/auth') }}>{loggedIn ? 'Your account' : 'Sign in'}<ArrowDownRight size={17} /></button>
        <button type="button" className="mobile-nav-action" onClick={() => { setOpen(false); navigate(loggedIn ? '/shygontap/orders' : '/shygontap/auth') }}>Orders<ArrowDownRight size={17} /></button>
        <button className="button" onClick={() => { setOpen(false); scrollToId('builder') }}>Configure your Tap</button>
      </nav>}
    </header>
  </>
}
function TiltCard({ src, alt, className = '' }: { src: string; alt: string; className?: string }) {
  const frameRef = useRef<HTMLDivElement>(null)

  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - bounds.left) / bounds.width - 0.5
    const y = (event.clientY - bounds.top) / bounds.height - 0.5
    event.currentTarget.style.setProperty('--rotate-x', `${-y * 10}deg`)
    event.currentTarget.style.setProperty('--rotate-y', `${x * 14}deg`)
    event.currentTarget.style.setProperty('--shine-x', `${(x + 0.5) * 100}%`)
    event.currentTarget.style.setProperty('--shine-y', `${(y + 0.5) * 100}%`)
  }

  const reset = () => {
    frameRef.current?.style.setProperty('--rotate-x', '0deg')
    frameRef.current?.style.setProperty('--rotate-y', '0deg')
  }

  return (
    <div ref={frameRef} className={`tilt-card ${className}`} onPointerMove={move} onPointerLeave={reset}>
      <div className="tilt-card-inner">
        <img src={src} alt={alt} draggable={false} />
        <span className="card-shine" aria-hidden="true" />
      </div>
    </div>
  )
}

/**
 * The home hero: SHYGON AAROH, the store's flagship preview (owner,
 * 2026-10-16). The owner's copy sits beside the hero card, which plays the
 * AAROH intro. Nothing about AAROH is priced or sold yet; SHYGON TAP V5 is one
 * press away, and the rest of the page is V5's, unchanged.
 */
function Hero() {
  const navigate = useNavigate()
  return (
    <section className="hero hero-aaroh aaroh-store" id="home" aria-labelledby="home-title">
      <div className="hero-grid" aria-hidden="true" />
      <div className="container hero-layout">
        <div className="hero-copy reveal-up">
          {!CARD_SALES_OPEN && <p className="aaroh-preview-badge">Coming soon</p>}
          <h1 id="home-title" className="hero-aaroh-title">SHYGON AAROH</h1>
          <p className="eyebrow hero-aaroh-tagline">VERSION 01 · ONE CARD. MORE POSSIBILITIES.</p>
          <p className="hero-subtitle">A physical card, connected to a digital experience powered by SHYGON OS.</p>
          {!CARD_SALES_OPEN && <p className="hero-aaroh-price"><strong>Pricing announced when card sales open.</strong></p>}
          <p className="hero-description">Explore the collection, discover the planned capabilities, and preview the AAROH experience.</p>
          <div className="hero-actions">
            <Link className="button" to={AAROH_PRODUCT_PATH}>Explore the collection <ArrowRight size={18} /></Link>
            <Link className="button button-secondary" to={designPath(AAROH_EDITIONS[0]!)}>Preview the experience</Link>
          </div>
          <div className="hero-proof">
            <span><BadgeCheck size={15} /> No app required</span>
            <span><Zap size={15} /> Opens instantly</span>
            <button type="button" className="hero-aaroh-v5" onClick={() => scrollToId('cards')}><Nfc size={15} /> Shop SHYGON TAP V5 <ArrowDownRight size={15} /></button>
          </div>
        </div>
        <div className="hero-aaroh-stage reveal-scale">
          <AarohHero onOpen={(edition) => navigate(designPath(edition))} headingId="home-title" />
        </div>
      </div>
      <button className="scroll-cue" onClick={() => scrollToId('cards')} aria-label="Scroll to cards">
        <span>DISCOVER</span><ChevronDown size={18} />
      </button>
    </section>
  )
}

function StoreBenefits() {
  return <section className="store-benefits"><div className="container store-benefits-grid">
    <div><BadgeCheck size={25}/><div><strong>Secure payments</strong><span>Protected Razorpay checkout</span></div></div>
    {CARD_SALES_OPEN
      ? <div><ShoppingBag size={25}/><div><strong>Made for delivery</strong><span>Track your Tap order</span></div></div>
      : <div><ShoppingBag size={25}/><div><strong>Ready once you pay</strong><span>Edit and publish your Tap</span></div></div>}
    <div><Sparkles size={25}/><div><strong>Upgrade anytime</strong><span>Change your digital UI later</span></div></div>
    <div><MessageCircle size={25}/><div><strong>Human support</strong><span>Talk to the Shygon team</span></div></div>
  </div></section>
}

function ProductCollection({ onChoose, onDetails, prices }: { onChoose: (id: ProductId) => void; onDetails: (product: Product) => void; prices: ReturnType<typeof useLivePrices> }) {
  const editions = useEditions()
  return (
    <section className="section collection" id="cards">
      <div className="container">
        <div className="section-heading split-heading">
          <div><p className="eyebrow"><span className="story-index">02</span> {siteContent.collection.eyebrow}</p><h2>{siteContent.collection.title}</h2></div>
          <p>{siteContent.collection.description}</p>
        </div>
        <div className="product-grid">
          {products.filter((item) => item.collection !== 'design').map((product, index) => (
            <article id={`product-${product.id}`} className={`product-card product-card-${index + 1}`} key={product.id}>
              <div className="product-card-image">
                <span className="product-index">0{index + 1}</span>
                <TiltCard src={cardArt(product, 'pvc')} alt={`${product.name} NFC card, ${cardDesignNames[product.id]} design`} />
                <span className="starting-price">from {currency(prices.card(product, 'standard', 'pvc'))}</span>
              </div>
              <div className="product-card-copy">
                <p className="mini-label">{product.eyebrow}</p>
                <h3>{product.name}</h3>
                <p className="edition-note">Limited · {editionAvailability(editions, product.id) ?? 'numbered in chapters of 100'}</p>
                <p>{product.shortDescription}</p>
                <div className="material-dots" aria-label="Available in PVC, metal and transparent">
                  <i className="pvc" /><i className="metal" /><i className="clear" /><span>3 materials · 2 finishes</span>
                </div>
                <div className="card-actions">
                  <button className="text-button" onClick={() => onDetails(product)}>View details <MoveUpRight size={15} /></button>
                  <button className="round-button" onClick={() => { onChoose(product.id); scrollToId('builder') }} aria-label={`Choose ${product.name}`}><ShoppingCart size={17}/></button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

/** The six Design Collection cards: textured, numbered, sold like any other card. */
function DesignCollection({ onChoose, prices }: { onChoose: (id: ProductId) => void; prices: ReturnType<typeof useLivePrices> }) {
  const editions = useEditions()
  const designs = products.filter((item) => item.collection === 'design')
  return (
    <section className="section design-collection" id="design-collection">
      <div className="container">
        <div className="section-heading split-heading">
          <div><p className="eyebrow">THE DESIGN COLLECTION</p><h2>Six more cards. Every one numbered.</h2></div>
          <p>Smoke, marble, carbon, sandstone, sapphire and aurora — each with the SHYGON ribbon pressed into its surface, in PVC, metal or transparent.</p>
        </div>
        <ul className="design-grid">
          {designs.map((product) => (
            <li key={product.id} className="design-tile">
              <Link to={productPath(product)} className="design-tile-art" aria-label={`${product.name}, see details`}>
                <img src={cardArt(product, 'pvc')} alt="" loading="lazy" />
                <img className="design-tile-alt" src={cardArt(product, 'metal', 'premium')} alt="" loading="lazy" />
              </Link>
              <div className="design-tile-copy">
                <p className="edition-note">Limited · {editionAvailability(editions, product.id) ?? 'chapters of 100'}</p>
                <h3>{cardDesignNames[product.id]}</h3>
                <p>{product.shortDescription}</p>
                <div className="design-tile-foot">
                  <span>from {currency(prices.card(product, 'standard', 'pvc'))}</span>
                  <button className="text-button" onClick={() => { onChoose(product.id); scrollToId('builder') }}>
                    Build this card <ArrowRight size={15} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/**
 * SHYGON Version 1 — AAROH (DEC-2026-037): the premium card, sold beside the
 * SHYGON TAP V5 cards. Each tile shows the Standard print and, on hover, the
 * Premium Finish of the same edition. No price before card sales open; then
 * prices come from the catalogue (migration 027), with the display fallback.
 */
function AarohCollection() {
  const catalog = useCatalog()
  const [standard] = AAROH_FINISHES
  return (
    <section className="section design-collection" id="aaroh">
      <div className="container">
        <div className="section-heading split-heading">
          <div><p className="eyebrow">SHYGON AAROH · VERSION 01{CARD_SALES_OPEN ? '' : ' · COMING SOON'}</p><h2>One card. More possibilities.</h2></div>
          <p>A physical card, connected to a digital experience powered by SHYGON OS, in ten editions.{CARD_SALES_OPEN ? '' : ' Pricing announced when card sales open.'} <Link to={AAROH_PRODUCT_PATH} className="text-button">Explore the collection <ArrowRight size={15} /></Link></p>
        </div>
        <ul className="design-grid">
          {AAROH_EDITIONS.map((edition) => {
            const listed = aarohVariant(catalog, edition.id, standard!.id)
            return (
              <li key={edition.id} className="design-tile">
                <Link to={designPath(edition)} className="design-tile-art" aria-label={`AAROH ${edition.title}, see details`}>
                  <img src={aarohImages(edition, 'standard').frontSmall} alt="" loading="lazy" {...AAROH_IMAGE_SIZE_SMALL} />
                  <img className="design-tile-alt" src={aarohImages(edition, 'premium').frontSmall} alt="" loading="lazy" {...AAROH_IMAGE_SIZE_SMALL} />
                </Link>
                <div className="design-tile-copy">
                  <p className="edition-note">Edition {edition.number} · numbered in chapters of 100</p>
                  <h3>AAROH {edition.title}</h3>
                  <p>{edition.character}</p>
                  <div className="design-tile-foot">
                    <span>{CARD_SALES_OPEN ? `from ${listed ? rupees(listed.priceInPaise) : currency(standard!.price)}` : 'Pricing at launch'}</span>
                    <Link className="text-button" to={designPath(edition)}>
                      View edition <ArrowRight size={15} />
                    </Link>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

function ProductDetailModal({ product, onClose, onChoose, prices }: { product: Product; onClose: () => void; onChoose: (id: ProductId) => void; prices: ReturnType<typeof useLivePrices> }) {
  const [material, setMaterial] = useState<MaterialId>('metal')
  const [face, setFace] = useState<'front' | 'back'>('front')
  return (
    <div className="product-detail-modal" role="dialog" aria-modal="true" aria-label={`${product.name} details`}>
      <button className="modal-close product-detail-close" onClick={onClose} aria-label="Close product details"><X /></button>
      <div className="product-detail-card">
        <div className="product-detail-gallery">
          <div className="product-detail-main"><TiltCard key={`${material}-${face}`} className="card-art-swap" src={cardArt(product, material, 'standard', face)} alt={`${product.name} ${materialLabels[material]} card, ${face}`} /></div>
          <div className="product-detail-thumbs">
            {(Object.keys(materialLabels) as MaterialId[]).map((id) => (
              <button key={id} className={material === id && face === 'front' ? 'active' : ''} aria-pressed={material === id && face === 'front'} onClick={() => { setMaterial(id); setFace('front') }}>
                <img src={cardArt(product, id)} alt="" />
                <span>{materialLabels[id]}</span>
              </button>
            ))}
            <button className={face === 'back' ? 'active' : ''} aria-pressed={face === 'back'} onClick={() => setFace(face === 'back' ? 'front' : 'back')}>
              <img src={cardArt(product, material, 'standard', 'back')} alt="" />
              <span>Back</span>
            </button>
          </div>
        </div>
        <div className="product-detail-copy">
          <p className="eyebrow">{product.eyebrow}</p>
          <h2>{product.name}</h2>
          <p className="product-detail-description">{product.description}</p>
          <div className="detail-price-row"><span>Starting from</span><strong>{currency(prices.card(product, 'standard', 'pvc'))}</strong></div>
          <div className="detail-features">
            {product.features.map((feature) => <div key={feature}><Check size={16} />{feature}</div>)}
          </div>
          <div className="detail-material-note"><Layers3 size={17} /><span><strong>{cardDesignNames[product.id]}</strong> design in <strong>{materialLabels[material]}</strong> · {currency(prices.card(product, 'standard', material))} standard, {currency(prices.card(product, 'premium', material))} premium.</span></div>
          <button className="button detail-choose" onClick={() => { onChoose(product.id); onClose(); scrollToId('builder') }}>Choose this card <ArrowRight size={18} /></button>
          <button className="detail-secondary" onClick={() => { onClose(); scrollToId('builder') }}>Compare all options</button>
        </div>
      </div>
    </div>
  )
}

/** "₹899 · +₹300": the finish's card price, and the difference from the current one. */
function finishDetail(price: number, current: number, selected: boolean) {
  if (selected || price === current) return currency(price)
  const diff = price - current
  return `${currency(price)} · ${diff > 0 ? '+' : '−'}${currency(Math.abs(diff))}`
}

function ChoiceButton({ selected, onClick, children, detail }: { selected: boolean; onClick: () => void; children: React.ReactNode; detail?: string }) {
  return (
    <button className={`choice-button ${selected ? 'selected' : ''}`} onClick={onClick} aria-pressed={selected}>
      <span>{children}</span>{detail && <small>{detail}</small>}{selected && <Check size={15} />}
    </button>
  )
}

function OrderButton({ product, material, tier, plan, physicalPrice, total }: { product: Product; material: MaterialId; tier: TierId; plan: DigitalPlan; physicalPrice: number; total: number }) {
  // Card sales are closed in the V6 release candidate (D-10): no cart, no
  // checkout, and the digital Tap offered instead.
  if (!CARD_SALES_OPEN) return <CardsComingSoon className="commerce-coming-soon" />
  return <CardOrderButtons product={product} material={material} tier={tier} plan={plan} physicalPrice={physicalPrice} total={total} />
}

function CardOrderButtons({ product, material, tier, plan, physicalPrice, total }: { product: Product; material: MaterialId; tier: TierId; plan: DigitalPlan; physicalPrice: number; total: number }) {
  const navigate = useNavigate()
  const save = () => {
    // A SELECTION, not a price. Checkout re-reads every amount from the catalog
    // and /api/create-order prices the order again server-side, so nothing
    // written here can change what the customer is charged.
    const pendingOrder = { orderType: 'physical', productId: product.id, material, tier, planId: plan.id, physicalPrice, digitalPrice: plan.price, total }
    localStorage.setItem('shygon_pending_order', JSON.stringify(pendingOrder))
    localStorage.setItem('shygon_builder_selection', JSON.stringify({ productId: product.id, material, tier, planId: plan.id }))
    window.dispatchEvent(new Event('shygon-cart-updated'))
  }
  return <div className="commerce-buy-actions">
    <button className="add-cart-button" onClick={() => save()}><ShoppingCart size={17}/> Add to Cart</button>
    <button className="button buy-now-button" onClick={() => { save(); void continueToCheckout(navigate) }}><Zap size={16}/> Buy Now</button>
  </div>
}

function ProductCardShowroom({ selectedId, material, tier, onSelect }: {
  selectedId: ProductId
  material: MaterialId
  tier: TierId
  onSelect: (id: ProductId) => void
}) {
  const deckRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; startX: number; startedAt: number; moved: boolean; cardId: ProductId | null } | null>(null)
  const suppressClickRef = useRef(false)
  const wheelRef = useRef({ delta: 0, lastEventAt: 0, lastStepAt: 0, lastVerticalAt: 0 })
  const [dragOffset, setDragOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [offsetStep, setOffsetStep] = useState(42)
  const selectedIndex = Math.max(0, products.findIndex((item) => item.id === selectedId))
  const total = products.length

  useEffect(() => {
    const deck = deckRef.current
    if (!deck) return
    const updateOffsetStep = () => setOffsetStep(Math.min(56, Math.max(30, deck.clientWidth * 0.115)))
    updateOffsetStep()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateOffsetStep)
      return () => window.removeEventListener('resize', updateOffsetStep)
    }
    const observer = new ResizeObserver(updateOffsetStep)
    observer.observe(deck)
    return () => observer.disconnect()
  }, [])

  const selectOffset = useCallback((offset: number) => {
    const nextIndex = (selectedIndex + offset + total) % total
    onSelect(products[nextIndex]!.id)
  }, [onSelect, selectedIndex, total])

  const selectIndex = (index: number) => {
    onSelect(products[(index + total) % total]!.id)
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
    // Side cards sit behind the deck's own plane (translateZ < 0), so the event
    // target is the deck even when a side card is under the finger. Take the
    // frontmost card at the point instead. Cut-out cards only count where the
    // card image is (see .is-cutout in index.css).
    const cardTarget = document.elementsFromPoint(event.clientX, event.clientY)
      .map((el) => el.closest<HTMLButtonElement>('.product-showroom-card'))
      .find((el) => el !== null && event.currentTarget.contains(el)) ?? null
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startedAt: performance.now(),
      moved: false,
      cardId: products.find((item) => item.id === cardTarget?.dataset.productId)?.id ?? null,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const delta = event.clientX - drag.startX
    if (Math.abs(delta) > 7) {
      drag.moved = true
      setIsDragging(true)
      setDragOffset(Math.max(-116, Math.min(116, delta)))
    }
  }

  const finishPointer = (event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null

    const delta = event.clientX - drag.startX
    const elapsed = Math.max(1, performance.now() - drag.startedAt)
    const velocity = Math.abs(delta) / elapsed
    const shouldMove = !cancelled && (Math.abs(delta) >= 48 || (drag.moved && Math.abs(delta) >= 20 && velocity > 0.55))

    if (shouldMove) {
      const momentumSteps = Math.abs(delta) > 170 && velocity > 0.9 ? 2 : 1
      selectOffset(delta < 0 ? momentumSteps : -momentumSteps)
    } else if (!cancelled && drag.cardId) {
      onSelect(drag.cardId)
    }

    if (drag.moved) {
      suppressClickRef.current = true
      window.setTimeout(() => { suppressClickRef.current = false }, 0)
    }
    setDragOffset(0)
    setIsDragging(false)
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => finishPointer(event)

  const handleWheel = useCallback((event: WheelEvent) => {
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerWidth : 1
    const deltaX = event.deltaX * scale
    const deltaY = event.deltaY * scale
    const horizontal = Math.abs(deltaX) > Math.abs(deltaY) * 1.15
      ? deltaX
      : event.shiftKey ? deltaY : 0
    const now = performance.now()
    const wheel = wheelRef.current
    // A trackpad's vertical page scroll ends with a tail of tiny sideways
    // deltas; summed, they switched cards while the visitor was only
    // scrolling past. Ignore sideways jitter, and sideways input just after
    // vertical scrolling. Shift+wheel is always a deliberate horizontal gesture.
    if (!horizontal) {
      if (Math.abs(deltaY) > 0) wheel.lastVerticalAt = now
      return
    }
    if (!event.shiftKey && (Math.abs(deltaX) < 2 || now - wheel.lastVerticalAt < 300)) return

    event.preventDefault()
    if (now - wheel.lastEventAt > 170) wheel.delta = 0
    wheel.delta += horizontal
    wheel.lastEventAt = now

    if (Math.abs(wheel.delta) < 34 || now - wheel.lastStepAt < 420) return
    const momentumSteps = Math.abs(wheel.delta) > 150 ? 2 : 1
    // Scrolling right (deltaX > 0, or Shift+wheel down) moves to the next card,
    // as in any horizontal scroller and matching a leftward drag.
    selectOffset(wheel.delta > 0 ? momentumSteps : -momentumSteps)
    wheel.lastStepAt = now
    wheel.delta = 0
  }, [selectOffset])

  useEffect(() => {
    const deck = deckRef.current
    if (!deck) return
    deck.addEventListener('wheel', handleWheel, { passive: false })
    return () => deck.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  // Roving tabindex: only the selected card is tabbable, so after a keyboard
  // move focus has to follow it — otherwise it stays on a card that is no
  // longer selected and Enter re-selects the previous one.
  const focusSelectedRef = useRef(false)
  useEffect(() => {
    if (!focusSelectedRef.current) return
    focusSelectedRef.current = false
    deckRef.current?.querySelector<HTMLButtonElement>('.product-showroom-card.is-selected')?.focus()
  }, [selectedIndex])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      focusSelectedRef.current = true
      selectOffset(-1)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusSelectedRef.current = true
      selectOffset(1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusSelectedRef.current = true
      selectIndex(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusSelectedRef.current = true
      selectIndex(total - 1)
    }
  }

  return (
    <div className={`product-showroom${isDragging ? ' is-dragging' : ''}`}>
      <div
        ref={deckRef}
        className="product-showroom-deck"
        role="group"
        aria-label="Choose a physical Shygon Tap card"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={(event) => finishPointer(event, true)}
        onKeyDown={handleKeyDown}
      >
        {products.map((item, index) => {
          let offset = (index - selectedIndex + total) % total
          if (offset > total / 2) offset -= total
          const depth = Math.abs(offset)
          const isSelected = offset === 0
          const x = offset * offsetStep + dragOffset * (isSelected ? 1 : 0.12)
          const y = depth * 5
          const z = -depth * 104
          const scale = 1 - Math.min(depth * 0.12, 0.27)
          const rotateY = offset * -11
          const rotateZ = offset * 2.2
          const src = cardArt(item, material, tier)
          // The card art is a transparent cut-out: it floats, with no frame.
          const isCutout = true

          return (
            <button
              key={item.id}
              type="button"
              className={`product-showroom-card${isSelected ? ' is-selected' : ''}${isCutout ? ' is-cutout' : ''}`}
              data-product-id={item.id}
              style={{
                transform: `translate3d(calc(-50% + ${x}px), calc(-50% + ${y}px), ${z}px) rotateY(${rotateY}deg) rotateZ(${rotateZ}deg) scale(${scale})`,
                zIndex: 10 - depth,
                opacity: 1 - Math.min(depth * 0.19, 0.44),
              }}
              aria-label={`Select ${item.name}`}
              aria-pressed={isSelected}
              tabIndex={isSelected ? 0 : -1}
              onClick={(event) => {
                if (suppressClickRef.current) {
                  event.preventDefault()
                  event.stopPropagation()
                  suppressClickRef.current = false
                  return
                }
                onSelect(item.id)
              }}
              onDragStart={(event) => event.preventDefault()}
            >
              <img src={src} alt="" draggable={false} />
              <span className="product-showroom-reflection" aria-hidden="true" />
            </button>
          )
        })}
      </div>

      <div className="product-showroom-controls" aria-label="Card selection controls">
        <button type="button" className="product-showroom-arrow" onClick={() => selectOffset(-1)} aria-label="Previous card">
          <ChevronLeft size={17} />
        </button>
        <div className="product-showroom-pagination" role="group" aria-label="Choose a card">
          {products.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={index === selectedIndex ? 'is-active' : ''}
              aria-label={`Show ${item.name}`}
              aria-current={index === selectedIndex ? 'true' : undefined}
              onClick={() => selectIndex(index)}
            />
          ))}
        </div>
        <span className="product-showroom-count" aria-live="polite" aria-atomic="true">
          {String(selectedIndex + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
        </span>
        <button type="button" className="product-showroom-arrow" onClick={() => selectOffset(1)} aria-label="Next card">
          <ChevronRight size={17} />
        </button>
      </div>
    </div>
  )
}

function Configurator({
  productId,
  onProduct,
  material,
  onMaterial,
  tier,
  onTier,
  planId,
  onPlan,
  onDemo,
}: {
  productId: ProductId
  onProduct: (value: ProductId) => void
  material: MaterialId
  onMaterial: (value: MaterialId) => void
  tier: TierId
  onTier: (value: TierId) => void
  planId: DigitalPlanId
  onPlan: (value: DigitalPlanId) => void
  onDemo: (plan: DigitalPlan) => void
}) {
  const navigate = useNavigate()
  const prices = useLivePrices()
  const editions = useEditions()
  const product = products.find((item) => item.id === productId) ?? products[0]!
  const plan = digitalPlans.find((item) => item.id === planId) ?? digitalPlans[0]!
  const physicalPrice = prices.card(product, tier, material)
  const planPrice = prices.experience(plan)
  const total = physicalPrice + planPrice

  return (
    <section className="section builder-section" id="builder">
      <div className="container">
        <div className="section-heading builder-heading">
          <p className="eyebrow"><span className="story-index">03</span> {siteContent.builder.eyebrow}</p>
          <h2>{siteContent.builder.title}</h2>
          <p>{siteContent.builder.description}</p>
        </div>
        <div className="builder-layout">
          <div className="builder-product-stage">
            <div className="liquid-glass liquid-glass-one liquid-glass-contained" aria-hidden="true" />
            <div className="stage-number">01 · PHYSICAL CARD</div>
            <div className={`material-backdrop material-${material}`} />
            <ProductCardShowroom selectedId={productId} material={material} tier={tier} onSelect={onProduct} />
            <div className="stage-caption">
              <span>{materialLabels[material]} · {tierLabels[tier]}</span>
              <strong>{product.name}</strong>
              <small>Card {String(products.findIndex((item) => item.id === productId) + 1).padStart(2, '0')} of {String(products.length).padStart(2, '0')}</small>
            </div>
          </div>

          <div className="builder-controls">
            <div className="config-block">
              <div className="config-title"><span>01</span><div><small>PRODUCT</small><h3>Choose your card</h3></div></div>
              <p className="showroom-selection-hint">Drag the card, swipe, use your trackpad, or tap the arrows to explore the collection.</p>
            </div>
            <div className="config-block">
              <div className="config-title"><span>02</span><div><small>PHYSICAL CARD</small><h3>Choose your material</h3></div></div>
              <div className="choice-grid">
                {(Object.keys(materialLabels) as MaterialId[]).map((id) => (
                  <ChoiceButton key={id} selected={material === id} onClick={() => onMaterial(id)} detail={currency(prices.card(product, tier, id))}>{materialLabels[id]}</ChoiceButton>
                ))}
              </div>
            </div>
            <div className="config-block">
              <div className="config-title"><span>03</span><div><small>CARD FINISH</small><h3>Standard or Premium</h3></div></div>
              <div className="choice-grid choice-grid-two">
                {(Object.keys(tierLabels) as TierId[]).map((id) => (
                  <ChoiceButton key={id} selected={tier === id} onClick={() => onTier(id)} detail={finishDetail(prices.card(product, id, material), prices.card(product, tier, material), tier === id)}>{tierLabels[id]}</ChoiceButton>
                ))}
              </div>
              <p className="onwards-note price-explainer">One card price, set by material and finish together — they are not added up. <strong>{materialLabels[material]} · {tierLabels[tier]}: {currency(physicalPrice)}</strong></p>
            </div>
            <div className="config-block">
              <div className="config-title"><span>04</span><div><small>DIGITAL UI</small><h3>Choose your experience</h3></div></div>
              <div className="choice-grid choice-grid-plans">
                {digitalPlans.map((item) => (
                  <ChoiceButton key={item.id} selected={planId === item.id} onClick={() => { if (planId === item.id && item.id !== 'essential') { onPlan('essential'); return } onPlan(item.id); onDemo(item) }} detail={item.id === 'essential' ? 'Included' : planId === item.id ? `${currency(prices.experience(item))} · tap to remove` : `+${currency(prices.experience(item))}${item.priceSuffix ?? ''}`}>{item.name}</ChoiceButton>
                ))}
              </div>

              <div className="lifetime-customization-card" aria-labelledby="lifetime-customization-title">
                <div className="lifetime-customization-copy">
                  <span className="lifetime-badge">ONE-TIME UPGRADE</span>

<h4 id="lifetime-customization-title">
  Customization Pass — ₹{prices.lifetime.toLocaleString('en-IN')} one-time
</h4>

<p>
  Keep your physical Tap and change your profile whenever you like — without the
  standard one-change-per-14-days limit — plus every colour palette.
</p>
                </div>
                <button
                  type="button"
                  className="lifetime-customization-button"
                  onClick={() => {
                    localStorage.setItem('shygon_pending_order', JSON.stringify({ orderType: 'lifetimeCustomization' }))
                    window.dispatchEvent(new Event('shygon-cart-updated'))
                    void continueToCheckout(navigate)
                  }}
                >
                  Get the Pass · ₹{prices.lifetime.toLocaleString('en-IN')}
                </button>
              </div>

              <div className="lifetime-comparison">
  <div className="lifetime-comparison-heading">
    <div>
      <small>CHOOSE YOUR FLEXIBILITY</small>
      <h4>Included with your Tap, or unlock the Pass</h4>
    </div>
    <span>One-time upgrade · No new card</span>
  </div>
</div>

  <div className="lifetime-option-grid">
    <article className="lifetime-option">
      <span className="lifetime-option-label">INCLUDED</span>
      <h5>Included</h5>
      <strong className="lifetime-option-price">FREE</strong>

      <ul>
        <li><Check size={15} /> Essential digital profile</li>
        <li><Check size={15} /> One profile change every 14 days</li>
        <li><Check size={15} /> 4 colour palettes</li>
        <li><Check size={15} /> Paid experiences available</li>
      </ul>

      <span className="lifetime-option-note">Included with your Tap</span>
    </article>

    <article className="lifetime-option lifetime-option-featured">
      <span className="lifetime-option-label">RECOMMENDED</span>
      <h5>Customization Pass</h5>
      <strong className="lifetime-option-price">
        ₹{prices.lifetime.toLocaleString('en-IN')}
        <small> one-time</small>
      </strong>

      <ul>
        <li><Check size={15} /> Unlimited profile changes</li>
        <li><Check size={15} /> All 12 colour palettes</li>
        <li><Check size={15} /> One-time payment, not a subscription</li>
        <li><Check size={15} /> No new physical card needed</li>
      </ul>

      <button
        type="button"
        className="lifetime-option-button"
        onClick={() => {
          localStorage.setItem(
            'shygon_pending_order',
            JSON.stringify({ orderType: 'lifetimeCustomization' })
          )
          window.dispatchEvent(new Event('shygon-cart-updated'))
          void continueToCheckout(navigate)
        }}
      >
        GET THE PASS — ₹{prices.lifetime.toLocaleString('en-IN')} <ArrowRight size={15} />
      </button>
    </article>
  </div>
</div>
          </div>

          <aside className="order-summary" aria-label="Order summary" aria-live="polite">
  <div className="summary-top">
    <div>
      <small>YOUR SHYGON TAP</small>
      <strong>Live order summary</strong>
    </div>
    <ShoppingBag size={20} />
  </div>

  <dl>
    <div>
      <dt>Physical card</dt>
      <dd>{product.name}</dd>
    </div>

    <div>
      <dt>Material</dt>
      <dd>{materialLabels[material]}</dd>
    </div>

    <div>
      <dt>Finish</dt>
      <dd>{tierLabels[tier]}</dd>
    </div>

    <div>
      <dt>Card design</dt>
      <dd>{cardDesignNames[product.id]}</dd>
    </div>

    <div>
      <dt>Limited edition</dt>
      <dd>{editionAvailability(editions, product.id) ?? 'Numbered, chapters of 100'}</dd>
    </div>

    <div>
      <dt>Digital experience</dt>
      <dd>{plan.name}</dd>
    </div>
  </dl>

  <div className="price-lines">
    <div>
      <span>Card · {materialLabels[material]}, {tierLabels[tier]}</span>
      <strong>{currency(physicalPrice)}</strong>
    </div>

    <div>
      <span>Digital UI · {plan.name}</span>
      <strong>{planPrice === 0 ? 'Included' : `${currency(planPrice)}${plan.priceSuffix ?? ''}`}</strong>
    </div>
  </div>

  <div className="summary-total">
    <span>TOTAL</span>
    <strong key={total}>{currency(total)}{plan.priceSuffix}</strong>
  </div>

  <OrderButton
    product={product}
    material={material}
    tier={tier}
    plan={plan}
    physicalPrice={physicalPrice}
    total={total}
  />

  <button
    className="summary-demo"
    onClick={() => onDemo(plan)}
  >
    <Play size={15} /> Preview {plan.name}
  </button>
</aside>
        </div>
      </div>
    </section>
  )
}

function PhoneProfile({ plan, immersive = false }: { plan: DigitalPlan; immersive?: boolean }) {
  const [tab, setTab] = useState<'profile' | 'work' | 'contact'>('profile')
  const [liked, setLiked] = useState(false)
  const level = digitalPlans.findIndex((item) => item.id === plan.id)

  return (
    <div className={`phone-profile plan-${plan.id} ${immersive ? 'immersive-profile' : ''}`} style={{ '--plan-accent': plan.accent } as React.CSSProperties}>
      <div className="profile-aurora" />
      <div className="phone-status"><span>9:41</span><span>● ● ●</span></div>
      <header className="profile-header">
        <div className="avatar"><span>AS</span><i /></div>
        <p>{plan.id === 'essential' ? 'PROFILE · ESSENTIAL' : plan.id === 'business' ? 'BUSINESS · DIGITAL CARD' : plan.id === 'premium' ? 'CREATOR · PRO EXPERIENCE' : 'IMMERSIVE · 3D EXPERIENCE'}</p>
        <h3>Arjun Sethi</h3>
        <span className="profile-role">{plan.id === 'essential' ? 'A clean digital identity built for instant connection.' : plan.id === 'business' ? 'A professional profile with everything customers need.' : plan.id === 'premium' ? 'A richer profile with motion, work and social proof.' : 'A cinematic, interactive identity made to be remembered.'}</span>
      </header>
      <div className="profile-actions">
        <button onClick={() => setLiked(!liked)} className={liked ? 'active' : ''}><Star size={16} fill={liked ? 'currentColor' : 'none'} /> {liked ? 'Saved' : 'Save'}</button>
        <button><MessageCircle size={16} /> WhatsApp</button>
        <button><Phone size={16} /> Call</button>
      </div>
      <nav className="profile-tabs" aria-label="Demo profile sections">
        {(['profile', 'work', 'contact'] as const).map((item) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>)}
      </nav>
      <div className="profile-scroll">
        {tab === 'profile' && (
          <>
            <section className="demo-about"><small>ABOUT</small><p>{plan.id === 'essential' ? 'Simple information. Clear actions. Zero friction.' : plan.id === 'business' ? 'Everything a customer needs to understand, contact and trust your business.' : plan.id === 'premium' ? 'A premium profile designed to showcase work and convert attention into action.' : plan.id === 'goat' ? 'Motion, depth and interaction turn a normal profile into a memorable digital moment.' : 'Your brand, your sections, your rules — designed specifically for your audience.'}</p></section>
            <section className="demo-action-row">
              <button><Phone size={13}/> Contact</button><button><MessageCircle size={13}/> Share</button><button><ArrowRight size={13}/> Explore</button>
            </section>
            {level >= 1 && <section className="demo-info-grid"><div><Clock3 size={16} /><span>Mon–Sat<br /><strong>10:00–18:30</strong></span></div><div><MapPin size={16} /><span>Based in<br /><strong>Bangalore</strong></span></div></section>}
            {level >= 2 && <section><div className="demo-section-title"><small>SELECTED WORK</small><button>View all</button></div><div className="demo-gallery"><i /><i /><i /></div></section>}
            {level >= 3 && <section className="demo-depth-card"><Layers3 size={25} /><div><small>INTERACTIVE LAYER</small><strong>Drag to explore</strong></div><ArrowRight size={18} /></section>}
          </>
        )}
        {tab === 'work' && (
          <section><div className="demo-section-title"><small>WORK & SERVICES</small><button>4 projects</button></div><div className="service-list"><div><span>01</span><strong>Brand direction</strong></div><div><span>02</span><strong>Digital design</strong></div><div><span>03</span><strong>Creative systems</strong></div></div></section>
        )}
        {tab === 'contact' && (
          <section className="contact-panel"><small>START A CONVERSATION</small><h4>Have a project in mind?</h4><button><Mail size={16} /> hello@arjun.design</button><button><Globe2 size={16} /> arjun.design</button><button><MapPin size={16} /> Bangalore, India</button></section>
        )}
      </div>
      <div className="phone-home" />
    </div>
  )
}

function PhoneFrame({ plan, compact = false }: { plan: DigitalPlan; compact?: boolean }) {
  return (
    <div className={`phone-frame ${compact ? 'phone-compact' : ''}`}>
      <div className="phone-speaker" />
      <PhoneProfile plan={plan} />
      <div className="phone-button phone-button-one" /><div className="phone-button phone-button-two" />
    </div>
  )
}

function DigitalPlans({ selectedId, onSelect, onDemo }: { selectedId: DigitalPlanId; onSelect: (id: DigitalPlanId) => void; onDemo: (plan: DigitalPlan) => void }) {
  const total = digitalPlans.length
  const [activeIndex, setActiveIndex] = useState(() => {
    const found = digitalPlans.findIndex((p) => p.id === selectedId)
    return found >= 0 ? found : 0
  })
  const active = digitalPlans[activeIndex]!

  const step = (delta: number) => setActiveIndex((i) => (i + delta + total) % total)

  const onDeckKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1) }
    if (event.key === 'ArrowRight') { event.preventDefault(); step(1) }
  }

  // Fan order behind the active card — stable, original-catalog order with the
  // active plan pulled out, so which cards peek where never jumps around.
  const behind = digitalPlans.map((_, i) => i).filter((i) => i !== activeIndex)

  return (
    <section className="section digital-section" id="digital-experience">
      <div className="container">
        <div className="section-heading digital-heading">
          <p className="eyebrow"><span className="story-index">04</span> {siteContent.digital.eyebrow}</p>
          <h2>{siteContent.digital.title}</h2>
          <p>{siteContent.digital.description}</p>
        </div>

        <div className="tier-deck-wrap">
          <div className="liquid-glass liquid-glass-one liquid-glass-plans" aria-hidden="true" />

          <div className="tier-deck" role="group" aria-roledescription="carousel" aria-label="Digital experience tiers" tabIndex={0} onKeyDown={onDeckKeyDown}>
            {behind.map((planIndex, order) => {
              const plan = digitalPlans[planIndex]!
              const depth = behind.length - order
              return (
                <article
                  key={plan.id}
                  className="tier-deck-card"
                  style={{ '--tier-accent': plan.accent, '--depth': depth } as React.CSSProperties}
                  aria-hidden="true"
                >
                  <button type="button" className="tier-deck-peek" onClick={() => setActiveIndex(planIndex)} tabIndex={-1}>
                    <span>{plan.name}</span>
                  </button>
                </article>
              )
            })}

            <article className="tier-deck-card is-front" style={{ '--tier-accent': active.accent } as React.CSSProperties}>
              <div className="tier-deck-top">
                <span className="tier-deck-kicker">{active.style}</span>
                <span className="tier-deck-index">0{activeIndex + 1} / 0{total}</span>
              </div>
              <h3>{active.name}</h3>
              <p className="tier-deck-desc">{active.description}</p>
              <ul className="tier-deck-features">
                {active.features.slice(0, 3).map((feature) => <li key={feature}><Check size={13} />{feature}</li>)}
              </ul>
              <div className="tier-deck-footer">
                <div className="tier-deck-price">{currency(active.price)}<small>{active.priceSuffix}</small></div>
                <div className="tier-deck-actions">
                  <button type="button" className="tier-deck-ghost" onClick={() => onDemo(active)}><Play size={14} />{active.demoLabel}</button>
                  <button
                    type="button"
                    className={`tier-deck-select${selectedId === active.id ? ' is-selected' : ''}`}
                    aria-pressed={selectedId === active.id}
                    onClick={() => {
                      // Selecting again removes a paid experience: back to
                      // Essential, which every Tap includes.
                      if (selectedId === active.id) { if (active.id !== 'essential') onSelect('essential'); return }
                      onSelect(active.id); onDemo(active)
                    }}
                    title={selectedId === active.id && active.id !== 'essential' ? 'Remove and go back to Essential (included)' : undefined}
                  >
                    {selectedId === active.id
                      ? active.id === 'essential'
                        ? <><Check size={14} /> Included</>
                        : <><span className="tier-selected-label"><Check size={14} /> Selected</span><span className="tier-remove-label"><X size={14} /> Remove</span></>
                      : 'Select this tier'}
                  </button>
                </div>
              </div>
            </article>
          </div>

          <div className="tier-deck-nav">
            <button type="button" className="tier-deck-arrow" onClick={() => step(-1)} aria-label="Previous tier"><ChevronLeft size={18} /></button>
            <div className="tier-deck-dots">
              {digitalPlans.map((plan, index) => (
                <button
                  key={plan.id}
                  type="button"
                  className={index === activeIndex ? 'active' : ''}
                  aria-label={`Show ${plan.name}`}
                  aria-current={index === activeIndex}
                  onClick={() => setActiveIndex(index)}
                />
              ))}
            </div>
            <button type="button" className="tier-deck-arrow" onClick={() => step(1)} aria-label="Next tier"><ChevronRight size={18} /></button>
          </div>
        </div>
      </div>
    </section>
  )
}

function DemoModal({ plan, onClose, onSelect }: { plan: DigitalPlan; onClose: () => void; onSelect: (id: DigitalPlanId) => void }) {
  // Only GOAT has a tap-to-open sequence worth showing; every other experience
  // opens straight onto the profile, which is the point of them.
  const [stage, setStage] = useState<'ready' | 'scan' | 'connect' | 'profile'>(
    plan.id === 'goat' ? 'ready' : 'profile',
  )

  const startTap = () => {
    setStage('scan')
    window.setTimeout(() => setStage('connect'), 1300)
    window.setTimeout(() => setStage('profile'), 2450)
  }

  return (
    <div className="demo-modal" role="dialog" aria-modal="true" aria-label={`${plan.name} live demo`}>
      <button className="modal-close" onClick={onClose} aria-label="Close demo"><X /></button>
      <div className="demo-modal-copy">
        <p className="eyebrow">LIVE DIGITAL EXPERIENCE</p>
        <h2>{plan.name}</h2>
        <p>{plan.description} Explore the buttons, tabs and scrolling profile inside the phone.</p>
        <div className="demo-instructions"><Smartphone size={18} /><span>Scroll and click inside the live phone preview.</span></div>
        <button className="button" onClick={() => { onSelect(plan.id); onClose(); scrollToId('builder') }}>Make this yours <ArrowRight size={17} /></button>
      </div>
      <div className={`demo-stage demo-stage-${stage}`}>
        {plan.id === 'goat' && stage !== 'profile' ? (
          <div className="nfc-cinema">
            <div className="cinema-phone"><Smartphone size={72} /><span>{stage === 'ready' ? 'TAP YOUR PHONE' : stage === 'scan' ? 'NFC DETECTED' : 'CONNECTING...'}</span></div>
            <div className="cinema-card"><img src={cardArt({ id: 'business' }, 'metal', 'premium')} alt="SHYGON Tap card ready to scan" /><i /><i /><i /></div>
            {stage === 'ready' && <button className="tap-button" onClick={startTap}><Nfc size={21} /> Start tap experience</button>}
          </div>
        ) : (
          <div className="live-phone-wrap">
            <span className="customer-sees">THIS IS WHAT YOUR CUSTOMERS SEE.</span>
            <PhoneFrame plan={plan} />
          </div>
        )}
      </div>
    </div>
  )
}

function Manifesto() {
  return (
    <section className="manifesto" id="about">
      <div className="manifesto-grid" />
      <div className="container manifesto-layout">
        <p><span className="story-index">01</span> {siteContent.message.kicker}</p>
        <h2>{siteContent.message.title}</h2>
        <div className="manifesto-bottom"><p>{siteContent.message.body}</p><div className="manifesto-orb" aria-hidden="true"><Nfc /><span>TAP<br />CONNECT<br />EXPERIENCE</span></div></div>
      </div>
    </section>
  )
}

/** What a step opens into, and where its button takes you: a section of this page, or another page. */
type StepMore = { detail: string; action: string } & ({ target: string } | { path: string })

const HOW_IT_WORKS_MORE: StepMore[] = [
  {
    detail:
      'Four cards made for a job — Business (Obsidian Feather), Restaurant (Copper Lotus), Event (Emerald Arch) and Google Review (Ivory Bloom) — and six Design Collection cards: Obsidian Smoke, Rose Marble, Carbon Aurum, Sandstone Jaali, Sapphire Night and Aurora Glass. Open any card to see it in every material, front and back.',
    action: 'See the cards',
    target: 'cards',
  },
  {
    detail:
      'PVC is light and printed edge to edge. Metal is brushed steel with an etched finish. Transparent is clear acrylic with the NFC antenna visible inside. The Premium finish adds the gold Privé ornament. Material and finish together set one card price.',
    action: 'Pick a material',
    target: 'builder',
  },
  {
    detail:
      'Essential is included with every card. Business, Premium and GOAT add richer profiles and motion — and you can upgrade later from your account, with no new card.',
    action: 'Compare experiences',
    target: 'digital-experience',
  },
  {
    detail:
      'Sign in, add a delivery address with a valid PIN code and pay securely with Razorpay. Your e-bill is ready straight away, and you can follow the order in your account.',
    action: 'Build and order',
    target: 'builder',
  },
  {
    detail:
      'Hold the card near a phone: your profile opens in the browser, no app needed. Phones without NFC can scan the QR code on the back of the card.',
    action: 'Try a live demo',
    target: 'digital-experience',
  },
]

/** The steps while card sales are closed (D-10, V6-089): buying a digital Tap. */
const DIGITAL_FIRST_HOW_IT_WORKS_MORE: StepMore[] = [
  {
    detail:
      'Business, Premium and GOAT add richer profiles and motion. Open a live demo of each before you choose, and buy a higher experience from your account later if you want more.',
    action: 'Compare experiences',
    target: 'digital-experience',
  },
  {
    detail: 'Your account holds your Tap and your orders, and it is where you edit your profile.',
    action: 'Sign up or log in',
    path: '/shygontap/auth',
  },
  {
    detail:
      'Checkout is by Razorpay. Your Tap is ready to edit as soon as the payment is confirmed, and you can follow the order in your account.',
    action: 'Choose your experience',
    path: TIERS_PATH,
  },
  {
    detail:
      'Add your details and links in your account, choose which contact details visitors can see, then publish when you are ready.',
    action: 'Try a live demo',
    target: 'digital-experience',
  },
  {
    detail:
      'Your Tap has its own link and a QR code you can download from your account. Phones open it in the browser, with no app needed. SHYGON NFC cards are coming soon.',
    action: 'See the cards',
    target: 'cards',
  },
]

const HOW_IT_WORKS = CARD_SALES_OPEN
  ? {
      intro: 'From physical card to digital connection in five clear steps.',
      more: HOW_IT_WORKS_MORE,
      icons: [ShoppingBag, Layers3, Smartphone, MessageCircle, Nfc],
    }
  : {
      intro: 'From choosing your experience to sharing your Tap in five clear steps.',
      more: DIGITAL_FIRST_HOW_IT_WORKS_MORE,
      icons: [Smartphone, UserRound, ShoppingBag, Layers3, QrCode],
    }

function HowItWorks() {
  const [open, setOpen] = useState<number | null>(null)
  const navigate = useNavigate()
  return (
    <section className="section how-section" id="how-it-works">
      <div className="container">
        <div className="section-heading split-heading"><div><p className="eyebrow"><span className="story-index">05</span> SIMPLE BY DESIGN</p><h2>HOW IT WORKS</h2></div><p>{HOW_IT_WORKS.intro} Open a step for the details.</p></div>
        <div className="steps-list">
          {howItWorksFor(CARD_SALES_OPEN).map(([number, title, description], index) => {
            const more = HOW_IT_WORKS.more[index]!
            const StepIcon = HOW_IT_WORKS.icons[index]!
            const isOpen = open === index
            return (
              <article key={number} className={isOpen ? 'is-open' : ''}>
                <button
                  type="button"
                  className="step-toggle"
                  aria-expanded={isOpen}
                  aria-controls={`step-more-${number}`}
                  onClick={() => setOpen(isOpen ? null : index)}
                >
                  <span>{number}</span>
                  <div className="step-icon"><StepIcon /></div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                  <ArrowDownRight className="step-arrow" aria-hidden="true" />
                </button>
                <div className="step-more" id={`step-more-${number}`} role="region" aria-label={title} hidden={!isOpen}>
                  <p>{more.detail}</p>
                  <button type="button" className="text-button" onClick={() => ('path' in more ? navigate(more.path) : scrollToId(more.target))}>
                    {more.action} <ArrowRight size={15} />
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function Features() {
  const icons = CARD_SALES_OPEN
    ? [Nfc, Smartphone, Palette, Layers3, Sparkles, MessageCircle]
    : [QrCode, Smartphone, Palette, Nfc, Sparkles, MessageCircle]
  return (
    <section className="section features-section">
      <div className="container features-layout">
        <div className="features-intro"><p className="eyebrow"><span className="story-index">06</span> BUILT DIFFERENTLY</p><h2>More than a card in your wallet.</h2><p>Every detail is designed to move people from a physical moment into a considered digital experience.</p></div>
        <div className="feature-grid">
          {featuresFor(CARD_SALES_OPEN).map(([title, description], index) => {
            const Icon = icons[index] ?? Sparkles
            return <article key={title}><Icon /><span>0{index + 1}</span><h3>{title}</h3><p>{description}</p></article>
          })}
        </div>
      </div>
    </section>
  )
}

function FAQ() {
  const [openIndex, setOpenIndex] = useState(0)

  return (
    <section className="section faq-section">
      <div className="container faq-layout">
        <div className="faq-intro"><p className="eyebrow"><span className="story-index">07</span> QUESTIONS, ANSWERED</p><h2>Everything you need to know before you tap.</h2><p>Still have a question? {CARD_SALES_OPEN ? 'Build a configuration and talk' : 'Talk'} directly with Shygon Technologies on WhatsApp.</p></div>
        <div className="faq-list">
          {faqsFor(CARD_SALES_OPEN).map(([question, answer], index) => {
            const open = openIndex === index
            const panelId = `faq-panel-${index}`
            return (
              <div className="faq-item" key={question}>
                <button
                  type="button"
                  className="faq-summary"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => setOpenIndex(open ? -1 : index)}
                >
                  <span>{question}</span>
                  <i className={open ? 'is-open' : ''}><ChevronDown /></i>
                </button>
                {/* Height-animated via grid-template-rows (0fr <-> 1fr) rather than
                    native <details>, which snaps open/closed with no transition. */}
                <div className="faq-answer" id={panelId} style={{ gridTemplateRows: open ? '1fr' : '0fr' }}>
                  <div className="faq-answer-inner"><p>{answer}</p></div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer id="contact">
      <div className="container footer-top">
        <div className="footer-lead"><Logo /><h2>Ready to make your first tap unforgettable?</h2><button className="button" onClick={() => scrollToId('builder')}>Build your Tap <ArrowRight /></button></div>
        <div className="footer-links"><div><small>EXPLORE</small><Link to="/shygontap/store">Shop all cards</Link><Link to={AAROH_PRODUCT_PATH}>AAROH</Link><a href="#digital-experience">Digital Experience</a><a href="#how-it-works">How It Works</a></div><div><small>CARDS</small>{products.map((item) => <Link key={item.id} to={productPath(item)}>{item.name}</Link>)}</div><div><small>CONTACT</small><a href={`mailto:${siteContent.contact.email}`}>{siteContent.contact.email}</a><a
  href={`https://wa.me/${WHATSAPP_NUMBER}`}
  target="_blank"
  rel="noreferrer"
>
  {CARD_SALES_OPEN ? 'WhatsApp ordering' : 'WhatsApp'}
</a><span>{siteContent.contact.location}</span></div>{(siteContent.contact.instagram || siteContent.contact.linkedin) && <div><small>FOLLOW</small>{siteContent.contact.instagram && <a href={siteContent.contact.instagram} target="_blank" rel="noreferrer"><Instagram size={16} /> Instagram</a>}{siteContent.contact.linkedin && <a href={siteContent.contact.linkedin} target="_blank" rel="noreferrer"><Linkedin size={16} /> LinkedIn</a>}</div>}</div>
      </div>
      <div className="container footer-bottom"><span>© {new Date().getFullYear()} SHYGON Technologies Pvt. Ltd. All rights reserved.</span><nav className="footer-legal" aria-label="Legal"><Link to={LEGAL_PAGES.privacy.path}>Privacy</Link><Link to={LEGAL_PAGES.terms.path}>Terms</Link><Link to={LEGAL_PAGES.refunds.path}>Refunds</Link><Link to={LEGAL_PAGES.shipping.path}>Shipping</Link><Link to={LEGAL_PAGES.cookies.path}>Cookies</Link></nav></div>
    </footer>
  )
}

/** The selection the builder and product page write to localStorage. */
interface PendingSelection {
  orderType?: 'physical' | 'digitalUpgrade' | 'lifetimeCustomization' | 'customization'
  productId?: ProductId
  material?: MaterialId
  tier?: TierId
  planId?: DigitalPlanId
  total?: number
}

function CartDrawer({ onClose, passPrice }: { onClose: () => void; passPrice: number }) {
  const navigate = useNavigate()
  const [item, setItem] = useState<PendingSelection | null>(null)
  useEffect(() => {
    const load = () => { try { setItem(JSON.parse(localStorage.getItem('shygon_pending_order') || 'null')) } catch { setItem(null) } }
    load(); window.addEventListener('shygon-cart-updated', load); window.addEventListener('storage', load)
    return () => { window.removeEventListener('shygon-cart-updated', load); window.removeEventListener('storage', load) }
  }, [])
  const isLifetime = item?.orderType === 'lifetimeCustomization'
  const product = item ? products.find(p => p.id === item.productId) : null
  const plan = item ? digitalPlans.find(p => p.id === item.planId) : null
  if (isLifetime) return <div className="cart-overlay" onClick={onClose}><aside className="cart-drawer" onClick={e=>e.stopPropagation()}><div className="cart-drawer-head"><div><small>SHYGON TAP</small><h2>Your Cart</h2></div><button className="cart-close" onClick={onClose}><X/></button></div><div className="cart-item lifetime-cart-item"><div className="cart-item-image lifetime-cart-icon"><Sparkles size={34}/></div><div className="cart-item-copy"><p>ONE-TIME UPGRADE</p><h3>Customization Pass</h3><span>Change your Tap whenever you like · all colour palettes</span><strong>₹{passPrice.toLocaleString('en-IN')}</strong><button onClick={()=>{onClose();scrollToId('builder')}}>Edit / view details</button></div></div><div className="cart-trust"><div><BadgeCheck size={17}/><span>Secure checkout</span></div><div><Sparkles size={17}/><span>Unlimited changes</span></div><div><ShoppingBag size={17}/><span>No new card needed</span></div></div><div className="cart-subtotal"><span>Subtotal</span><strong>₹{passPrice.toLocaleString('en-IN')}</strong></div><button className="cart-checkout" onClick={()=>{onClose();void continueToCheckout(navigate)}}>Proceed to Checkout <ArrowRight size={18}/></button><button className="cart-continue" onClick={onClose}>Continue Shopping</button></aside></div>
  if (!item || !product || !plan) return <div className="cart-overlay" onClick={onClose}><aside className="cart-drawer" onClick={e=>e.stopPropagation()}><button className="cart-close" onClick={onClose}><X/></button><h2>Your Cart</h2><div className="empty-cart"><ShoppingCart size={38}/><strong>Your cart is empty</strong><p>Choose a Shygon Tap and build your digital experience.</p><button className="button" onClick={()=>{onClose();scrollToId('cards')}}>Continue shopping</button></div></aside></div>
  return <div className="cart-overlay" onClick={onClose}><aside className="cart-drawer" onClick={e=>e.stopPropagation()}><div className="cart-drawer-head"><div><small>SHYGON TAP</small><h2>Your Cart</h2></div><button className="cart-close" onClick={onClose}><X/></button></div><div className="cart-item"><div className="cart-item-image"><img src={cardArt(product, item.material as MaterialId, item.tier as TierId)} alt={product.name}/></div><div className="cart-item-copy"><p>{product.eyebrow}</p><h3>{product.name}</h3><span>{materialLabels[item.material as MaterialId]} · {tierLabels[item.tier as TierId]} · {plan.name}</span><strong>{currency(item.total ?? 0)}{plan.priceSuffix}</strong><button onClick={()=>{onClose();scrollToId('builder')}}>Edit item</button></div></div><div className="cart-trust"><div><BadgeCheck size={17}/><span>Secure checkout</span></div><div><ShoppingBag size={17}/><span>Track your order</span></div><div><Sparkles size={17}/><span>Upgrade your UI later</span></div></div><div className="cart-subtotal"><span>Subtotal</span><strong>{currency(item.total ?? 0)}{plan.priceSuffix}</strong></div>{CARD_SALES_OPEN ? <button className="cart-checkout" onClick={()=>{onClose();navigate('/shygontap/auth')}}>Proceed to Checkout <ArrowRight size={18}/></button> : <CardsComingSoon />}<button className="cart-continue" onClick={onClose}>Continue Shopping</button></aside></div>
}

export default function ShygonApp() {
  // The builder restores the visitor's last configuration. Read in the state
  // initialisers rather than an effect, so the saved selection is what renders
  // first instead of the defaults flashing and then being replaced.
  const saved = readSavedSelection()
  const [productId, setProductId] = useState<ProductId>(saved.productId ?? 'business')
  const [material, setMaterial] = useState<MaterialId>(saved.material ?? 'metal')
  const [tier, setTier] = useState<TierId>(saved.tier ?? 'standard')
  const [planId, setPlanId] = useState<DigitalPlanId>(saved.planId ?? 'essential')
  const [demoPlan, setDemoPlan] = useState<DigitalPlan | null>(null)
  const [detailProduct, setDetailProduct] = useState<Product | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const prices = useLivePrices()
  usePageMeta(HOME_META)
  const [hasCart, setHasCart] = useState(() => !!localStorage.getItem('shygon_pending_order'))
  const product = useMemo(() => products.find((item) => item.id === productId) ?? products[0]!, [productId])
  const plan = useMemo(() => digitalPlans.find((item) => item.id === planId) ?? digitalPlans[0]!, [planId])
  const physicalPrice = prices.card(product, tier, material)
  const total = physicalPrice + prices.experience(plan)

  useEffect(() => {
    const openCart = () => setCartOpen(true)
    const syncCart = () => setHasCart(!!localStorage.getItem('shygon_pending_order'))
    window.addEventListener('shygon-open-cart', openCart)
    window.addEventListener('shygon-cart-updated', syncCart)
    window.addEventListener('storage', syncCart)
    return () => { window.removeEventListener('shygon-open-cart', openCart); window.removeEventListener('shygon-cart-updated', syncCart); window.removeEventListener('storage', syncCart) }
  }, [])

  useEffect(() => {
    document.body.style.overflow = demoPlan || cartOpen || !!detailProduct ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [demoPlan, cartOpen, detailProduct])


  useEffect(() => {
    localStorage.setItem('shygon_builder_selection', JSON.stringify({ productId, material, tier, planId }))

    // The cart holds one configured card, and both "Edit configuration" (dock)
    // and "Edit item" (drawer) send the visitor back here to change it. Keep an
    // existing card order in step with the builder; otherwise the dock says
    // "in your cart" about a configuration the cart does not contain. A
    // Customization Pass order is never touched. Display values only: checkout
    // re-prices everything server-side.
    let pending: PendingSelection | null = null
    try { pending = JSON.parse(localStorage.getItem('shygon_pending_order') || 'null') } catch { pending = null }
    if (!pending || pending.orderType !== 'physical' || !CARD_SALES_OPEN) return
    if (pending.productId === productId && pending.material === material && pending.tier === tier && pending.planId === planId && pending.total === total) return
    localStorage.setItem('shygon_pending_order', JSON.stringify({ orderType: 'physical', productId, material, tier, planId, physicalPrice, digitalPrice: plan.price, total }))
    window.dispatchEvent(new Event('shygon-cart-updated'))
  }, [productId, material, tier, planId, physicalPrice, plan.price, total])

  return (
    <>
      <Header />
      <main>
        <Hero />
        <Manifesto />
        <StoreBenefits />
        <ProductCollection onChoose={setProductId} onDetails={setDetailProduct} prices={prices} />
        <DesignCollection onChoose={setProductId} prices={prices} />
        <AarohCollection />
        <Configurator productId={productId} onProduct={setProductId} material={material} onMaterial={setMaterial} tier={tier} onTier={setTier} planId={planId} onPlan={setPlanId} onDemo={setDemoPlan} />
        <DigitalPlans selectedId={planId} onSelect={setPlanId} onDemo={setDemoPlan} />
        <HowItWorks />
        <Features />
        <FAQ />
      </main>
      <Footer />
      {hasCart && <div className="desktop-selection-dock">
        <div className="dock-product"><div className="dock-thumb"><img src={cardArt(product, material, tier)} alt="" /></div><div><small>IN YOUR CART</small><strong>{product.name.replace('Shygon Tap ', '')}</strong><span>{materialLabels[material]} · {tierLabels[tier]} · {plan.name}</span></div></div>
        <button className="dock-edit" onClick={() => scrollToId('builder')}>Edit configuration</button>
        <div className="dock-total"><small>Cart total</small><strong>{currency(total)}{plan.priceSuffix}</strong></div>
        <OrderButton product={product} material={material} tier={tier} plan={plan} physicalPrice={physicalPrice} total={total} />
      </div>}
      {hasCart && <button className="mobile-summary-bar" onClick={() => window.dispatchEvent(new Event('shygon-open-cart'))} aria-label="Open order summary"><span><small>YOUR TOTAL</small><strong>{currency(total)}{plan.priceSuffix}</strong></span><span>View cart <ArrowRight size={17} /></span></button>}
      {demoPlan && <DemoModal plan={demoPlan} onClose={() => setDemoPlan(null)} onSelect={setPlanId} />}
      {detailProduct && <ProductDetailModal product={detailProduct} onClose={() => setDetailProduct(null)} onChoose={setProductId} prices={prices} />}
      {cartOpen && <CartDrawer onClose={() => setCartOpen(false)} passPrice={prices.lifetime} />}
    </>
  )
}
