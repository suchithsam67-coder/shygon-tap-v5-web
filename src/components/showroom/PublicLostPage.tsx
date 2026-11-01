import BrandMark from '../brand/BrandMark';
import { PALETTES } from '../tap/palettes';
import { ReturnFinderView } from './ReturnFinderView';

/**
 * A Tap in Lost mode (AAROH-API v0.10 §6, DEC-2026-041 A-1): the owner's card
 * is missing, and whoever taps it sees only "Found this card?" and Return to
 * Owner's message form (§10a, unchanged).
 *
 * Nothing else: no Business or Info data, no owner name, photo or palette, and
 * no Connect, emergency or other mode. The page is drawn in SHYGON's own
 * colours because the owner's are part of their profile. PublicTap shows it
 * only after `public.status` said the relay can take a message; otherwise the
 * visitor gets the neutral "Tap not found". It records no visitor event.
 *
 * It lives in the experience chunk, which a Tap address downloads anyway, and
 * reuses that chunk's styles and finder view.
 */

const palette = PALETTES.midnight;
const style = {
  '--tap-ink': palette.ink,
  '--tap-haze': palette.haze,
  '--tap-accent': palette.accent,
  '--tap-spark': palette.spark,
  '--tap-on-accent': palette.onAccent,
} as React.CSSProperties;

export function PublicLostPage({ slug, hint }: { slug: string; hint: string | null }) {
  return (
    <div className="sr-page" style={style}>
      <div className="sr-aura" aria-hidden="true" />
      <div className="sr sr-view sr-lost" data-mode="lost">
        <main className="sr-view-body">
          <h1 className="sr-view-title">Found this card?</h1>
          <ReturnFinderView slug={slug} ownerName={null} hint={hint} variant="lost" />
        </main>
      </div>
      <p className="sr-footnote">
        <BrandMark className="sr-footnote-mark" /> Powered by SHYGON · <a href="/shygontap/privacy-policy">Privacy</a>
      </p>
    </div>
  );
}
