import { useState } from 'react';
import {
  Clock3,
  Eye,
  History,
  Link2,
  Monitor,
  MousePointerClick,
  Nfc,
  QrCode,
  Smartphone,
  Tablet,
  TrendingUp,
  Users,
} from 'lucide-react';
import { AppShell } from '../components/app/AppShell';
import { useAccount } from '../lib/account-context';
import { ErrorState, Skeleton } from '../components/app/States';
import { describeError, isMissingSchema } from '../lib/supabase';
import {
  densifyDaily,
  fetchPageAnalytics,
  fetchTapHistory,
  type PageAnalytics,
  type TapHistoryRow,
} from '../services/analytics';
import { formatCardCode } from '../services/tap';
import { useAsync } from '../hooks/useAsync';

/**
 * Tap analytics — card taps, profile views, QR scans, button clicks, unique
 * visitors, devices, and every card's own taps — aggregated server-side by
 * `get_page_analytics()` (migration 022). It filters on the caller's own pages,
 * so this page can only ever show the customer's own numbers.
 */

const WINDOWS = [7, 30, 90] as const;

const EVENT_LABELS: Record<string, string> = {
  nfc: 'Card tap',
  qr: 'QR scan',
  view: 'Profile view',
  link_click: 'Button click',
};

const DEVICE_LABELS: Record<string, string> = {
  mobile: 'Phone',
  tablet: 'Tablet',
  desktop: 'Computer',
  bot: 'Link preview / bot',
  unknown: 'Unknown',
};

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function Analytics() {
  const { tap, taps, loading: accountLoading, setupRequired: accountSetupMissing } = useAccount();

  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30);
  const [scope, setScope] = useState<'page' | 'all'>('page');
  const [cardId, setCardId] = useState<string>('');
  const [metric, setMetric] = useState<'views' | 'taps'>('taps');
  const tapFilter = scope === 'page' ? (tap?.id ?? null) : null;

  const { data, loading, error, reload } = useAsync(
    async () => {
      try {
        const [summary, history] = await Promise.all([
          fetchPageAnalytics(days, tapFilter, cardId || null),
          fetchTapHistory(tapFilter, cardId || null, 25),
        ]);
        return { summary, history, setupRequired: false };
      } catch (err) {
        if (isMissingSchema(err)) {
          return { summary: null as PageAnalytics | null, history: [] as TapHistoryRow[], setupRequired: true };
        }
        throw err;
      }
    },
    { deps: [days, tapFilter, cardId], onError: (err) => describeError(err) },
  );

  const summary = data?.summary ?? null;
  const history = data?.history ?? [];
  const setupRequired = data?.setupRequired ?? false;

  const series = summary ? densifyDaily(summary.daily, days) : [];
  const maxValue = Math.max(1, ...series.map((row) => row[metric]));
  const deviceTotal = Math.max(1, (summary?.devices ?? []).reduce((sum, row) => sum + row.count, 0));
  const pageCards = summary?.cards ?? [];

  return (
    <AppShell
      eyebrow="Your Tap"
      title="Analytics"
      description="How people discover and use your pages: card taps, views, QR scans, button clicks and the devices they use."
      pageScoped={scope === 'page'}
      actions={
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {WINDOWS.map((w) => (
            <button
              key={w}
              className={`btn btn-sm ${days === w ? 'btn-blue' : 'btn-ghost'}`}
              onClick={() => setDays(w)}
            >
              {w}d
            </button>
          ))}
          {taps.length > 1 && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setScope((current) => (current === 'page' ? 'all' : 'page'));
                setCardId('');
              }}
            >
              {scope === 'page' ? 'Show all pages' : 'Show one page'}
            </button>
          )}
          {pageCards.length > 1 && (
            <select
              className="select"
              value={cardId}
              onChange={(event) => setCardId(event.target.value)}
              aria-label="Card"
              style={{ width: 'auto', padding: '7px 10px', fontSize: 13 }}
            >
              <option value="">All cards</option>
              {pageCards.map((card) => (
                <option key={card.id} value={card.id}>
                  {card.nickname || `Card ${formatCardCode(card.code)}`}
                </option>
              ))}
            </select>
          )}
        </div>
      }
    >
      {accountLoading || loading ? (
        <>
          <div className="stat-grid">
            {Array.from({ length: 5 }, (_, i) => (
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
          <ErrorState message={error ?? undefined} onRetry={reload} />
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <Stat icon={<Nfc size={15} />} label="Card taps" value={summary.totals.taps} />
            <Stat icon={<Users size={15} />} label="Unique visitors" value={summary.totals.uniqueVisitors} />
            <Stat icon={<Eye size={15} />} label="Profile views" value={summary.totals.views} />
            <Stat icon={<MousePointerClick size={15} />} label="Button clicks" value={summary.totals.clicks} />
            <Stat icon={<QrCode size={15} />} label="QR scans" value={summary.totals.qr} />
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>
            <Clock3 size={12} style={{ display: 'inline', marginRight: 5, verticalAlign: '-1px' }} />
            {summary.lastTap
              ? `Last activity ${when(summary.lastTap.at)} — ${EVENT_LABELS[summary.lastTap.event] ?? summary.lastTap.event}${
                  summary.lastTap.cardCode
                    ? ` on ${summary.lastTap.cardNickname || `card ${formatCardCode(summary.lastTap.cardCode)}`}`
                    : ''
                }${summary.lastTap.device ? ` · ${DEVICE_LABELS[summary.lastTap.device] ?? summary.lastTap.device}` : ''}.`
              : 'No activity yet.'}{' '}
            {summary.detailed &&
              `All time: ${summary.lifetime.taps.toLocaleString('en-IN')} taps, ${summary.lifetime.views.toLocaleString('en-IN')} views.`}{' '}
            Unique visitors are counted per day.
          </p>

          <section className="panel" style={{ marginTop: 18 }}>
            <div className="panel-head">
              <div>
                <p className="mini-label">Daily</p>
                <h2>
                  {metric === 'taps' ? 'Card taps' : 'Profile views'} over the last {days} days
                </h2>
              </div>
              <div className="panel-head-actions">
                <button className={`btn btn-sm ${metric === 'taps' ? 'btn-blue' : 'btn-ghost'}`} onClick={() => setMetric('taps')}>
                  Taps
                </button>
                <button className={`btn btn-sm ${metric === 'views' ? 'btn-blue' : 'btn-ghost'}`} onClick={() => setMetric('views')}>
                  Views
                </button>
              </div>
            </div>
            <div className="panel-body">
              {summary.totals.views === 0 && summary.totals.taps === 0 ? (
                <div className="state" style={{ padding: '30px 20px' }}>
                  <div className="state-icon">
                    <TrendingUp size={22} />
                  </div>
                  <h3>No activity yet</h3>
                  <p>
                    {tap.published
                      ? 'Tap your card or share your link to start seeing activity here.'
                      : 'Publish your Tap to start tracking views, taps and scans.'}
                  </p>
                </div>
              ) : (
                <>
                  <div className="chart" role="img" aria-label={`${metric} per day over the last ${days} days`}>
                    {series.map((row, i) => (
                      <div key={row.day} className="chart-col" title={`${row.day}: ${row[metric]} ${metric}`}>
                        <div
                          className="chart-bar"
                          style={{
                            height: `${Math.max(2, (row[metric] / maxValue) * 100)}%`,
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

          {summary.detailed && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18, marginTop: 18 }}>
              <PeriodTable title="Weekly" rows={summary.weekly.map((row) => ({ label: `Week of ${row.week.slice(5)}`, ...row })).reverse()} />
              <PeriodTable
                title="Monthly"
                rows={summary.monthly
                  .map((row) => ({
                    label: new Date(`${row.month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }),
                    ...row,
                  }))
                  .reverse()}
              />
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18, marginTop: 18 }}>
            {summary.detailed && (
              <section className="panel">
                <div className="panel-head">
                  <Smartphone size={18} />
                  <div>
                    <h2>Devices</h2>
                  </div>
                </div>
                {summary.devices.length === 0 ? (
                  <div className="panel-body">
                    <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>No visits in this window yet.</p>
                  </div>
                ) : (
                  <div className="panel-body" style={{ display: 'grid', gap: 12 }}>
                    {summary.devices.map((row) => {
                      const Icon = row.device === 'desktop' ? Monitor : row.device === 'tablet' ? Tablet : Smartphone;
                      const share = Math.round((row.count / deviceTotal) * 100);
                      return (
                        <div key={row.device} style={{ display: 'grid', gap: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                            <Icon size={14} color="var(--muted)" />
                            <span style={{ flex: 1, fontWeight: 650 }}>{DEVICE_LABELS[row.device] ?? row.device}</span>
                            <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{row.count}</strong>
                            <span style={{ color: 'var(--muted)', width: 40, textAlign: 'right' }}>{share}%</span>
                          </div>
                          <div style={{ height: 6, borderRadius: 999, background: 'var(--ds-surface-raised)', overflow: 'hidden' }}>
                            <div style={{ width: `${share}%`, height: '100%', borderRadius: 999, background: 'var(--ds-accent, var(--blue))' }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            <section className="panel">
              <div className="panel-head">
                <MousePointerClick size={18} />
                <div>
                  <h2>Most clicked buttons</h2>
                </div>
              </div>
              {summary.links.length === 0 ? (
                <div className="panel-body">
                  <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>No button clicks in this window yet.</p>
                </div>
              ) : (
                <div className="panel-body-flush">
                  {summary.links.map((row, i) => (
                    <div key={row.key} className="panel-row" style={{ borderTop: i === 0 ? undefined : '1px solid var(--line)' }}>
                      <Link2 size={15} color="var(--muted)" />
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 650, textTransform: 'capitalize' }}>
                        {row.key.replace(/^link-(\d+)$/, 'Custom link $1')}
                      </span>
                      <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{row.clicks}</strong>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {summary.detailed && summary.cards.length > 0 && (
            <section className="panel" style={{ marginTop: 18 }}>
              <div className="panel-head">
                <Nfc size={18} />
                <div>
                  <h2>Your cards</h2>
                  <p>Taps in this window, all-time taps and when each card was last tapped.</p>
                </div>
              </div>
              <div className="panel-body-flush">
                {summary.cards.map((card, i) => (
                  <div key={card.id} className="panel-row" style={{ borderTop: i === 0 ? undefined : '1px solid var(--line)' }}>
                    <Nfc size={15} color="var(--muted)" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ fontSize: 13.5 }}>{card.nickname || `Card ${formatCardCode(card.code)}`}</strong>
                      <p style={{ margin: '3px 0 0', color: 'var(--muted)', fontSize: 12 }}>
                        {card.code ? `Card ID ${formatCardCode(card.code)} · ` : ''}
                        {card.lastTappedAt ? `last tapped ${when(card.lastTappedAt)}` : 'not tapped yet'}
                      </p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{card.taps}</strong>
                      <p style={{ margin: '3px 0 0', color: 'var(--muted)', fontSize: 12 }}>{card.lifetimeTaps} all time</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {summary.detailed && (
            <section className="panel" style={{ marginTop: 18 }}>
              <div className="panel-head">
                <History size={18} />
                <div>
                  <h2>Tap history</h2>
                  <p>The latest activity, newest first. Visitors are never identified.</p>
                </div>
              </div>
              {history.length === 0 ? (
                <div className="panel-body">
                  <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>Nothing yet.</p>
                </div>
              ) : (
                <div className="panel-body-flush">
                  {history.map((row, i) => (
                    <div
                      key={`${row.occurred_at}-${i}`}
                      className="panel-row"
                      style={{ borderTop: i === 0 ? undefined : '1px solid var(--line)', fontSize: 13 }}
                    >
                      <span style={{ width: 120, flex: '0 0 auto', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                        {when(row.occurred_at)}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, fontWeight: 650 }}>
                        {EVENT_LABELS[row.event_type] ?? row.event_type}
                        {row.link_key ? ` · ${row.link_key.replace(/^link-(\d+)$/, 'custom link $1')}` : ''}
                        {row.card_code ? ` · ${row.card_nickname || `card ${formatCardCode(row.card_code)}`}` : ''}
                      </span>
                      <span style={{ color: 'var(--muted)', textAlign: 'right' }}>
                        {DEVICE_LABELS[row.device_type ?? 'unknown'] ?? row.device_type}
                        {scope === 'all' && row.page_slug ? ` · /shygontap/${row.page_slug}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
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

function PeriodTable({ title, rows }: { title: string; rows: { label: string; taps: number; views: number }[] }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <p className="mini-label">{title}</p>
          <h2>Taps and views</h2>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="panel-body">
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>No activity yet.</p>
        </div>
      ) : (
        <div className="panel-body-flush">
          {rows.slice(0, 8).map((row, i) => (
            <div key={row.label} className="panel-row" style={{ borderTop: i === 0 ? undefined : '1px solid var(--line)', fontSize: 13 }}>
              <span style={{ flex: 1, fontWeight: 650 }}>{row.label}</span>
              <span style={{ color: 'var(--muted)' }}>
                <strong style={{ color: 'var(--ds-text)', fontVariantNumeric: 'tabular-nums' }}>{row.taps}</strong> taps ·{' '}
                <strong style={{ color: 'var(--ds-text)', fontVariantNumeric: 'tabular-nums' }}>{row.views}</strong> views
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
