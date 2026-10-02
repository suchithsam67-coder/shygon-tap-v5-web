/**
 * Hand-written schema types for the SHYGON Supabase project.
 *
 * These describe the schema AFTER `supabase/migrations/001` and `002` are
 * applied. They are deliberately narrow: only the tables, columns and RPCs the
 * customer web app actually touches appear here, so a typo in a column name is
 * a compile error rather than a runtime 400.
 *
 * Regenerate with `npx supabase gen types typescript` once the CLI is linked.
 */

/**
 * The four digital experiences, and the only vocabulary for them.
 *
 * Before migration 004 the database stored `free | pro | premium | 3d` while
 * the storefront sold `essential | business | pro | 3d` — so the string `pro`
 * meant BUSINESS on one side and the third tier on the other. Anything keyed
 * off it (notably "which experience plays an opening animation") got the wrong
 * tier. Migration 004 converts the stored values to these four, which are also
 * the plan SKU suffix (`plan-<id>`) and the entitlement key.
 *
 * Mirrors `public.canonical_experience()`; keep the two in step.
 */
export type Experience = 'essential' | 'business' | 'premium' | 'goat';

/** Lowest first. Index is the rank, matching `public.tier_rank()`. */
export const EXPERIENCE_ORDER: readonly Experience[] = [
  'essential',
  'business',
  'premium',
  'goat',
];

/**
 * Legacy spellings still readable from rows written before migration 004.
 * `pro` is the one that matters: it named the SECOND tier, not the third.
 */
const LEGACY_EXPERIENCE: Record<string, Experience> = {
  free: 'essential',
  pro: 'business',
  '3d': 'goat',
  custom: 'goat',
};

/** Any spelling in, one canonical experience out. Never throws. */
export function toExperience(value: string | null | undefined): Experience {
  const key = (value ?? '').trim().toLowerCase();
  if ((EXPERIENCE_ORDER as readonly string[]).includes(key)) return key as Experience;
  return LEGACY_EXPERIENCE[key] ?? 'essential';
}

export function experienceRank(value: string | null | undefined): number {
  return EXPERIENCE_ORDER.indexOf(toExperience(value));
}

/* -------------------------------------------------------------------------
   Theme — what the customer picked in the customizer.
   Which values they are ALLOWED to pick is decided by the database
   (`theme_options()`), because that is an entitlement question, not a styling
   one. These types only describe the shape.
   ------------------------------------------------------------------------- */

export type ThemePalette =
  | 'midnight' | 'graphite' | 'royal' | 'forest'
  | 'sunset' | 'aurora' | 'crimson' | 'ivory'
  | 'neon' | 'molten' | 'abyss' | 'prism';

export type ThemeLayout = 'classic' | 'centered' | 'split' | 'immersive';
export type ThemeButtons = 'solid' | 'outline' | 'glass' | 'glow';
export type ThemeFont = 'sans' | 'display' | 'mono' | 'editorial';
/** `auto` means "whatever this experience does by default". */
export type ThemeAnimation = 'auto' | 'none' | 'signature' | 'dynamic';

export interface TapTheme {
  palette: ThemePalette;
  layout: ThemeLayout;
  buttons: ThemeButtons;
  font: ThemeFont;
  animation: ThemeAnimation;
}

export const DEFAULT_THEME: TapTheme = {
  palette: 'midnight',
  layout: 'classic',
  buttons: 'solid',
  font: 'sans',
  animation: 'auto',
};

/** What `my_theme_options()` returns: the options this customer may choose. */
export interface ThemeOptions {
  max_experience: Experience;
  has_pass: boolean;
  palette: ThemePalette[];
  layout: ThemeLayout[];
  buttons: ThemeButtons[];
  font: ThemeFont[];
  animation: ThemeAnimation[];
}

/** One of the free-form links a customer can add to their Tap. */
export interface CustomLink {
  label: string;
  url: string;
}

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export type OrderStatus =
  | 'placed'
  | 'processing'
  | 'packed'
  | 'shipped'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled';

export type EntitlementType = 'digital_plan' | 'lifetime' | 'card' | 'customization';

export type ProductType = 'card' | 'digital_plan' | 'lifetime_plan' | 'customization' | 'delivery';

export type NotificationCategory =
  | 'order'
  | 'payment'
  | 'shipping'
  | 'delivery'
  | 'tap'
  | 'account';

export type SupportStatus = 'open' | 'awaiting_customer' | 'resolved' | 'closed';

export type TapEventType = 'view' | 'nfc' | 'qr' | 'link_click';

/**
 * The lifecycle of a Tap. `published` is the boolean every existing read path
 * keys on; migration 004 keeps the two in lock-step so "never finished" and
 * "deliberately taken down" stop looking identical to a visitor.
 */
export type TapStatus = 'draft' | 'active' | 'paused' | 'archived';

/** What a visitor's request for a public Tap resolved to. */
export type PublicTapState = 'active' | 'paused' | 'unavailable';

/**
 * The look of the physical card a page was opened from — which design, in
 * which material and finish. Drives the card's own opening animation.
 */
export interface CardLook {
  design: string;
  material?: string | null;
  finish?: string | null;
}

/** What `get_public_card()` (migration 022) says about a tapped card. */
export interface PublicCard extends Partial<CardLook> {
  state: 'active' | 'not_activated' | 'inactive' | 'paused' | 'unavailable';
  code?: string;
  slug?: string;
}

export interface ProductRow {
  id: string;
  sku: string | null;
  name: string;
  category: string | null;
  material: string | null;
  tier: string | null;
  ui_tier: Experience | null;
  price: number | null;
  price_in_paise: number | null;
  description: string | null;
  short_description: string | null;
  image_url: string | null;
  features: string[] | null;
  badge: string | null;
  stock: number | null;
  product_type: ProductType | null;
  sort_order: number | null;
  active: boolean | null;
}

export interface ProfileRow {
  id: string;
  customer_id: string | null;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  bio: string | null;
  website: string | null;
  whatsapp: string | null;
  instagram: string | null;
  linkedin: string | null;
  profile_image_url: string | null;
  location: string | null;
  company: string | null;
  job_title: string | null;
  /** Gates the shipping/delivery notifications the order trigger writes. */
  notify_order_updates: boolean | null;
  notify_tap_activity: boolean | null;
  created_at: string;
  updated_at: string | null;
}

export interface TapProfileRow {
  id: string;
  user_id: string;
  customer_id: string | null;
  slug: string | null;
  username: string | null;
  published: boolean | null;
  published_at: string | null;
  display_name: string | null;
  headline: string | null;
  bio: string | null;
  avatar_url: string | null;
  location: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  instagram: string | null;
  linkedin: string | null;
  theme_color: string | null;
  selected_ui_tier: Experience;
  enabled_customizations: string[];
  /** draft | active | paused | archived. Kept in lock-step with `published`. */
  status: TapStatus;
  /** Stamped by the database on every content edit; the browser cannot reset it. */
  last_content_edit_at: string | null;
  /** When the customer's first card was paid for. Reference only. */
  edit_window_started_at: string | null;
  designation: string | null;
  company: string | null;
  youtube: string | null;
  custom_links: CustomLink[];
  theme_palette: ThemePalette;
  theme_layout: ThemeLayout;
  theme_buttons: ThemeButtons;
  theme_font: ThemeFont;
  theme_animation: ThemeAnimation;
  created_at: string;
  updated_at: string | null;
}

/**
 * What `public.tap_edit_state()` returns.
 *
 * The rule is one content edit per `interval_days` (14), lifted by the ₹999
 * Customization Pass — a rolling limit, not a window that expires, so a Tap
 * never becomes permanently frozen. The account area renders this; the same
 * rule is enforced independently by a trigger on `tap_profiles`.
 */
export interface TapEditStateRow {
  last_edit_at: string | null;
  /** When the next edit becomes available. Null when there is no limit. */
  next_edit_at: string | null;
  days_remaining: number;
  interval_days: number;
  has_pass: boolean;
  can_edit: boolean;
  reason: 'pass' | 'never_edited' | 'edit_available' | 'cooling_down' | 'no_tap' | string;
}

export interface AccountEventRow {
  id: string;
  user_id: string;
  event_type: string;
  subject_type: string | null;
  subject_id: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

/**
 * Exactly what `get_public_profile()` returns — no account fields, by design,
 * and everything already clamped server-side to what the customer owns.
 *
 * Nothing here is nullable-by-accident: a null means "the customer did not
 * publish this", which is the only reason a field is ever absent.
 */
export interface PublicProfile {
  slug: string;
  experience: Experience;
  displayName: string | null;
  headline: string | null;
  designation: string | null;
  company: string | null;
  bio: string | null;
  avatarUrl: string | null;
  location: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  instagram: string | null;
  linkedin: string | null;
  youtube: string | null;
  customLinks: CustomLink[];
  theme: TapTheme;
  activeEvent: {
    code: string;
    name: string;
    startsOn: string;
    endsOn: string;
    theme: TapTheme;
  } | null;
}

export interface OrderRow {
  id: string;
  order_id: string;
  user_id: string;
  product_id: string | null;
  product_name: string | null;
  category: string | null;
  material: string | null;
  tier: string | null;
  plan: string | null;
  plan_id: string | null;
  order_type: string | null;
  amount: number | null;
  amount_in_paise: number | null;
  payment_status: PaymentStatus | string | null;
  order_status: OrderStatus | string | null;
  fulfillment_status: 'pending' | 'processing' | 'retry' | 'fulfilled' | string | null;
  fulfilled_at: string | null;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  shipping_name: string | null;
  shipping_phone: string | null;
  shipping_address: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_pincode: string | null;
  tracking_number: string | null;
  created_at: string;
  updated_at: string | null;
  // Recorded by the admin as it works the order (migration 003). Optional:
  // absent on a database that predates it, and on rows read without them.
  shipping_carrier?: string | null;
  shipped_at?: string | null;
  delivered_at?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  refunded_at?: string | null;
  refund_amount_in_paise?: number | null;
  // Checkout money (migration 023): cart value, promo discount and delivery.
  subtotal_in_paise?: number | null;
  discount_in_paise?: number | null;
  delivery_fee_in_paise?: number | null;
  promo_code?: string | null;
  replaces_card_id?: string | null;
  // Migration 026: GST at purchase time, billing address, cancellation request.
  tax_in_paise?: number | null;
  tax_rate_percent?: number | null;
  tax_inclusive?: boolean | null;
  tax_split?: string | null;
  customer_gstin?: string | null;
  billing_same_as_shipping?: boolean | null;
  billing_name?: string | null;
  billing_company?: string | null;
  billing_address?: string | null;
  billing_address_line2?: string | null;
  billing_locality?: string | null;
  billing_city?: string | null;
  billing_state?: string | null;
  billing_pincode?: string | null;
  shipping_address_line2?: string | null;
  shipping_locality?: string | null;
  cancellation_requested_at?: string | null;
  cancellation_request_reason?: string | null;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  sku: string;
  name: string;
  product_type: ProductType | string;
  unit_price_in_paise: number;
  quantity: number;
  line_total_in_paise: number;
}

export interface EntitlementRow {
  id: string;
  user_id: string;
  type: EntitlementType | string;
  key: string;
  source_order_id: string | null;
  is_active: boolean;
  granted_at: string;
}

export interface CardRow {
  id: string;
  user_id: string;
  order_id: string | null;
  tap_profile_id: string | null;
  sku: string | null;
  card_uid: string | null;
  card_type?: string | null;
  status: string;
  is_replacement: boolean;
  activated_at?: string | null;
  /** Live rule: an activation lasts 14 days, then the card suspends itself. */
  activation_expires_at?: string | null;
  deactivated_at?: string | null;
  /** Limited edition (migration 017): design-wide serial, cards on the line, chapter size. */
  edition_design?: string | null;
  edition_serial?: number | null;
  edition_count?: number | null;
  edition_chapter_size?: number | null;
  /** Permanent Card ID (migration 022): what the NFC chip's /c/<code> link carries. */
  card_code?: string | null;
  nickname?: string | null;
  /** Set when the customer reported the card lost; the card is then `suspended`. */
  lost_at?: string | null;
  replaces_card_id?: string | null;
  replaced_at?: string | null;
  last_tapped_at?: string | null;
  tap_count?: number | null;
  created_at: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  category: NotificationCategory | string;
  title: string;
  body: string | null;
  link: string | null;
  metadata: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

export interface SupportTicketRow {
  id: string;
  user_id: string;
  reference: string;
  subject: string;
  category: string;
  status: SupportStatus | string;
  order_id: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface SupportMessageRow {
  id: string;
  ticket_id: string;
  author_id: string | null;
  author_role: 'customer' | 'support' | string;
  body: string;
  created_at: string;
}

export interface TapAnalyticsRow {
  day: string;
  views: number;
  nfc_taps: number;
  qr_scans: number;
  link_clicks: number;
  unique_visitors: number;
}

export interface TapLinkClickRow {
  link_key: string;
  clicks: number;
}
