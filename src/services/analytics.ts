import { supabase } from '../lib/supabase';
import type { TapAnalyticsRow, TapLinkClickRow } from '../lib/database.types';

/**
 * Tap analytics, aggregated in the database.
 *
 * Both RPCs filter on `t.user_id = auth.uid()`, so a customer can only ever see
 * their own numbers. Events are recorded by `record_tap_event()` against a
 * daily-rotating digest of user-agent + IP — enough to count returning visitors
 * within a day, not enough to follow anyone across days.
 */

export interface AnalyticsSummary {
  totalViews: number;
  totalNfc: number;
  totalQr: number;
  totalClicks: number;
  uniqueVisitors: number;
  series: TapAnalyticsRow[];
  topLinks: TapLinkClickRow[];
}

export const EMPTY_SUMMARY: AnalyticsSummary = {
  totalViews: 0,
  totalNfc: 0,
  totalQr: 0,
  totalClicks: 0,
  uniqueVisitors: 0,
  series: [],
  topLinks: [],
};

export async function fetchAnalytics(days = 30): Promise<AnalyticsSummary> {
  const [seriesResult, linksResult] = await Promise.all([
    supabase.rpc('get_tap_analytics', { p_days: days }),
    supabase.rpc('get_tap_link_clicks', { p_days: days }),
  ]);

  if (seriesResult.error) throw seriesResult.error;
  if (linksResult.error) throw linksResult.error;

  const series = ((seriesResult.data ?? []) as TapAnalyticsRow[]).map((row) => ({
    ...row,
    views: Number(row.views),
    nfc_taps: Number(row.nfc_taps),
    qr_scans: Number(row.qr_scans),
    link_clicks: Number(row.link_clicks),
    unique_visitors: Number(row.unique_visitors),
  }));

  const topLinks = ((linksResult.data ?? []) as TapLinkClickRow[]).map((row) => ({
    ...row,
    clicks: Number(row.clicks),
  }));

  return {
    totalViews: series.reduce((sum, row) => sum + row.views, 0),
    totalNfc: series.reduce((sum, row) => sum + row.nfc_taps, 0),
    totalQr: series.reduce((sum, row) => sum + row.qr_scans, 0),
    totalClicks: series.reduce((sum, row) => sum + row.link_clicks, 0),
    // Unique-per-day summed across days; a visitor on two days counts twice.
    uniqueVisitors: series.reduce((sum, row) => sum + row.unique_visitors, 0),
    series,
    topLinks,
  };
}

/** Fills gaps so a sparse series still draws a continuous chart. */
export function densify(series: TapAnalyticsRow[], days: number): TapAnalyticsRow[] {
  const byDay = new Map(series.map((row) => [row.day.slice(0, 10), row]));
  const out: TapAnalyticsRow[] = [];
  const today = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - i);
    const key = date.toISOString().slice(0, 10);
    out.push(
      byDay.get(key) ?? {
        day: key,
        views: 0,
        nfc_taps: 0,
        qr_scans: 0,
        link_clicks: 0,
        unique_visitors: 0,
      },
    );
  }

  return out;
}

/* -------------------------------------------------------------------------
   Page and card analytics (migration 022): one call returns everything the
   Analytics page shows, for one page, one card, or all of them.
   ------------------------------------------------------------------------- */

export interface DailyPoint {
  day: string;
  views: number;
  taps: number;
  qr: number;
  clicks: number;
  unique: number;
}

export interface PageAnalytics {
  days: number;
  totals: { views: number; taps: number; qr: number; clicks: number; uniqueVisitors: number };
  lifetime: { views: number; taps: number; qr: number; clicks: number; firstAt: string | null };
  daily: DailyPoint[];
  weekly: { week: string; views: number; taps: number }[];
  monthly: { month: string; views: number; taps: number }[];
  devices: { device: string; count: number }[];
  links: { key: string; clicks: number }[];
  cards: {
    id: string;
    code: string | null;
    nickname: string | null;
    status: string;
    tapProfileId: string | null;
    taps: number;
    lifetimeTaps: number;
    lastTappedAt: string | null;
  }[];
  lastTap: { at: string; event: string; device: string | null; cardCode: string | null; cardNickname: string | null } | null;
  /** False when the database predates migration 022 and only the basic series is available. */
  detailed: boolean;
}

export interface TapHistoryRow {
  occurred_at: string;
  event_type: string;
  device_type: string | null;
  link_key: string | null;
  referrer_host: string | null;
  page_slug: string | null;
  card_code: string | null;
  card_nickname: string | null;
}

const num = (value: unknown) => Number(value ?? 0) || 0;

function isMissingFunction(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'PGRST202' || code === '42883';
}

export async function fetchPageAnalytics(
  days: number,
  tapId?: string | null,
  cardId?: string | null,
): Promise<PageAnalytics> {
  const { data, error } = await supabase.rpc('get_page_analytics', {
    p_days: days,
    p_tap_id: tapId ?? null,
    p_card_id: cardId ?? null,
  });

  if (error) {
    if (!isMissingFunction(error)) throw error;
    // Before 022: the per-customer series and link clicks, nothing per card.
    const summary = await fetchAnalytics(days);
    return {
      days,
      totals: {
        views: summary.totalViews,
        taps: summary.totalNfc,
        qr: summary.totalQr,
        clicks: summary.totalClicks,
        uniqueVisitors: summary.uniqueVisitors,
      },
      lifetime: { views: summary.totalViews, taps: summary.totalNfc, qr: summary.totalQr, clicks: summary.totalClicks, firstAt: null },
      daily: summary.series.map((row) => ({
        day: row.day.slice(0, 10),
        views: row.views,
        taps: row.nfc_taps,
        qr: row.qr_scans,
        clicks: row.link_clicks,
        unique: row.unique_visitors,
      })),
      weekly: [],
      monthly: [],
      devices: [],
      links: summary.topLinks.map((row) => ({ key: row.link_key, clicks: row.clicks })),
      cards: [],
      lastTap: null,
      detailed: false,
    };
  }

  const raw = (data ?? {}) as Record<string, unknown>;
  const totals = (raw.totals ?? {}) as Record<string, unknown>;
  const lifetime = (raw.lifetime ?? {}) as Record<string, unknown>;
  return {
    days: num(raw.days) || days,
    totals: {
      views: num(totals.views),
      taps: num(totals.taps),
      qr: num(totals.qr),
      clicks: num(totals.clicks),
      uniqueVisitors: num(totals.uniqueVisitors),
    },
    lifetime: {
      views: num(lifetime.views),
      taps: num(lifetime.taps),
      qr: num(lifetime.qr),
      clicks: num(lifetime.clicks),
      firstAt: (lifetime.firstAt as string | null) ?? null,
    },
    daily: ((raw.daily ?? []) as Record<string, unknown>[]).map((row) => ({
      day: String(row.day),
      views: num(row.views),
      taps: num(row.taps),
      qr: num(row.qr),
      clicks: num(row.clicks),
      unique: num(row.unique),
    })),
    weekly: ((raw.weekly ?? []) as Record<string, unknown>[]).map((row) => ({
      week: String(row.week),
      views: num(row.views),
      taps: num(row.taps),
    })),
    monthly: ((raw.monthly ?? []) as Record<string, unknown>[]).map((row) => ({
      month: String(row.month),
      views: num(row.views),
      taps: num(row.taps),
    })),
    devices: ((raw.devices ?? []) as Record<string, unknown>[]).map((row) => ({
      device: String(row.device ?? 'unknown'),
      count: num(row.count),
    })),
    links: ((raw.links ?? []) as Record<string, unknown>[]).map((row) => ({
      key: String(row.key),
      clicks: num(row.clicks),
    })),
    cards: ((raw.cards ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      code: (row.code as string | null) ?? null,
      nickname: (row.nickname as string | null) ?? null,
      status: String(row.status ?? ''),
      tapProfileId: (row.tapProfileId as string | null) ?? null,
      taps: num(row.taps),
      lifetimeTaps: num(row.lifetimeTaps),
      lastTappedAt: (row.lastTappedAt as string | null) ?? null,
    })),
    lastTap: (raw.lastTap as PageAnalytics['lastTap']) ?? null,
    detailed: true,
  };
}

export async function fetchTapHistory(
  tapId?: string | null,
  cardId?: string | null,
  limit = 25,
): Promise<TapHistoryRow[]> {
  const { data, error } = await supabase.rpc('get_tap_history', {
    p_tap_id: tapId ?? null,
    p_card_id: cardId ?? null,
    p_limit: limit,
  });
  if (error) {
    if (isMissingFunction(error)) return [];
    throw error;
  }
  return (data ?? []) as TapHistoryRow[];
}

/** Fills the days with no events, so the chart is continuous (India time). */
export function densifyDaily(points: DailyPoint[], days: number): DailyPoint[] {
  const byDay = new Map(points.map((point) => [point.day, point]));
  const out: DailyPoint[] = [];
  const todayIst = new Date(Date.now() + 5.5 * 3600 * 1000);
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(todayIst);
    date.setUTCDate(date.getUTCDate() - i);
    const key = date.toISOString().slice(0, 10);
    out.push(byDay.get(key) ?? { day: key, views: 0, taps: 0, qr: 0, clicks: 0, unique: 0 });
  }
  return out;
}
