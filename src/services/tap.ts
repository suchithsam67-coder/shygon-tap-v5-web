import { supabase } from '../lib/supabase';
import { SITE_URL } from '../lib/site';
import {
  DEFAULT_THEME,
  toExperience,
  type CustomLink,
  type Experience,
  type TapEditStateRow,
  type TapProfileRow,
  type TapStatus,
  type TapTheme,
  type ThemeOptions,
} from '../lib/database.types';

/**
 * The customer's Tap profile — the publishable entity.
 *
 * Content lives in `tap_profiles`, not `profiles`, so editing account details
 * never silently changes what the world sees and publishing stays an explicit
 * act. The public read path is `get_public_profile()`, a SECURITY DEFINER
 * function that returns whitelisted, already-clamped fields for active Taps
 * only; the browser never selects from `tap_profiles` for anyone but its owner.
 */

/** Columns that exist from migration 002 onwards. */
const TAP_COLUMNS_BASE =
  'id, user_id, customer_id, slug, username, published, published_at, display_name, ' +
  'headline, bio, avatar_url, location, phone, whatsapp, email, website, instagram, ' +
  'linkedin, theme_color, selected_ui_tier, enabled_customizations, created_at, updated_at';

/** Everything migration 004 adds. */
const TAP_COLUMNS_004 =
  'status, last_content_edit_at, edit_window_started_at, designation, company, youtube, ' +
  'custom_links, theme_palette, theme_layout, theme_buttons, theme_font, theme_animation';

const TAP_COLUMNS = `${TAP_COLUMNS_BASE}, ${TAP_COLUMNS_004}`;

/** PostgREST / Postgres codes for "that column is not there". */
function isMissingColumn(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string } | null;
  return candidate?.code === '42703' || /column .* does not exist/i.test(candidate?.message ?? '');
}

/**
 * Fills in what migration 004 adds, so a database still running 002/003 keeps
 * working instead of the whole account area reporting itself broken. The
 * synthesised status mirrors what the migration's own backfill produces.
 */
function normaliseTap(row: Record<string, unknown> | null): TapProfileRow | null {
  if (!row) return null;
  const links = Array.isArray(row.custom_links) ? (row.custom_links as CustomLink[]) : [];
  return {
    ...(row as unknown as TapProfileRow),
    selected_ui_tier: toExperience(row.selected_ui_tier as string),
    status: (row.status as TapStatus) ?? (row.published === true ? 'active' : 'draft'),
    last_content_edit_at: (row.last_content_edit_at as string | null) ?? null,
    edit_window_started_at: (row.edit_window_started_at as string | null) ?? null,
    designation: (row.designation as string | null) ?? null,
    company: (row.company as string | null) ?? null,
    youtube: (row.youtube as string | null) ?? null,
    custom_links: links,
    theme_palette: (row.theme_palette as TapTheme['palette']) ?? DEFAULT_THEME.palette,
    theme_layout: (row.theme_layout as TapTheme['layout']) ?? DEFAULT_THEME.layout,
    theme_buttons: (row.theme_buttons as TapTheme['buttons']) ?? DEFAULT_THEME.buttons,
    theme_font: (row.theme_font as TapTheme['font']) ?? DEFAULT_THEME.font,
    theme_animation: (row.theme_animation as TapTheme['animation']) ?? DEFAULT_THEME.animation,
  };
}

/** The theme, pulled out of the flat row the table stores. */
export function themeOf(tap: TapProfileRow | null): TapTheme {
  if (!tap) return DEFAULT_THEME;
  return {
    palette: tap.theme_palette ?? DEFAULT_THEME.palette,
    layout: tap.theme_layout ?? DEFAULT_THEME.layout,
    buttons: tap.theme_buttons ?? DEFAULT_THEME.buttons,
    font: tap.theme_font ?? DEFAULT_THEME.font,
    animation: tap.theme_animation ?? DEFAULT_THEME.animation,
  };
}

export async function fetchMyTap(userId: string): Promise<TapProfileRow | null> {
  const { data, error } = await supabase
    .from('tap_profiles')
    .select(TAP_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle();

  if (!error) return normaliseTap(data as Record<string, unknown> | null);
  if (!isMissingColumn(error)) throw error;

  const fallback = await supabase
    .from('tap_profiles')
    .select(TAP_COLUMNS_BASE)
    .eq('user_id', userId)
    .maybeSingle();

  if (fallback.error) throw fallback.error;
  return normaliseTap(fallback.data as Record<string, unknown> | null);
}

/** Fields a customer is allowed to edit on their own Tap. */
export type TapDraft = Partial<
  Pick<
    TapProfileRow,
    | 'display_name'
    | 'headline'
    | 'designation'
    | 'company'
    | 'bio'
    | 'avatar_url'
    | 'location'
    | 'phone'
    | 'whatsapp'
    | 'email'
    | 'website'
    | 'instagram'
    | 'linkedin'
    | 'youtube'
    | 'custom_links'
    | 'selected_ui_tier'
    | 'enabled_customizations'
    | 'theme_palette'
    | 'theme_layout'
    | 'theme_buttons'
    | 'theme_font'
    | 'theme_animation'
  >
>;

/** Column names that only exist after migration 004. */
const POST_004_FIELDS = new Set<keyof TapDraft>([
  'designation',
  'company',
  'youtube',
  'custom_links',
  'theme_palette',
  'theme_layout',
  'theme_buttons',
  'theme_font',
  'theme_animation',
]);

function stripPost004(draft: TapDraft): TapDraft {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(draft)) {
    if (!POST_004_FIELDS.has(key as keyof TapDraft)) out[key] = value;
  }
  return out as TapDraft;
}

export async function saveTap(userId: string, draft: TapDraft): Promise<TapProfileRow> {
  const { data, error } = await supabase
    .from('tap_profiles')
    .update(draft)
    .eq('user_id', userId)
    .select(TAP_COLUMNS)
    .single();

  if (!error) return normaliseTap(data as unknown as Record<string, unknown>)!;
  if (!isMissingColumn(error)) throw error;

  const fallback = await supabase
    .from('tap_profiles')
    .update(stripPost004(draft))
    .eq('user_id', userId)
    .select(TAP_COLUMNS_BASE)
    .single();

  if (fallback.error) throw fallback.error;
  return normaliseTap(fallback.data as unknown as Record<string, unknown>)!;
}

/**
 * Moves the Tap through its lifecycle. `status` is the intent; a trigger keeps
 * the legacy `published` boolean in step, and the database refuses to make a
 * Tap live without a public address.
 */
export async function setTapStatus(userId: string, status: TapStatus): Promise<TapProfileRow> {
  const { data, error } = await supabase
    .from('tap_profiles')
    .update({ status })
    .eq('user_id', userId)
    .select(TAP_COLUMNS)
    .single();

  if (!error) return normaliseTap(data as unknown as Record<string, unknown>)!;
  if (!isMissingColumn(error)) throw error;

  // Before migration 004 there is only the boolean. Publishing and pausing
  // still work; a pause reads as "not published" to a visitor, which is the
  // behaviour that existed before the status model.
  const fallback = await supabase
    .from('tap_profiles')
    .update({ published: status === 'active' })
    .eq('user_id', userId)
    .select(TAP_COLUMNS_BASE)
    .single();

  if (fallback.error) throw fallback.error;
  return normaliseTap(fallback.data as unknown as Record<string, unknown>)!;
}

/**
 * Claims a public address. Runs server-side so uniqueness is checked without
 * granting the caller read access to anyone else's Tap.
 */
export async function claimSlug(slug: string): Promise<string> {
  const { data, error } = await supabase.rpc('claim_tap_slug', { p_slug: slug });
  if (error) throw error;
  return data as string;
}

/**
 * The editing rule — one content edit per 14 days, lifted by the Pass —
 * decided entirely by the database. The editor renders this; the trigger on
 * `tap_profiles` is what actually enforces it.
 */
export async function fetchEditState(): Promise<TapEditStateRow | null> {
  const { data, error } = await supabase.rpc('tap_edit_state');
  if (error) throw error;
  const rows = (data ?? []) as TapEditStateRow[];
  return rows.length > 0 ? rows[0]! : null;
}

/** Which customization options this customer's purchases actually unlock. */
export async function fetchThemeOptions(): Promise<ThemeOptions | null> {
  const { data, error } = await supabase.rpc('my_theme_options');
  if (error) throw error;
  return (data as ThemeOptions | null) ?? null;
}


export interface EventTheme {
  code: string;
  name: string;
  startsOn: string;
  endsOn: string;
  theme: TapTheme;
}

/** Current platform event theme. Event styling is a global platform layer, not a paid customer option. */
export async function fetchEventTheme(): Promise<EventTheme | null> {
  const { data, error } = await supabase.rpc('my_event_theme');
  if (error) throw error;
  if (!data || typeof data !== 'object' || !('theme' in data)) return null;
  const value = data as Partial<EventTheme>;
  if (!value.code || !value.name || !value.startsOn || !value.endsOn || !value.theme) return null;
  return {
    code: value.code,
    name: value.name,
    startsOn: value.startsOn,
    endsOn: value.endsOn,
    theme: value.theme,
  };
}

/**
 * The public read path deliberately does NOT live here.
 *
 * `lib/publicTapClient.ts` reads the same two SECURITY DEFINER functions with
 * plain fetch instead of the Supabase SDK, so the page a stranger opens after
 * tapping a card does not download ~57 kB gzipped of auth, realtime and storage
 * code to make two anonymous reads. Keep it that way: importing this module
 * from PublicTap would pull the SDK straight back into that bundle.
 */

/**
 * The address printed on the card and encoded in the QR.
 *
 * Deliberately the canonical site origin and not `window.location.origin`: a
 * QR generated from a deploy preview or from localhost would otherwise encode
 * a host that stops existing, and a printed card cannot be recalled. See
 * `lib/site.ts` for the override used by staging.
 */
export function tapUrl(slug: string): string {
  return `${SITE_URL}/t/${slug}`;
}

/** Suggests a slug from a display name; the server validates the final value. */
export function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export const EXPERIENCE_LABELS: Record<Experience, string> = {
  essential: 'Essential',
  business: 'Business',
  premium: 'Premium',
  goat: 'GOAT',
};

export const TAP_STATUS_LABELS: Record<TapStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  paused: 'Paused',
  archived: 'Archived',
};

export const TAP_STATUS_HINTS: Record<TapStatus, string> = {
  draft: 'Only you can see this profile. Publish it when you are ready.',
  active: 'Anyone with your link or card can open this profile.',
  paused: 'Visitors see a "temporarily unavailable" message instead of your profile.',
  archived: 'This Tap is retired and cannot be opened by visitors.',
};
