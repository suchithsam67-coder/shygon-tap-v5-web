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
