import { useState } from 'react';
import { Check, Loader2, Plus, Sparkles } from 'lucide-react';
import { AppShell } from '../components/app/AppShell';
import { useAccount } from '../lib/account-context';
import { useToast } from '../components/app/toast-context';
import { ErrorState, Skeleton } from '../components/app/States';
import { describeError } from '../lib/supabase';
import { fetchCatalog, priceLabel, type Catalog } from '../services/catalog';
import { CheckoutError, startCheckout } from '../services/payments';
import { useAsync } from '../hooks/useAsync';

/**
 * Paid customization add-ons — WhatsApp, Instagram, LinkedIn, website, and so
 * on. Modelled like a one-time in-app purchase: buy once, unlocked forever.
 *
 * Selecting several and checking out together sends one Razorpay order for the
 * whole batch; the server still prices, validates and grants each one
 * individually. Purchases are additive — buying again is a no-op the server
 * would happily accept, so already-owned items are simply not offered.
 */
export default function Customizations() {
  const { entitlements, loading: accountLoading, setupRequired, refresh } = useAccount();
  const toast = useToast();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [buying, setBuying] = useState(false);

  const {
    data: catalog,
    loading,
    error: loadError,
    reload: load,
  } = useAsync<Catalog>(fetchCatalog, { onError: (err) => describeError(err) });

  const available = (catalog?.customizations ?? []).filter(
    (item) => !entitlements.customizations.includes(item.key),
  );

  function toggle(sku: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  }

  const total = available
    .filter((item) => selected.has(item.sku))
    .reduce((sum, item) => sum + item.priceInPaise, 0);

  async function buy() {
    if (selected.size === 0) return;
    setBuying(true);
    try {
      await startCheckout({ orderType: 'customization', customizationSkus: [...selected] });
      await refresh();
      setSelected(new Set());
      toast.success(
        selected.size === 1 ? 'Add-on unlocked' : 'Add-ons unlocked',
        'Switch them on from your Tap profile.',
      );
    } catch (err) {
      if (err instanceof CheckoutError) {
        // A dismissed Razorpay modal is not a failure to apologise for.
        if (err.kind === 'cancelled') toast.info('Payment cancelled', "You haven't been charged.");
        else toast.error('Purchase failed', err.message);
      } else {
        toast.error('Purchase failed', describeError(err));
      }
    } finally {
      setBuying(false);
    }
  }

  return (
    <AppShell
      eyebrow="Add-ons"
      title="Customizations"
      description="Unlock individual profile capabilities. Each one is a one-time purchase, verified and granted by the server."
    >
      {loading || accountLoading ? (
        <div className="stat-grid">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="stat">
              <Skeleton height={12} width="60%" />
              <div style={{ height: 14 }} />
              <Skeleton height={20} width="40%" />
            </div>
          ))}
        </div>
      ) : setupRequired ? (
        <div className="panel">
          <ErrorState
            title="Add-ons are almost ready"
            message="We are finishing your SHYGON Tap setup. Your account is safe — please try again shortly."
          />
        </div>
      ) : loadError || !catalog ? (
        <div className="panel">
          <ErrorState message={loadError ?? undefined} onRetry={load} />
        </div>
      ) : (
        <>
          {entitlements.customizations.length > 0 && (
            <section className="panel" style={{ marginBottom: 18 }}>
              <div className="panel-head">
                <Check size={18} color="var(--ds-color-state-success)" />
                <div>
                  <h2>Purchased</h2>
                </div>
              </div>
              <div className="panel-body" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {entitlements.customizations.map((key) => (
                  <span key={key} className="pill pill-green" style={{ textTransform: 'capitalize' }}>
                    <Check size={12} /> {key}
                  </span>
                ))}
              </div>
            </section>
          )}

          {available.length === 0 ? (
            <div className="panel">
              <div className="state">
                <div className="state-icon">
                  <Sparkles size={24} />
                </div>
                <h3>You own every add-on</h3>
                <p>There is nothing left to unlock right now.</p>
              </div>
            </div>
          ) : (
            <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              {available.map((item, i) => {
                const checked = selected.has(item.sku);
                return (
                  <button
                    key={item.sku}
                    type="button"
                    className="stat reveal"
                    style={{
                      textAlign: 'left',
                      cursor: 'pointer',
                      borderColor: checked ? 'var(--blue)' : undefined,
                      boxShadow: checked ? '0 0 0 3px var(--ds-accent-soft)' : undefined,
                      ['--i' as string]: i,
                    }}
                    aria-pressed={checked}
                    onClick={() => toggle(item.sku)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <small>{item.name}</small>
                      <span
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 7,
                          display: 'grid',
                          placeItems: 'center',
                          border: '1.5px solid ' + (checked ? 'var(--blue)' : 'var(--ds-border-control)'),
                          background: checked ? 'var(--blue)' : 'transparent',
                          color: 'var(--ds-action-fg)',
                          flexShrink: 0,
                        }}
                      >
                        {checked ? <Check size={13} /> : <Plus size={13} color="var(--ds-text-tertiary)" />}
                      </span>
                    </div>
                    <strong>{priceLabel(item.priceInPaise)}</strong>
                    {item.shortDescription && <span>{item.shortDescription}</span>}
                  </button>
                );
              })}
            </div>
          )}

          {selected.size > 0 && (
            <div
              className="panel"
              style={{
                position: 'sticky',
                bottom: 16,
                marginTop: 20,
                padding: '14px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontSize: 13.5 }}>
                <strong>{selected.size}</strong> selected · <strong>{priceLabel(total)}</strong> total
              </span>
              <button className="btn btn-blue" onClick={() => void buy()} disabled={buying}>
                {buying ? <Loader2 size={15} className="spin" /> : null}
                {buying ? 'Opening Razorpay…' : `Pay ${priceLabel(total)}`}
              </button>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
