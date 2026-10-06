import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, RotateCw, Sparkles } from 'lucide-react';
import { TIERS_PATH } from '../../lib/commerce';

/**
 * Loading, empty and error states.
 *
 * Every data-backed surface uses all three. A skeleton that matches the shape
 * of the content it replaces avoids the layout jump you get from a spinner, and
 * an error state with a retry beats a blank page when Supabase is unreachable.
 */

export function Skeleton({ height = 12, width, radius = 10 }: {
  height?: number | string;
  width?: number | string;
  radius?: number;
}) {
  return (
    <div
      className="skeleton"
      style={{ height, width: width ?? '100%', borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton skeleton-text" />
      ))}
    </div>
  );
}

/** Skeleton shaped like a panel of rows, for list surfaces. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="panel-row">
          <Skeleton height={40} width={40} radius={13} />
          <div style={{ flex: 1 }}>
            <Skeleton height={13} width="42%" />
            <div style={{ height: 8 }} />
            <Skeleton height={11} width="26%" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="state">
      {icon && <div className="state-icon">{icon}</div>}
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

/**
 * A signed-in customer who has no Tap yet. Not an error: the first purchase
 * (an experience, D-10) creates the Tap page as a draft.
 */
export function NoTapState({ purpose }: { purpose: string }) {
  const navigate = useNavigate();
  return (
    <EmptyState
      icon={<Sparkles size={24} />}
      title="You don't have a Tap yet"
      description={`${purpose} Choose the experience your Tap opens in, and your Tap page is created as a draft once your payment is confirmed.`}
      action={
        <button type="button" className="btn btn-blue" onClick={() => navigate(TIERS_PATH)}>
          Choose your Tap experience <ArrowRight size={15} />
        </button>
      }
    />
  );
}

export function ErrorState({
  title = 'We could not load this',
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="state" role="alert">
      <div className="state-icon state-icon-warn">
        <AlertTriangle size={24} />
      </div>
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {onRetry && (
        <button type="button" className="btn btn-ghost" onClick={onRetry}>
          <RotateCw size={15} /> Try again
        </button>
      )}
    </div>
  );
}

/**
 * Shown when the schema a page needs has not been migrated yet. This is a
 * deployment state, not a customer error, so it says so plainly instead of
 * pretending the feature is merely empty.
 */
export function SetupRequiredState({ feature }: { feature: string }) {
  return (
    <div className="state" role="status">
      <div className="state-icon state-icon-warn">
        <AlertTriangle size={24} />
      </div>
      <h3>{feature} is almost ready</h3>
<p>
  We're finishing your Shygon Tap setup. Your account is safe.
  Please try again shortly or contact support if the problem continues.
</p>
    </div>
  );
}
