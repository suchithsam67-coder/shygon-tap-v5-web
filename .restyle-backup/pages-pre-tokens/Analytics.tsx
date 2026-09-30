import { useState } from 'react';
import { Link2, MousePointerClick, Nfc, QrCode, TrendingUp, Users } from 'lucide-react';
import { AppShell } from '../components/app/AppShell';
import { useAccount } from '../lib/account-context';
import { ErrorState, Skeleton } from '../components/app/States';
import { describeError, isMissingSchema } from '../lib/supabase';
import { densify, fetchAnalytics, type AnalyticsSummary } from '../services/analytics';
import { useAsync } from '../hooks/useAsync';

/**
 * Tap analytics — views, NFC taps, QR scans and link clicks, aggregated
 * server-side by `get_tap_analytics()` / `get_tap_link_clicks()`. Both RPCs
 * filter on the caller's own Tap, so this page can only ever show the
 * customer's own numbers; there is no way to point it at anyone else's.
 */

const WINDOWS = [7, 30, 90] as const;

export default function Analytics() {
  const { tap, loading: accountLoading, setupRequired: accountSetupMissing } = useAccount();

  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30);
  const { data, loading, error, reload } = useAsync(
    async () => {
      try {
        return { summary: await fetchAnalytics(days), setupRequired: false };
      } catch (err) {
        if (isMissingSchema(err)) {
          return { summary: null as AnalyticsSummary | null, setupRequired: true };
        }
        throw err;
      }
    },
    { deps: [days], onError: (err) => describeError(err) },
  );

  const summary = data?.summary ?? null;
  const setupRequired = data?.setupRequired ?? false;
  const load = reload;

  const series = summary ? densify(summary.series, days) : [];
  const maxViews = Math.max(1, ...series.map((row) => row.views));

  return (
    <AppShell
      eyebrow="Your Tap"
      title="Analytics"
      description="How people are discovering and using your published Tap."
      actions={
        <div style={{ display: 'flex', gap: 6 }}>
          {WINDOWS.map((w) => (
            <button
              key={w}
              className={`btn btn-sm ${days === w ? 'btn-blue' : 'btn-ghost'}`}
              onClick={() => setDays(w)}
            >
              {w}d
            </button>
          ))}
        </div>
      }
    >
      {accountLoading || loading ? (
        <>
          <div className="stat-grid">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="stat">
                <Skeleton height={11} width="55%" />
                <div style={{ height: 14 }} />
                <Skeleton height={28} width="35%" />
              </div>
            ))}
          </div>
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-body">
              <Skeleton height={168} radius={14} />
            </div>
          </div>
        </>
      ) : accountSetupMissing || setupRequired ? (
        <div className="panel">
          <ErrorState
            title="Analytics is not set up yet"
            message="The analytics tables have not been migrated on this environment."
          />
        </div>
      ) : !tap ? (
        <div className="panel">
          <ErrorState
            title="No Tap profile yet"
            message="Analytics appear once you have a Tap profile — purchase a SHYGON Tap card to get one."
          />
        </div>
      ) : error || !summary ? (
        <div className="panel">
          <ErrorState message={error ?? undefined} onRetry={load} />
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <Stat icon={<Users size={15} />} label="Unique visitors" value={summary.uniqueVisitors} />
            <Stat icon={<TrendingUp size={15} />} label="Profile views" value={summary.totalViews} />
            <Stat icon={<Nfc size={15} />} label="NFC taps" value={summary.totalNfc} />
            <Stat icon={<QrCode size={15} />} label="QR scans" value={summary.totalQr} />
          </div>

          <section className="panel" style={{ marginTop: 18 }}>
            <div className="panel-head">
              <div>
                <p className="mini-label">Trend</p>
                <h2>Views over the last {days} days</h2>
              </div>
            </div>
            <div className="panel-body">
              {summary.totalViews === 0 ? (
                <div className="state" style={{ padding: '30px 20px' }}>
                  <div className="state-icon">
                    <TrendingUp size={22} />
                  </div>
                  <h3>No views yet</h3>
                  <p>
                    {tap.published
                      ? 'Share your Tap link or tap your card to start seeing activity here.'
                      : 'Publish your Tap to start tracking views, taps and scans.'}
                  </p>
                </div>
              ) : (
                <>
                  <div className="chart" role="img" aria-label={`Views per day over the last ${days} days`}>
                    {series.map((row, i) => (
                      <div key={row.day} className="chart-col" title={`${row.day}: ${row.views} views`}>
                        <div
                          className="chart-bar"
                          style={{
                            height: `${Math.max(2, (row.views / maxViews) * 100)}%`,
                            animationDelay: `${i * 12}ms`,
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="chart-axis">
                    <span>{series[0]?.day.slice(5)}</span>
                    <span>{series[series.length - 1]?.day.slice(5)}</span>
                  </div>
                </>
              )}
            </div>
          </section>

          <section className="panel" style={{ marginTop: 18 }}>
            <div className="panel-head">
              <MousePointerClick size={18} />
              <div>
                <h2>Most clicked links</h2>
              </div>
            </div>
            {summary.topLinks.length === 0 ? (
              <div className="panel-body">
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>
                  No link clicks recorded in this window yet.
                </p>
              </div>
            ) : (
              <div className="panel-body-flush">
                {summary.topLinks.map((row, i) => (
                  <div key={row.link_key} className="panel-row" style={{ borderTop: i === 0 ? undefined : '1px solid #eef1f5' }}>
                    <Link2 size={15} color="var(--muted)" />
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 650, textTransform: 'capitalize' }}>
                      {row.link_key}
                    </span>
                    <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{row.clicks}</strong>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </AppShell>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="stat">
      <small>
        {icon} {label}
      </small>
      <strong>{value.toLocaleString('en-IN')}</strong>
    </div>
  );
}
