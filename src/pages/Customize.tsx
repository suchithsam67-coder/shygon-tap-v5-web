import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Loader2, Lock, Palette as PaletteIcon, RefreshCw, Sparkles } from 'lucide-react';
import { AppShell } from '../components/app/AppShell';
import { useAuth } from '../lib/auth-context';
import { useAccount } from '../lib/account-context';
import { useToast } from '../components/app/toast-context';
import { ErrorState, NoTapState, Skeleton } from '../components/app/States';
import { describeError, isMissingSchema } from '../lib/supabase';
import { EXPERIENCE_LABELS, fetchEventTheme, fetchThemeOptions, saveTap, themeOf } from '../services/tap';
import { PALETTES } from '../components/tap/palettes';
import { TapExperience } from '../components/tap/TapExperience';
import { useAsync } from '../hooks/useAsync';
import {
  DEFAULT_THEME,
  experienceRank,
  toExperience,
  type PublicProfile,
  type TapTheme,
  type ThemeOptions,
} from '../lib/database.types';

/**
 * The digital UI customizer.
 *
 * Which options appear is decided by the database (`my_theme_options()`), not
 * by this page: a customer's tier and their ₹999 Pass are what unlock palettes,
 * layouts, button styles, fonts and animation. The same rule is enforced again
 * on write by a trigger, so a locked option cannot be saved even if this page
 * were edited in devtools.
 *
 * The preview is the real `<TapExperience>` the public page mounts, so what a
 * customer approves here is what a visitor gets.
 */

const LAYOUT_LABELS: Record<string, string> = {
  classic: 'Classic',
  centered: 'Centered',
  split: 'Split',
  immersive: 'Immersive',
};

const BUTTON_LABELS: Record<string, string> = {
  solid: 'Solid',
  outline: 'Outline',
  glass: 'Glass',
  glow: 'Glow',
};

const FONT_LABELS: Record<string, string> = {
  sans: 'Sans',
  display: 'Display',
  mono: 'Mono',
  editorial: 'Editorial',
};

const ANIMATION_LABELS: Record<string, string> = {
  auto: 'Default for my experience',
  none: 'No opening animation',
  signature: 'Signature opening',
  dynamic: 'Adaptive (GOAT)',
};

/** Every option, so a locked one can still be shown as locked rather than hidden. */
const ALL: Record<keyof Omit<ThemeOptions, 'max_experience' | 'has_pass'>, string[]> = {
  palette: Object.keys(PALETTES),
  layout: ['classic', 'centered', 'split', 'immersive'],
  buttons: ['solid', 'outline', 'glass', 'glow'],
  font: ['sans', 'display', 'mono', 'editorial'],
  animation: ['auto', 'none', 'signature', 'dynamic'],
};

export default function Customize() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tap, entitlements, editState, loading: accountLoading, setupRequired, refresh, setTap } = useAccount();
  const toast = useToast();

  const [draft, setDraft] = useState<TapTheme | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [eventTheme, setEventTheme] = useState<{
    code: string; name: string; startsOn: string; endsOn: string; theme: TapTheme;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchEventTheme().then((value) => {
      if (!cancelled) setEventTheme(value);
    }).catch(() => {
      if (!cancelled) setEventTheme(null);
    });
    return () => { cancelled = true; };
  }, [previewNonce]);

  const {
    data: options,
    loading,
    error: optionsError,
    reload: load,
  } = useAsync<ThemeOptions | null>(fetchThemeOptions, {
    // Without migration 004 there is no option catalogue. Say so plainly rather
    // than presenting a customizer that cannot save.
    onError: (err) =>
      isMissingSchema(err)
        ? 'Customization is almost ready on this account. Please try again shortly.'
        : describeError(err, 'We could not load your customization options.'),
  });

  // Seeded during render — see the note in TapEditor.
  const [draftFor, setDraftFor] = useState<string | null>(null);
  if (tap && draftFor !== tap.id) {
    setDraftFor(tap.id);
    setDraft(themeOf(tap));
  }

  const dirty = useMemo(() => {
    if (!tap || !draft) return false;
    const current = themeOf(tap);
    return (Object.keys(draft) as (keyof TapTheme)[]).some((key) => draft[key] !== current[key]);
  }, [tap, draft]);

  const canEdit = editState?.can_edit === true;

  function allowed(kind: keyof typeof ALL, value: string): boolean {
    if (!options) return value === DEFAULT_THEME[kind === 'buttons' ? 'buttons' : kind];
    return (options[kind] as string[]).includes(value);
  }

  function pick(kind: keyof TapTheme, value: string) {
    if (!draft) return;
    setDraft({ ...draft, [kind]: value } as TapTheme);
    setPreviewNonce((n) => n + 1);
  }

  async function save() {
    if (!user || !draft) return;
    setSaving(true);
    try {
      setTap(
        await saveTap(user.id, {
          theme_palette: draft.palette,
          theme_layout: draft.layout,
          theme_buttons: draft.buttons,
          theme_font: draft.font,
          theme_animation: draft.animation,
        }),
      );
      await refresh();
      toast.success('Customization saved', 'Your public Tap now uses this look.');
    } catch (err) {
      toast.error('Could not save', describeError(err));
    } finally {
      setSaving(false);
    }
  }

  /** The live preview, from the saved profile plus the unsaved look. */
  const previewProfile: PublicProfile | null = useMemo(() => {
    if (!tap || !draft) return null;

    const selected = toExperience(tap.selected_ui_tier);
    const experience =
      experienceRank(selected) <= experienceRank(entitlements.maxExperience)
        ? selected
        : entitlements.maxExperience;

    const visible = new Set(
      (tap.enabled_customizations ?? []).filter(
        (key) => key === 'phone' || key === 'email' || entitlements.customizations.includes(key),
      ),
    );
    const shown = (key: string, value: string | null) => (visible.has(key) ? value : null);

    return {
      slug: tap.slug ?? 'preview',
      experience,
      displayName: tap.display_name,
      headline: tap.headline,
      designation: tap.designation,
      company: tap.company,
      bio: tap.bio,
      avatarUrl: tap.avatar_url,
      location: tap.location,
      phone: shown('phone', tap.phone),
      whatsapp: shown('whatsapp', tap.whatsapp),
      email: shown('email', tap.email),
      website: shown('website', tap.website),
      instagram: shown('instagram', tap.instagram),
      linkedin: shown('linkedin', tap.linkedin),
      youtube: shown('youtube', tap.youtube),
      customLinks: visible.has('links') ? tap.custom_links : [],
      theme: {
        palette: eventTheme?.theme.palette ?? draft.palette,
        layout: eventTheme?.theme.layout ?? draft.layout,
        buttons: eventTheme?.theme.buttons ?? draft.buttons,
        font: eventTheme?.theme.font ?? draft.font,
        animation: eventTheme?.theme.animation ?? draft.animation,
      },
      activeEvent: eventTheme,
    };
  }, [tap, draft, entitlements, eventTheme]);

  const experience = toExperience(tap?.selected_ui_tier);

  return (
    <AppShell
      eyebrow="Digital experience"
      title="Customize your Tap"
      description="Colour, layout, buttons, type and the opening animation. What you can choose depends on your experience and the Customization Pass."
      actions={
        <>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/shygontap/tiers')}>
            <Sparkles size={15} /> Change experience
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setPreviewNonce((n) => n + 1)}>
            <RefreshCw size={15} /> Replay opening
          </button>
        </>
      }
    >
      {accountLoading || loading ? (
        <div className="panel" style={{ padding: 22 }}>
          <Skeleton height={18} width="30%" />
          <div style={{ height: 16 }} />
          <Skeleton height={120} radius={16} />
        </div>
      ) : setupRequired || optionsError ? (
        <div className="panel">
          <ErrorState
            title="Customization is almost ready"
            message={optionsError ?? "We're finishing your SHYGON Tap setup. Please try again shortly."}
            onRetry={load}
          />
        </div>
      ) : !tap ? (
        <div className="panel">
          <NoTapState purpose="Colours, layout and fonts for your Tap are set here." />
        </div>
      ) : (
        <div className="tap-editor-layout">
          <div style={{ display: 'grid', gap: 18, minWidth: 0 }}>
            {!canEdit && (
              <section className="panel panel-warning">
                <div
                  className="panel-body"
                  style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <Lock size={18} color="var(--ds-color-state-warning)" />
                  <p style={{ margin: 0, flex: 1, minWidth: 220, fontSize: 13 }}>
                    You can change your Tap once every {editState?.interval_days ?? 14} days. Your
                    next change is available in {editState?.days_remaining ?? 0} day
                    {editState?.days_remaining === 1 ? '' : 's'}.
                  </p>
                  <button className="btn btn-blue btn-sm" onClick={() => navigate('/shygontap/tiers')}>
                    Edit anytime — ₹999
                  </button>
                </div>
              </section>
            )}

            <OptionGroup
              title="Colour palette"
              hint={
                options?.has_pass
                  ? 'The Customization Pass unlocks all twelve.'
                  : `Your ${EXPERIENCE_LABELS[experience]} experience unlocks ${options?.palette.length ?? 4}. The Pass unlocks all twelve.`
              }
              icon={<PaletteIcon size={18} />}
            >
              <div className="swatch-grid">
                {ALL.palette.map((id) => {
                  const palette = PALETTES[id as keyof typeof PALETTES];
                  const open = allowed('palette', id);
                  const active = draft?.palette === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`swatch${active ? ' is-active' : ''}${open ? '' : ' is-locked'}`}
                      disabled={!open || !canEdit}
                      aria-pressed={active}
                      onClick={() => pick('palette', id)}
                      title={open ? palette.label : `${palette.label} — locked`}
                    >
                      <span
                        className="swatch-chip"
                        style={{
                          background: `linear-gradient(135deg, ${palette.ink}, ${palette.haze} 55%, ${palette.accent})`,
                        }}
                      />
                      <span className="swatch-label">
                        {palette.label}
                        {!open && <Lock size={10} />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </OptionGroup>

            <OptionGroup title="Layout" hint="How the identity block is arranged.">
              <ChoiceRow
                values={ALL.layout}
                labels={LAYOUT_LABELS}
                current={draft?.layout}
                isAllowed={(v) => allowed('layout', v)}
                disabled={!canEdit}
                onPick={(v) => pick('layout', v)}
              />
            </OptionGroup>

            <OptionGroup title="Buttons" hint="The style of the Call and WhatsApp actions.">
              <ChoiceRow
                values={ALL.buttons}
                labels={BUTTON_LABELS}
                current={draft?.buttons}
                isAllowed={(v) => allowed('buttons', v)}
                disabled={!canEdit}
                onPick={(v) => pick('buttons', v)}
              />
            </OptionGroup>

            <OptionGroup title="Typography" hint="How your name is set.">
              <ChoiceRow
                values={ALL.font}
                labels={FONT_LABELS}
                current={draft?.font}
                isAllowed={(v) => allowed('font', v)}
                disabled={!canEdit}
                onPick={(v) => pick('font', v)}
              />
            </OptionGroup>

            <OptionGroup
              title="Opening animation"
              hint="Essential opens instantly by design. Every experience can turn its opening off."
            >
              <ChoiceRow
                values={ALL.animation}
                labels={ANIMATION_LABELS}
                current={draft?.animation}
                isAllowed={(v) => allowed('animation', v)}
                disabled={!canEdit}
                onPick={(v) => pick('animation', v)}
              />
            </OptionGroup>

            <div
              style={{
                position: 'sticky',
                bottom: 16,
                display: 'flex',
                justifyContent: 'flex-end',
              }}
            >
              <div
                className="panel"
                style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}
              >
                {dirty && <span className="pill pill-amber">Unsaved changes</span>}
                <button
                  className="btn btn-blue"
                  onClick={() => void save()}
                  disabled={saving || !dirty || !canEdit}
                >
                  {saving ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />}
                  {saving ? 'Saving…' : 'Save look'}
                </button>
              </div>
            </div>
          </div>

          <aside style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
            <section className="panel">
              <div className="panel-head">
                <div>
                  <p className="mini-label">Live preview</p>
                  <h2>{EXPERIENCE_LABELS[experience]}</h2>
                </div>
              </div>
              <div className="panel-body">
                {previewProfile && (
                  <div className="tap-preview-frame">
                    <TapExperience data={previewProfile} preview introKey={previewNonce} />
                  </div>
                )}
                <p className="field-hint" style={{ marginTop: 12 }}>
                  Exactly what a visitor sees. Unsaved changes are shown here but are not public
                  until you save.
                </p>
              </div>
            </section>
          </aside>
        </div>
      )}
    </AppShell>
  );
}

function OptionGroup({
  title,
  hint,
  icon,
  children,
}: {
  title: string;
  hint?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        {icon}
        <div>
          <h2>{title}</h2>
          {hint && <p>{hint}</p>}
        </div>
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

function ChoiceRow({
  values,
  labels,
  current,
  isAllowed,
  disabled,
  onPick,
}: {
  values: string[];
  labels: Record<string, string>;
  current: string | undefined;
  isAllowed: (value: string) => boolean;
  disabled?: boolean;
  onPick: (value: string) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {values.map((value) => {
        const open = isAllowed(value);
        const active = current === value;
        return (
          <button
            key={value}
            type="button"
            className={`choice-pill${active ? ' is-active' : ''}`}
            disabled={!open || disabled}
            aria-pressed={active}
            onClick={() => onPick(value)}
            title={open ? undefined : 'Locked on your plan'}
          >
            {labels[value] ?? value}
            {!open && <Lock size={11} />}
          </button>
        );
      })}
    </div>
  );
}
