import { useEffect, useMemo, useRef, useState } from 'react'
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
  digitalPlans,
  faqs,
  howItWorks,
  materialLabels,
  premiumFeatures,
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
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { cardPriceIndex, fetchCatalog } from "../services/catalog";

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
      <span className="brand-mark" aria-hidden="true"><span>S</span></span>
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
    ['Cards', 'cards'], ['Digital Experience', 'digital-experience'],
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
    setSearch('')
    if (match) { scrollToId('cards'); window.setTimeout(() => document.getElementById(`product-${match.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250) }
    else scrollToId('cards')
  }

  return <>
    <header className={`site-header ${scrolled ? 'site-header-scrolled' : ''}`}>
      <div className="nav-shell">
        <Logo compact />
        <nav className="desktop-nav" aria-label="Primary">
          {links.map(([label, id]) => <a key={id} href={`#${id}`}>{label}</a>)}
        </nav>
        <div className="nav-utility">
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

function Hero() {
  const productRef = useRef<HTMLDivElement>(null)

  // A very low-amplitude highlight follow — the glass notices the cursor
  // without ever turning into a blob that chases it. Desktop pointers only;
  // touch never fires mousemove in a way that would make this jitter.
  const trackGlassLight = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - bounds.left) / bounds.width) * 100
    const y = ((event.clientY - bounds.top) / bounds.height) * 100
    productRef.current?.style.setProperty('--lg-x', `${x}%`)
    productRef.current?.style.setProperty('--lg-y', `${y}%`)
  }

  return (
    <section className="hero" id="home">
      <div className="hero-grid" aria-hidden="true" />
      <div className="container hero-layout">
        <div className="hero-copy reveal-up">
          <p className="eyebrow"><Nfc size={16} /> {siteContent.hero.eyebrow}</p>
          <h1>
            {siteContent.hero.title.map((line, index, lines) => (
              <span key={line} className={index === lines.length - 1 ? 'accent-line' : ''}>{line}</span>
            ))}
          </h1>
          <p className="hero-subtitle">{siteContent.hero.subtitle}</p>
          <p className="hero-description">{siteContent.hero.description}</p>
          <div className="hero-actions">
            <button className="button" onClick={() => scrollToId('cards')}>Explore Shygon Tap <ArrowDownRight size={18} /></button>
            <button className="button button-secondary" onClick={() => scrollToId('builder')}>Configure your Tap <ArrowRight size={18} /></button>
          </div>
          <div className="hero-proof">
            <span><BadgeCheck size={15} /> No app required</span>
            <span><Zap size={15} /> Opens instantly</span>
            <span><Palette size={15} /> Made around you</span>
          </div>
        </div>
        <div className="hero-product reveal-scale" ref={productRef} onPointerMove={trackGlassLight}>
          <div className="liquid-glass liquid-glass-one" aria-hidden="true" />
          <div className="liquid-glass liquid-glass-two" aria-hidden="true" />
          <div className="hero-card-float">
            <TiltCard src="/assets/cards/business-metal.jpeg" alt="Brushed metal Shygon Tap Business NFC card" />
          </div>
          <div className="nfc-pulse" aria-hidden="true"><Nfc size={26} /><i /><i /></div>
          <div className="hero-chip hero-chip-top"><span>01</span><div><small>PHYSICAL</small><strong>Premium NFC card</strong></div></div>
          <div className="hero-chip hero-chip-bottom"><span>02</span><div><small>DIGITAL</small><strong>Your chosen UI</strong></div></div>
          <div className="tap-path" aria-hidden="true"><i /><i /><i /></div>
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
    <div><ShoppingBag size={25}/><div><strong>Made for delivery</strong><span>Track your Tap order</span></div></div>
    <div><Sparkles size={25}/><div><strong>Upgrade anytime</strong><span>Change your digital UI later</span></div></div>
    <div><MessageCircle size={25}/><div><strong>Human support</strong><span>Talk to the Shygon team</span></div></div>
  </div></section>
}

function ProductCollection({ onChoose, onDetails, prices }: { onChoose: (id: ProductId) => void; onDetails: (product: Product) => void; prices: ReturnType<typeof useLivePrices> }) {
  return (
    <section className="section collection" id="cards">
      <div className="container">
        <div className="section-heading split-heading">
          <div><p className="eyebrow"><span className="story-index">02</span> {siteContent.collection.eyebrow}</p><h2>{siteContent.collection.title}</h2></div>
          <p>{siteContent.collection.description}</p>
        </div>
        <div className="product-grid">
          {products.map((product, index) => (
            <article id={`product-${product.id}`} className={`product-card product-card-${index + 1}`} key={product.id}>
              <div className="product-card-image">
                <span className="product-index">0{index + 1}</span>
                <TiltCard src={product.images.pvc} alt={`${product.name} NFC card`} />
                <span className="starting-price">from {currency(prices.card(product, 'standard', 'pvc'))}</span>
              </div>
              <div className="product-card-copy">
                <p className="mini-label">{product.eyebrow}</p>
                <h3>{product.name}</h3>
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

function ProductDetailModal({ product, onClose, onChoose, prices }: { product: Product; onClose: () => void; onChoose: (id: ProductId) => void; prices: ReturnType<typeof useLivePrices> }) {
  const [material, setMaterial] = useState<MaterialId>('metal')
  return (
    <div className="product-detail-modal" role="dialog" aria-modal="true" aria-label={`${product.name} details`}>
      <button className="modal-close product-detail-close" onClick={onClose} aria-label="Close product details"><X /></button>
      <div className="product-detail-card">
        <div className="product-detail-gallery">
          <div className="product-detail-main"><TiltCard src={product.images[material]} alt={`${product.name} ${materialLabels[material]} card`} /></div>
          <div className="product-detail-thumbs">
            {(Object.keys(materialLabels) as MaterialId[]).map((id) => (
              <button key={id} className={material === id ? 'active' : ''} onClick={() => setMaterial(id)}>
                <img src={product.images[id]} alt={materialLabels[id]} />
                <span>{materialLabels[id]}</span>
              </button>
            ))}
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
          <div className="detail-material-note"><Layers3 size={17} /><span><strong>{materialLabels[material]}</strong> selected · choose finish and Digital UI next.</span></div>
          <button className="button detail-choose" onClick={() => { onChoose(product.id); onClose(); scrollToId('builder') }}>Choose this card <ArrowRight size={18} /></button>
          <button className="detail-secondary" onClick={() => { onClose(); scrollToId('builder') }}>Compare all options</button>
        </div>
      </div>
    </div>
  )
}

function ChoiceButton({ selected, onClick, children, detail }: { selected: boolean; onClick: () => void; children: React.ReactNode; detail?: string }) {
  return (
    <button className={`choice-button ${selected ? 'selected' : ''}`} onClick={onClick} aria-pressed={selected}>
      <span>{children}</span>{detail && <small>{detail}</small>}{selected && <Check size={15} />}
    </button>
  )
}

function OrderButton({ product, material, tier, plan, physicalPrice, total }: { product: Product; material: MaterialId; tier: TierId; plan: DigitalPlan; physicalPrice: number; total: number }) {
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
            <div className="stage-number">01—04</div>
            <div className={`material-backdrop material-${material}`} />
            <TiltCard key={`${productId}-${material}`} src={product.images[material]} alt={`${materialLabels[material]} ${product.name}`} className="builder-tilt" />
            <div className="stage-caption">
              <span>{materialLabels[material]} · {tierLabels[tier]}</span>
              <strong>{product.name}</strong>
              <small>Image changes with your material</small>
            </div>
          </div>

          <div className="builder-controls">
            <div className="config-block">
              <div className="config-title"><span>01</span><div><small>PRODUCT</small><h3>Choose your card</h3></div></div>
              <div className="choice-grid choice-grid-products">
                {products.map((item) => <ChoiceButton key={item.id} selected={productId === item.id} onClick={() => onProduct(item.id)}>{item.name.replace('Shygon Tap ', '')}</ChoiceButton>)}
              </div>
            </div>
            <div className="config-block">
              <div className="config-title"><span>02</span><div><small>PHYSICAL CARD</small><h3>Choose your material</h3></div></div>
              <div className="choice-grid">
                {(Object.keys(materialLabels) as MaterialId[]).map((id) => (
                  <ChoiceButton key={id} selected={material === id} onClick={() => onMaterial(id)} detail={currency(product.pricing[tier][id])}>{materialLabels[id]}</ChoiceButton>
                ))}
              </div>
            </div>
            <div className="config-block">
              <div className="config-title"><span>03</span><div><small>CARD FINISH</small><h3>Standard or Premium</h3></div></div>
              <div className="choice-grid choice-grid-two">
                {(Object.keys(tierLabels) as TierId[]).map((id) => (
                  <ChoiceButton key={id} selected={tier === id} onClick={() => onTier(id)} detail={`from ${currency(product.pricing[id].pvc)}`}>{tierLabels[id]}</ChoiceButton>
                ))}
              </div>
              <p className="onwards-note">Prices shown are starting prices and update by material.</p>
            </div>
            <div className="config-block">
              <div className="config-title"><span>04</span><div><small>DIGITAL UI</small><h3>Choose your experience</h3></div></div>
              <div className="choice-grid choice-grid-plans">
                {digitalPlans.map((item) => (
                  <ChoiceButton key={item.id} selected={planId === item.id} onClick={() => { onPlan(item.id); onDemo(item); }} detail={`${currency(prices.experience(item))}${item.priceSuffix ?? ''}`}>{item.name}</ChoiceButton>
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
        GET THE PASS — ₹999 <ArrowRight size={15} />
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
      <dt>Plan</dt>
      <dd>{tierLabels[tier]}</dd>
    </div>

    <div>
      <dt>Digital experience</dt>
      <dd>{plan.name}</dd>
    </div>
  </dl>

  <div className="price-lines">
    <div>
      <span>Physical card</span>
      <strong>{currency(physicalPrice)}</strong>
    </div>

    <div>
      <span>Digital UI</span>
      <strong>{currency(planPrice)}{plan.priceSuffix}</strong>
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
                  <button type="button" className="tier-deck-select" onClick={() => { onSelect(active.id); onDemo(active) }}>
                    {selectedId === active.id ? <><Check size={14} /> Selected</> : 'Select this tier'}
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
            <div className="cinema-card"><img src="/assets/cards/business-metal.jpeg" alt="Shygon Tap card ready to scan" /><i /><i /><i /></div>
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
        <div className="manifesto-bottom"><p>{siteContent.message.body}</p><div className="manifesto-orb"><Nfc /><span>TAP<br />CONNECT<br />EXPERIENCE</span></div></div>
      </div>
    </section>
  )
}

function HowItWorks() {
  return (
    <section className="section how-section" id="how-it-works">
      <div className="container">
        <div className="section-heading split-heading"><div><p className="eyebrow"><span className="story-index">05</span> SIMPLE BY DESIGN</p><h2>HOW IT WORKS</h2></div><p>From physical card to digital connection in five clear steps.</p></div>
        <div className="steps-list">
          {howItWorks.map(([number, title, description], index) => (
            <article key={number}><span>{number}</span><div className="step-icon">{[<ShoppingBag />, <Layers3 />, <Smartphone />, <MessageCircle />, <Nfc />][index]}</div><h3>{title}</h3><p>{description}</p><ArrowDownRight /></article>
          ))}
        </div>
      </div>
    </section>
  )
}

function Features() {
  const icons = [Nfc, Smartphone, Palette, Layers3, Sparkles, MessageCircle]
  return (
    <section className="section features-section">
      <div className="container features-layout">
        <div className="features-intro"><p className="eyebrow"><span className="story-index">06</span> BUILT DIFFERENTLY</p><h2>More than a card in your wallet.</h2><p>Every detail is designed to move people from a physical moment into a considered digital experience.</p></div>
        <div className="feature-grid">
          {premiumFeatures.map(([title, description], index) => {
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
        <div className="faq-intro"><p className="eyebrow"><span className="story-index">07</span> QUESTIONS, ANSWERED</p><h2>Everything you need to know before you tap.</h2><p>Still have a question? Build a configuration and talk directly with Shygon Technologies on WhatsApp.</p></div>
        <div className="faq-list">
          {faqs.map(([question, answer], index) => {
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
        <div className="footer-links"><div><small>EXPLORE</small><a href="#cards">Cards</a><a href="#digital-experience">Digital Experience</a><a href="#how-it-works">How It Works</a></div><div><small>CONTACT</small><a href={`mailto:${siteContent.contact.email}`}>{siteContent.contact.email}</a><a
  href={`https://wa.me/${WHATSAPP_NUMBER}`}
  target="_blank"
  rel="noreferrer"
>
  WhatsApp ordering
</a><span>{siteContent.contact.location}</span></div><div><small>FOLLOW</small><a href={siteContent.contact.instagram}><Instagram size={16} /> Instagram</a><a href={siteContent.contact.linkedin}><Linkedin size={16} /> LinkedIn</a></div></div>
      </div>
      <div className="container footer-bottom"><span>© {new Date().getFullYear()} Shygon Technologies. All rights reserved.</span><span>Tap. Connect. Experience.</span></div>
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

function CartDrawer({ onClose }: { onClose: () => void }) {
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
  if (isLifetime) return <div className="cart-overlay" onClick={onClose}><aside className="cart-drawer" onClick={e=>e.stopPropagation()}><div className="cart-drawer-head"><div><small>SHYGON TAP</small><h2>Your Cart</h2></div><button className="cart-close" onClick={onClose}><X/></button></div><div className="cart-item lifetime-cart-item"><div className="cart-item-image lifetime-cart-icon"><Sparkles size={34}/></div><div className="cart-item-copy"><p>ONE-TIME UPGRADE</p><h3>Customization Pass</h3><span>Change your Tap whenever you like · all colour palettes</span><strong>₹{CUSTOMIZATION_PASS_PRICE.toLocaleString('en-IN')}</strong><button onClick={()=>{onClose();scrollToId('builder')}}>Edit / view details</button></div></div><div className="cart-trust"><div><BadgeCheck size={17}/><span>Secure checkout</span></div><div><Sparkles size={17}/><span>Unlimited changes</span></div><div><ShoppingBag size={17}/><span>No new card needed</span></div></div><div className="cart-subtotal"><span>Subtotal</span><strong>₹{CUSTOMIZATION_PASS_PRICE.toLocaleString('en-IN')}</strong></div><button className="cart-checkout" onClick={()=>{onClose();void continueToCheckout(navigate)}}>Proceed to Checkout <ArrowRight size={18}/></button><button className="cart-continue" onClick={onClose}>Continue Shopping</button></aside></div>
  if (!item || !product || !plan) return <div className="cart-overlay" onClick={onClose}><aside className="cart-drawer" onClick={e=>e.stopPropagation()}><button className="cart-close" onClick={onClose}><X/></button><h2>Your Cart</h2><div className="empty-cart"><ShoppingCart size={38}/><strong>Your cart is empty</strong><p>Choose a Shygon Tap and build your digital experience.</p><button className="button" onClick={()=>{onClose();scrollToId('cards')}}>Continue shopping</button></div></aside></div>
  return <div className="cart-overlay" onClick={onClose}><aside className="cart-drawer" onClick={e=>e.stopPropagation()}><div className="cart-drawer-head"><div><small>SHYGON TAP</small><h2>Your Cart</h2></div><button className="cart-close" onClick={onClose}><X/></button></div><div className="cart-item"><div className="cart-item-image"><img src={product.images[item.material as MaterialId]} alt={product.name}/></div><div className="cart-item-copy"><p>{product.eyebrow}</p><h3>{product.name}</h3><span>{materialLabels[item.material as MaterialId]} · {tierLabels[item.tier as TierId]} · {plan.name}</span><strong>{currency(item.total ?? 0)}{plan.priceSuffix}</strong><button onClick={()=>{onClose();scrollToId('builder')}}>Edit item</button></div></div><div className="cart-trust"><div><BadgeCheck size={17}/><span>Secure checkout</span></div><div><ShoppingBag size={17}/><span>Track your order</span></div><div><Sparkles size={17}/><span>Upgrade your UI later</span></div></div><div className="cart-subtotal"><span>Subtotal</span><strong>{currency(item.total ?? 0)}{plan.priceSuffix}</strong></div><button className="cart-checkout" onClick={()=>{onClose();navigate('/shygontap/auth')}}>Proceed to Checkout <ArrowRight size={18}/></button><button className="cart-continue" onClick={onClose}>Continue Shopping</button></aside></div>
}

export default function ShygonApp() {
  // The builder restores the visitor's last configuration. Read in the state
  // initialisers rather than an effect, so the saved selection is what renders
  // first instead of the defaults flashing and then being replaced.
  const saved = readSavedSelection()
  const [productId, setProductId] = useState<ProductId>(saved.productId ?? 'business')
  const [material, setMaterial] = useState<MaterialId>(saved.material ?? 'metal')
  const [tier, setTier] = useState<TierId>(saved.tier ?? 'premium')
  const [planId, setPlanId] = useState<DigitalPlanId>(saved.planId ?? 'goat')
  const [demoPlan, setDemoPlan] = useState<DigitalPlan | null>(null)
  const [detailProduct, setDetailProduct] = useState<Product | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const prices = useLivePrices()
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
  }, [productId, material, tier, planId])

  return (
    <>
      <Header />
      <main>
        <Hero />
        <Manifesto />
        <StoreBenefits />
        <ProductCollection onChoose={setProductId} onDetails={setDetailProduct} prices={prices} />
        <Configurator productId={productId} onProduct={setProductId} material={material} onMaterial={setMaterial} tier={tier} onTier={setTier} planId={planId} onPlan={setPlanId} onDemo={setDemoPlan} />
        <DigitalPlans selectedId={planId} onSelect={setPlanId} onDemo={setDemoPlan} />
        <HowItWorks />
        <Features />
        <FAQ />
      </main>
      <Footer />
      {hasCart && <div className="desktop-selection-dock">
        <div className="dock-product"><div className="dock-thumb"><img src={product.images[material]} alt="" /></div><div><small>IN YOUR CART</small><strong>{product.name.replace('Shygon Tap ', '')}</strong><span>{materialLabels[material]} · {tierLabels[tier]} · {plan.name}</span></div></div>
        <button className="dock-edit" onClick={() => scrollToId('builder')}>Edit configuration</button>
        <div className="dock-total"><small>Cart total</small><strong>{currency(total)}{plan.priceSuffix}</strong></div>
        <OrderButton product={product} material={material} tier={tier} plan={plan} physicalPrice={physicalPrice} total={total} />
      </div>}
      {hasCart && <button className="mobile-summary-bar" onClick={() => window.dispatchEvent(new Event('shygon-open-cart'))} aria-label="Open order summary"><span><small>YOUR TOTAL</small><strong>{currency(total)}{plan.priceSuffix}</strong></span><span>View cart <ArrowRight size={17} /></span></button>}
      {demoPlan && <DemoModal plan={demoPlan} onClose={() => setDemoPlan(null)} onSelect={setPlanId} />}
      {detailProduct && <ProductDetailModal product={detailProduct} onClose={() => setDetailProduct(null)} onChoose={setProductId} prices={prices} />}
      {cartOpen && <CartDrawer onClose={() => setCartOpen(false)} />}
    </>
  )
}
