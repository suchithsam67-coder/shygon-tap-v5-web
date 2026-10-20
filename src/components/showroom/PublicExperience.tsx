import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import BrandMark from '../brand/BrandMark';
import type { PublicProfile } from '../../lib/database.types';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { TapExperience } from '../tap/TapExperience';
import { paletteOf } from '../tap/palettes';
import { isModeId, liveModesFor, MODE_ORDER, type ModeId } from './modes';
import { fetchConnectAvailable } from '../../lib/publicConnectClient';
import { fetchPublicAlertsAvailable } from '../../lib/publicEmergencyClient';
import { fetchRescueStatus, recallToken, rememberToken } from '../../lib/publicRescueClient';
import { ReturnFinderView } from './ReturnFinderView';
import { EmergencyPublicView } from './EmergencyPublicView';
import { BusinessView, ContactView, EmergencyDemoView, LinksView, ModeFrame, OwnerView } from './ModeViews';
import { PriveDemoView } from './PriveDemoView';
import { TapOpening } from './TapOpening';
import { TapShowroom } from './TapShowroom';
import './showroom.css';

/**
 * The public AAROH experience: opening, showroom, a mode, back to the showroom.
 *
 * Loaded lazily by the public Tap page, which starts the download in parallel
 * with the profile request, so it adds no wait and nothing to the entry bundle.
 *
 * The mode lives in the address (`?mode=contact`): the phone's back button
 * returns to the showroom, and a mode can be linked to directly. Any other
 * query parameter, such as `src=nfc`, is kept as it is.
 *
 * Which modes a real Tap shows is derived from what the owner published
 * (modes.ts). The demo showroom passes `demo` and gets every mode, with sample
 * data and real statuses.
 */

/**
 * Modes with a view of their own. Coming-soon and unsupported ones have none.
 * Emergency opens the labelled walkthrough on the demo, and the real relay on a
 * Tap whose owner turned visitor alerts on (only then is it in the list).
 */
function viewable(id: ModeId, demo: boolean): boolean {
  // On a real Tap these are in the list only when their server said yes.
  if (id === 'emergency') return true;
  if (id === 'return') return !demo;
  if (id === 'prive') return demo;
  return id === 'identity' || id === 'business' || id === 'contact' || id === 'links' || id === 'owner';
}

/**
 * FE-D1, safe default B: the SHYGON opening plays on every Tap, unless the
 * owner turned their opening off or the visitor asks for reduced motion.
 */
function wantsOpening(data: PublicProfile, demo: boolean): boolean {
  return demo || data.theme.animation !== 'none';
}

export default function PublicExperience({
  data,
  demo = false,
  opening: withOpening = true,
  onShare,
  onLinkClick,
  footer,
}: {
  data: PublicProfile;
  demo?: boolean;
  /**
   * Play the SHYGON opening here. The public Tap passes false: it plays the
   * opening itself, as its loading state, before this chunk has even arrived.
   */
  opening?: boolean;
  onShare?: () => void;
  onLinkClick?: (key: string) => void;
  /** Replaces the default footer line (the demo uses its own). */
  footer?: React.ReactNode;
}) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const reduced = useReducedMotion();

  // Whether this Tap accepts visitor emergency alerts: one call per page view,
  // after the profile has rendered and never blocking it (contract §10.3).
  // Until it answers, and on any failure, the answer is no.
  const [alertsAvailable, setAlertsAvailable] = useState(false);
  // The same for the Return-to-Owner relay (contract §10a), with the owner's note.
  const [rescue, setRescue] = useState<{ available: boolean; hint: string | null }>({ available: false, hint: null });
  // And SHYGON Connect (contract §10b): asking needs a signed-in account, so the card links to that page.
  const [connectAvailable, setConnectAvailable] = useState(false);
  useEffect(() => {
    if (demo) return;
    // A saved Return-to-Owner link carries its token in the fragment. Move it to
    // this tab's storage and out of the address bar straight away, so Share or
    // a copied address can never carry it, whatever the relay's state.
    if (/(?:^#|&)rt=/.test(window.location.hash)) {
      const token = recallToken(data.slug);
      if (token) rememberToken(data.slug, token);
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    }
    let live = true;
    void fetchPublicAlertsAvailable(data.slug).then((available) => live && setAlertsAvailable(available));
    void fetchRescueStatus(data.slug).then((status) => live && setRescue(status));
    void fetchConnectAvailable(data.slug).then((available) => live && setConnectAvailable(available));
    return () => {
      live = false;
    };
  }, [demo, data.slug]);

  const modes = useMemo(
    () =>
      demo ? [...MODE_ORDER] : liveModesFor(data, { emergency: alertsAvailable, rescue: rescue.available, connect: connectAvailable }),
    [data, demo, alertsAvailable, rescue.available, connectAvailable],
  );
  const requested = params.get('mode');
  const mode: ModeId | null = isModeId(requested) && modes.includes(requested) && viewable(requested, demo) ? requested : null;

  // The opening plays once per visit, on the showroom, and never over a deep link.
  const [opening, setOpening] = useState(() => withOpening && mode === null && wantsOpening(data, demo) && !reduced);
  const [entering, setEntering] = useState(false);
  const endOpening = useCallback(() => {
    setOpening(false);
    setEntering(true);
  }, []);

  // The card a visitor just came back from, so the showroom can return them to
  // it; and whether the profile view's own opening (the owner's tier) has
  // played. Both follow the mode, so they are adjusted during render, before
  // the showroom mounts, rather than in an effect after it.
  const [prevMode, setPrevMode] = useState<ModeId | null>(mode);
  const [returnTo, setReturnTo] = useState<ModeId | null>(null);
  const [identitySeen, setIdentitySeen] = useState(false);
  if (prevMode !== mode) {
    setPrevMode(mode);
    if (prevMode && !mode) setReturnTo(prevMode);
    if (prevMode === 'identity') setIdentitySeen(true);
  }

  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, [mode]);

  const withMode = (next: ModeId | null) => {
    const search = new URLSearchParams(params);
    if (next) search.set('mode', next);
    else search.delete('mode');
    const query = search.toString();
    return { pathname: location.pathname, search: query ? `?${query}` : '' };
  };

  const open = (next: ModeId) => {
    // A keyboard user can reach a card under the curtain; choosing one ends it.
    setOpening(false);
    setEntering(false);
    navigate(withMode(next), { state: { showroom: true } });
  };

  const back = () => {
    // Opened from the showroom: step back, so history stays one entry deep.
    // Arrived on a mode's link: replace it with the showroom instead.
    if ((location.state as { showroom?: boolean } | null)?.showroom) navigate(-1);
    else navigate(withMode(null), { replace: true });
  };

  const palette = paletteOf(data.theme.palette);
  const style = {
    '--tap-ink': palette.ink,
    '--tap-haze': palette.haze,
    '--tap-accent': palette.accent,
    '--tap-spark': palette.spark,
    '--tap-on-accent': palette.onAccent,
  } as React.CSSProperties;

  if (mode === 'identity') {
    const shown = identitySeen ? { ...data, theme: { ...data.theme, animation: 'none' as const } } : data;
    return <TapExperience data={shown} onShare={onShare} onLinkClick={onLinkClick} onBack={back} />;
  }

  let body: React.ReactNode;
  if (mode) {
    body = (
      <ModeFrame mode={mode} onBack={back}>
        {mode === 'business' && <BusinessView data={data} onLinkClick={onLinkClick} />}
        {mode === 'contact' && <ContactView data={data} onLinkClick={onLinkClick} onShare={onShare} />}
        {mode === 'links' && <LinksView data={data} onLinkClick={onLinkClick} demo={demo} />}
        {mode === 'owner' && <OwnerView data={data} />}
        {mode === 'emergency' && (demo ? <EmergencyDemoView /> : <EmergencyPublicView data={data} />)}
        {mode === 'prive' && <PriveDemoView />}
        {mode === 'return' && <ReturnFinderView data={data} hint={rescue.hint} />}
      </ModeFrame>
    );
  } else {
    body = (
      <main className="sr-main">
        <TapShowroom
          data={data}
          modes={modes}
          demo={demo}
          canOpen={(id) => viewable(id, demo)}
          returnTo={returnTo}
          entering={entering}
          onOpen={open}
          onLinkClick={onLinkClick}
          onShare={onShare}
        />
      </main>
    );
  }

  return (
    <div className={`sr-page ${opening ? 'is-behind-opening' : ''}`.trim()} style={style}>
      <div className="sr-aura" aria-hidden="true" />
      {body}
      {footer ?? (
        <p className="sr-footnote">
          <BrandMark className="sr-footnote-mark" /> Powered by SHYGON · <a href="/aaroh/experience">What is SHYGON AAROH?</a> ·{' '}
          <a href="/shygontap/privacy-policy">Privacy</a>
        </p>
      )}
      {opening && <TapOpening caption="One card. Many possibilities." onDone={endOpening} />}
    </div>
  );
}
