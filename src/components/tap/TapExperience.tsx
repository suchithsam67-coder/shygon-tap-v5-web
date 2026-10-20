import { useMemo, useState } from 'react';
import BrandMark from '../brand/BrandMark';
import {
  ArrowLeft,
  Briefcase,
  ExternalLink,
  Globe,
  Instagram,
  Link2,
  Linkedin,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Share2,
  Sparkles,
  Youtube,
} from 'lucide-react';
import type { Experience, PublicProfile } from '../../lib/database.types';
import { ExperienceIntro } from './ExperienceIntro';
import { hasOpeningAnimation } from './intro-rules';
import { TapDepthField } from './TapDepthField';
import { paletteOf } from './palettes';

/**
 * One renderer for all four digital experiences.
 *
 * The public Tap page and the editor's preview both mount this, so what a
 * customer previews is literally the component a visitor gets — there is no
 * second "preview-flavoured" implementation to drift out of sync.
 *
 *   Essential  clean single card, no opening animation, nothing to wait for
 *   Business   professional layout with a role/company block and a brief opening
 *   Premium    Business plus depth, a specular surface and a cinematic opening
 *   GOAT       Premium plus a signature opening and a UI that adapts itself
 *
 * The experience passed in is whatever `get_public_profile()` decided the
 * customer is entitled to. This component never reads entitlements and cannot
 * upgrade itself.
 */

/**
 * GOAT's dynamic layer.
 *
 * The brief asks for a UI that "adapts its visual presentation based on events
 * or profile information". This does it from two real inputs and nothing
 * invented: the visitor's local time of day, and whether the profile carries a
 * company (a business Tap gets a steadier treatment than a personal one).
 *
 * It only shifts hue and intensity — it never changes what is on the card, so
 * a customer can still predict what a visitor will see.
 */
function useDynamicAccent(experience: Experience, profile: PublicProfile) {
  return useMemo(() => {
    if (experience !== 'goat') return null;

    const hour = new Date().getHours();
    const phase =
      hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night';

    // A company Tap leans calmer; a personal one leans expressive.
    const intensity = profile.company ? 0.7 : 1;

    const shift: Record<string, number> = {
      morning: -18,
      afternoon: 0,
      evening: 22,
      night: 42,
    };

    return { phase, hueShift: shift[phase] ?? 0, intensity };
  }, [experience, profile.company]);
}

function href(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

export function TapExperience({
  data,
  onLinkClick,
  onShare,
  /** Renders inside the editor rather than as a whole page. */
  preview = false,
  /** Replays the opening animation; the preview uses it as a key. */
  introKey,
  /** Back to the AAROH showroom, when the profile was opened from it. */
  onBack,
}: {
  data: PublicProfile;
  onLinkClick?: (key: string) => void;
  onShare?: () => void;
  preview?: boolean;
  introKey?: string | number;
  onBack?: () => void;
}) {
  const experience = data.experience;
  const theme = data.theme;

  /**
   * Which opening has finished, rather than a boolean "has finished".
   *
   * A boolean initialised from the first render goes stale the moment the
   * experience changes or the preview replays the opening: `useState` does not
   * re-run its initialiser, so the intro would play again over an
   * already-revealed card.
   */
  const introToken = `${experience}:${theme.animation}:${introKey ?? ''}`;
  const [revealedFor, setRevealedFor] = useState<string | null>(null);
  const introDone =
    !hasOpeningAnimation(experience, theme.animation) || revealedFor === introToken;

  const palette = paletteOf(theme.palette);
  const dynamic = useDynamicAccent(experience, data);

  const whatsapp = data.whatsapp?.replace(/\D/g, '');
  const isBusinessLike = experience !== 'essential';

  const track = (key: string) => () => onLinkClick?.(key);

  const directionHref = data.location
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(data.location)}`
    : undefined;

  const links = [
    directionHref && { key: 'location', icon: MapPin, label: 'Directions', href: directionHref, external: true },
    data.website && { key: 'website', icon: Globe, label: 'Website', href: href(data.website), external: true },
    data.instagram && { key: 'instagram', icon: Instagram, label: 'Instagram', href: href(data.instagram), external: true },
    data.linkedin && { key: 'linkedin', icon: Linkedin, label: 'LinkedIn', href: href(data.linkedin), external: true },
    data.youtube && { key: 'youtube', icon: Youtube, label: 'YouTube', href: href(data.youtube), external: true },
    data.email && { key: 'email', icon: Mail, label: 'Email', href: `mailto:${data.email}`, external: false },
    ...data.customLinks.map((link, i) => ({
      key: `link-${i}`,
      icon: Link2,
      label: link.label || 'Link',
      href: href(link.url),
      external: true,
    })),
  ].filter(Boolean) as {
    key: string;
    icon: typeof Globe;
    label: string;
    href: string | undefined;
    external: boolean;
  }[];

  const subtitle = [data.designation, data.company].filter(Boolean).join(' · ') || data.headline;

  return (
    <div
      className={[
        'tap-experience',
        `tap-experience-${experience}`,
        `tap-layout-${theme.layout}`,
        `tap-buttons-${theme.buttons}`,
        `tap-font-${theme.font}`,
        preview ? 'tap-experience-preview' : '',
        introDone ? 'is-revealed' : 'is-opening',
        dynamic ? `tap-phase-${dynamic.phase}` : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        ['--tap-ink' as string]: palette.ink,
        ['--tap-haze' as string]: palette.haze,
        ['--tap-accent' as string]: palette.accent,
        ['--tap-spark' as string]: palette.spark,
        ['--tap-on-accent' as string]: palette.onAccent,
        ['--tap-hue-shift' as string]: `${dynamic?.hueShift ?? 0}deg`,
        ['--tap-intensity' as string]: `${dynamic?.intensity ?? 1}`,
      }}
    >
      <div className="tap-aura" aria-hidden="true" />
      {/*
        GOAT's immersive layout puts a real perspective-projected depth field
        behind the card. It is only mounted for that one combination, so no
        other experience pays for the animation frame.
      */}
      {experience === 'goat' && theme.layout === 'immersive' && (
        <TapDepthField accent={palette.spark} />
      )}
      {experience === 'goat' && theme.layout !== 'immersive' && (
        <div className="tap-goat-grid" aria-hidden="true" />
      )}

      <ExperienceIntro
        key={introToken}
        experience={experience}
        animation={theme.animation}
        onDone={() => setRevealedFor(introToken)}
      />

      <div className="tap-stage">
        <main className="tap-column">
          <div className="tap-topbar">
            {onBack && (
              <button type="button" onClick={onBack} className="tap-back-button">
                <ArrowLeft size={16} aria-hidden="true" /> Showroom
              </button>
            )}
            {experience !== 'essential' && (
              <span className="tap-chip">
                <Sparkles size={11} /> {experience === 'goat' ? 'GOAT' : experience}
              </span>
            )}
            {data.activeEvent && (
              <span className="tap-chip" title={`${data.activeEvent.name} · ${data.activeEvent.startsOn}–${data.activeEvent.endsOn}`}>
                {data.activeEvent.name}
              </span>
            )}
            {onShare && (
              <button type="button" onClick={onShare} className="tap-icon-button" aria-label="Share this Tap">
                <Share2 size={18} />
              </button>
            )}
          </div>

          <section className="tap-card">
            <div className="tap-card-layer tap-card-layer-avatar">
              <div className="tap-avatar">
                {data.avatarUrl ? (
                  <img src={data.avatarUrl} alt="" />
                ) : (
                  (data.displayName ?? 'S').slice(0, 1).toUpperCase()
                )}
              </div>
            </div>

            <div className="tap-card-layer tap-card-layer-identity">
              <p className="tap-eyebrow">SHYGON TAP</p>
              <h1>{data.displayName || 'SHYGON Tap'}</h1>
              {subtitle && <p className="tap-headline">{subtitle}</p>}
              {data.bio && <p className="tap-bio">{data.bio}</p>}
              {data.location && (
                <p className="tap-location">
                  <MapPin size={15} />
                  {data.location}
                </p>
              )}
            </div>

            <div className="tap-card-layer tap-card-layer-actions">
              <div className="tap-primary-actions">
                {data.phone && (
                  <a href={`tel:${data.phone}`} onClick={track('phone')} className="tap-action tap-action-primary">
                    <Phone size={17} /> Call
                  </a>
                )}
                {whatsapp && (
                  <a
                    href={`https://wa.me/${whatsapp}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={track('whatsapp')}
                    className="tap-action tap-action-whatsapp"
                  >
                    <MessageCircle size={17} /> WhatsApp
                  </a>
                )}
              </div>

              {/*
                Business and above lead with who this is professionally. Only
                fields the customer actually published are rendered — there are
                no invented opening hours or placeholder services here.
              */}
              {isBusinessLike && (data.designation || data.company || data.location) && (
                <div className="tap-business-block">
                  {(data.designation || data.company) && (
                    <div>
                      <Briefcase size={15} />
                      <span>
                        <small>ROLE</small>
                        {[data.designation, data.company].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                  )}
                  {data.location && (
                    <div>
                      <MapPin size={15} />
                      <span>
                        <small>BASED IN</small>
                        {data.location}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {links.length > 0 && (
                <div className="tap-links">
                  {links.map(({ key, icon: Icon, label, href: target, external }) => (
                    <a
                      key={key}
                      href={target}
                      onClick={track(key)}
                      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
                      className="tap-link"
                    >
                      <Icon size={18} />
                      <span>{label}</span>
                      {external && <ExternalLink size={15} />}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </section>

          <p className="tap-footnote"><BrandMark className="tap-footnote-mark" /> Powered by SHYGON Tap · <a href="/shygontap/privacy-policy">Privacy</a></p>
        </main>
      </div>
    </div>
  );
}
