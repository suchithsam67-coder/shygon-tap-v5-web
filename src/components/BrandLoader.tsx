import { MARK_PATH, MARK_VIEWBOX } from './brand/logoPaths';

/**
 * The SHYGON Tap loading screen: the SHYGON mark breathing inside NFC rings,
 * and the wordmark. The styles live inline in index.html so the very first
 * paint (before any JavaScript) already shows it; React reuses the same markup
 * while a page or the signed-in session loads. It fades in after a short
 * delay, so a fast load shows nothing at all rather than a flicker.
 */
export default function BrandLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="boot" role="status">
      <div className="boot-mark" aria-hidden="true">
        <span />
        <span />
        <span />
        <svg className="boot-logo" viewBox={MARK_VIEWBOX} aria-hidden="true">
          <path fillRule="evenodd" d={MARK_PATH} />
        </svg>
      </div>
      <p className="boot-word">
        SHYGON <b>TAP</b>
      </p>
      <p className="boot-sr">{label}</p>
    </div>
  );
}
