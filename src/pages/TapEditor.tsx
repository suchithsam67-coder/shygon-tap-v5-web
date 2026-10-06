import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarClock,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  Globe,
  Instagram,
  Linkedin,
  Loader2,
  Lock,
  Mail,
  MapPin,
  MessageCircle,
  Pause,
  Phone,
  Play,
  QrCode,
  RefreshCw,
  Share2,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { AppShell } from '../components/app/AppShell';
import { useAuth } from '../lib/auth-context';
import { useAccount } from '../lib/account-context';
import { useToast } from '../components/app/toast-context';
import { ConfirmDialog } from '../components/app/ConfirmDialog';
import { ErrorState, NoTapState, SetupRequiredState, Skeleton } from '../components/app/States';
import { describeError, supabase } from '../lib/supabase';
import {
  EXPERIENCE_LABELS,
  TAP_STATUS_HINTS,
  TAP_STATUS_LABELS,
  claimSlug,
  fetchEventTheme,
  saveTap,
  setTapStatus,
  suggestSlug,
  tapUrl,
  type TapDraft,
} from '../services/tap';
import { ownsExperience } from '../services/entitlements';
import { QrCodeCanvas } from '../components/app/QrCode';
import { TapExperience } from '../components/tap/TapExperience';
import {
  DEFAULT_THEME,
  experienceRank,
  toExperience,
  type Experience,
  type PublicProfile,
  type TapStatus,
} from '../lib/database.types';

/**
 * The Tap profile editor: edit → preview → publish → share.
 *
 * Edits are held as a local draft and written to `tap_profiles` on save, so a
 * half-typed bio never reaches a live Tap. The preview renders the very same
 * `<TapExperience>` component the public page mounts, clamped by the same
 * entitlements the server would apply — so "preview" means the real thing, not
 * an approximation of it.
 *
 * The 14-day editing window is shown here and enforced in the database by a
 * trigger on `tap_profiles`. Disabling the inputs is a courtesy; the rule holds
 * whether or not this page cooperates.
 */

const CONTACT_ADDONS = [
  { key: 'whatsapp', icon: MessageCircle, label: 'WhatsApp' },
  { key: 'website', icon: Globe, label: 'Website' },
  { key: 'instagram', icon: Instagram, label: 'Instagram' },
  { key: 'linkedin', icon: Linkedin, label: 'LinkedIn' },
  { key: 'location', icon: MapPin, label: 'Location & Directions' },
] as const;

const ALWAYS_ON = ['phone', 'email'];

export default function TapEditor() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tap, entitlements, editState, loading, setupRequired, error, refresh, setTap } =
    useAccount();
  const toast = useToast();

  const [draft, setDraft] = useState<TapDraft | null>(null);
  const [slugInput, setSlugInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [slugError, setSlugError] = useState('');
  const [confirmPause, setConfirmPause] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [justPublished, setJustPublished] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [eventTheme, setEventTheme] = useState<Awaited<ReturnType<typeof fetchEventTheme>>>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchEventTheme().then((value) => {
      if (!cancelled) setEventTheme(value);
    }).catch(() => {
      if (!cancelled) setEventTheme(null);
    });
    return () => { cancelled = true; };
  }, [previewNonce]);

  // Seeded during render rather than in an effect: React's documented way to
  // adjust state when the value it derives from changes. An effect would paint
  // one frame of an empty form first, and `!draft` alone would never re-seed if
  // the Tap were replaced.
  const [draftFor, setDraftFor] = useState<string | null>(null);
  if (tap && draftFor !== tap.id) {
    setDraftFor(tap.id);
    {
      setDraft({
        display_name: tap.display_name ?? '',
        headline: tap.headline ?? '',
        bio: tap.bio ?? '',
        avatar_url: tap.avatar_url ?? '',
        location: tap.location ?? '',
        phone: tap.phone ?? '',
        whatsapp: tap.whatsapp ?? '',
        email: tap.email ?? '',
        website: tap.website ?? '',
        instagram: tap.instagram ?? '',
        linkedin: tap.linkedin ?? '',
        designation: tap.designation ?? '',
        company: tap.company ?? '',
        youtube: tap.youtube ?? '',
        enabled_customizations: tap.enabled_customizations ?? ALWAYS_ON,
      });
      setSlugInput(tap.slug ?? '');
    }
  }

  const changed = useMemo(() => {
    if (!tap || !draft) return [] as (keyof TapDraft)[];
    return (Object.keys(draft) as (keyof TapDraft)[]).filter((key) => {
      if (key === 'enabled_customizations') {
        const a = [...(draft.enabled_customizations ?? [])].sort();
        const b = [...(tap.enabled_customizations ?? [])].sort();
        return JSON.stringify(a) !== JSON.stringify(b);
      }
      if (key === 'custom_links') {
        return JSON.stringify(draft.custom_links ?? []) !== JSON.stringify(tap.custom_links ?? []);
      }
      return (draft[key] ?? '') !== ((tap as unknown as Record<string, unknown>)[key] ?? '');
    });
  }, [tap, draft]);
  const dirty = changed.length > 0;
  // Showing or hiding a field is not a content edit (enforce_tap_edit_rules),
  // so it can be saved even while the editing window is closed: a customer can
  // always take their number off the public page (V6-071).
  const visibilityOnly = dirty && changed.every((key) => key === 'enabled_customizations');

  // The edit-state RPC is authoritative. Never turn an unknown state into an
  // unlocked editor; a real database error must fail closed.
  const canEdit = editState?.can_edit === true;
  const coolingDown = editState?.reason === 'cooling_down';
  const intervalDays = editState?.interval_days ?? 14;
  const status: TapStatus = tap?.status ?? 'draft';

  function update<K extends keyof TapDraft>(key: K, value: TapDraft[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  /** Phone and email need no add-on; their switch only shows or hides them. */
  function toggleContact(key: 'phone' | 'email') {
    if (!draft) return;
    const current = draft.enabled_customizations ?? [];
    update(
      'enabled_customizations',
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    );
  }

  function toggleAddon(key: string) {
    if (!draft) return;
    if (!entitlements.customizations.includes(key)) return;
    const current = draft.enabled_customizations ?? [];
    update(
      'enabled_customizations',
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    );
  }

  /**
   * Exactly what a visitor would get: the draft, clamped to what the customer
   * is entitled to, in the same shape `get_public_tap()` returns.
   */
  const previewRow: PublicProfile | null = useMemo(() => {
    if (!tap || !draft) return null;

    const selected = toExperience(tap.selected_ui_tier);
    const experience: Experience =
      experienceRank(selected) <= experienceRank(entitlements.maxExperience)
        ? selected
        : entitlements.maxExperience;

    const visible = new Set(
      (draft.enabled_customizations ?? []).filter(
        (key) => ALWAYS_ON.includes(key) || entitlements.customizations.includes(key),
      ),
    );
    const shown = (key: string, value: string | null | undefined) =>
      visible.has(key) ? (value ?? null) : null;

    return {
      slug: tap.slug ?? 'preview',
      experience,
      displayName: draft.display_name ?? null,
      headline: draft.headline ?? null,
      designation: draft.designation ?? null,
      company: draft.company ?? null,
      bio: draft.bio ?? null,
      avatarUrl: draft.avatar_url || null,
      location: shown('location', draft.location),
      phone: shown('phone', draft.phone),
      whatsapp: shown('whatsapp', draft.whatsapp),
      email: shown('email', draft.email),
      website: shown('website', draft.website),
      instagram: shown('instagram', draft.instagram),
      linkedin: shown('linkedin', draft.linkedin),
      youtube: shown('youtube', draft.youtube),
      customLinks: visible.has('links') ? (draft.custom_links ?? []) : [],
      activeEvent: eventTheme,
      theme: {
        ...DEFAULT_THEME,
        palette: eventTheme?.theme.palette ?? draft.theme_palette ?? tap.theme_palette ?? DEFAULT_THEME.palette,
        layout: eventTheme?.theme.layout ?? draft.theme_layout ?? tap.theme_layout ?? DEFAULT_THEME.layout,
        buttons: eventTheme?.theme.buttons ?? draft.theme_buttons ?? tap.theme_buttons ?? DEFAULT_THEME.buttons,
        font: eventTheme?.theme.font ?? draft.theme_font ?? tap.theme_font ?? DEFAULT_THEME.font,
        animation: eventTheme?.theme.animation ?? draft.theme_animation ?? tap.theme_animation ?? DEFAULT_THEME.animation,
      },
    };
  }, [tap, draft, entitlements, eventTheme]);

  const openPreview = useCallback(() => {
    setPreviewNonce((n) => n + 1);
    setShowPreview(true);
  }, []);

  async function save() {
    if (!user || !draft) return;
    setSaving(true);
    try {
      // While the window is closed only the visibility switches are sent.
      const saved = await saveTap(user.id, canEdit ? draft : { enabled_customizations: draft.enabled_customizations });
      setTap(saved);
      await refresh();
      toast.success('Saved', 'Your Tap profile has been updated.');
    } catch (err) {
      // The database refuses restricted edits once the window closes. Say what
      // happened and what to do about it rather than showing a policy error.
      if (!canEdit || coolingDown) {
        toast.error(
          `You can edit once every ${intervalDays} days`,
          'The Customization Pass removes the limit for a one-time ₹999.',
        );
      } else if (navigator.onLine === false) {
        toast.error("You're offline", "Your changes haven't been saved. Reconnect and try again.");
      } else {
        toast.error('Could not save', describeError(err));
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleClaimSlug() {
    setSlugError('');
    setClaiming(true);
    try {
      const claimed = await claimSlug(slugInput);
      setSlugInput(claimed);
      await refresh();
      toast.success('Tap address claimed', `Your Tap will live at ${tapUrl(claimed)}`);
    } catch (err) {
      setSlugError(describeError(err, 'That address could not be claimed.'));
    } finally {
      setClaiming(false);
    }
  }

  async function changeStatus(next: TapStatus) {
    if (!user || !tap) return;

    if (next === 'active') {
      if (!tap.slug) {
        toast.error('Claim your Tap address first', 'A Tap needs a public address to go live.');
        return;
      }
      if (dirty) {
        toast.error('Save your changes first', 'Publish once your latest edits are saved.');
        return;
      }
    }

    setStatusBusy(true);
    try {
      setTap(await setTapStatus(user.id, next));
      if (next === 'active') {
        setJustPublished(true);
        toast.success('Your Tap is live', 'Share it — one tap opens your profile.');
      } else if (next === 'paused') {
        toast.success('Tap paused', 'Visitors now see a "temporarily unavailable" message.');
      } else {
        toast.success(`Tap set to ${TAP_STATUS_LABELS[next].toLowerCase()}`);
      }
    } catch (err) {
      toast.error('Could not change status', describeError(err));
    } finally {
      setStatusBusy(false);
      setConfirmPause(false);
    }
  }

  async function uploadAvatar(file: File) {
    if (!user) return;
    setAvatarUploading(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('profile-images')
        .upload(path, file, { cacheControl: '3600', upsert: true });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('profile-images').getPublicUrl(path);
      update('avatar_url', data.publicUrl);
      toast.success('Photo uploaded', 'Save your profile to keep this photo.');
    } catch (err) {
      toast.error('Upload failed', describeError(err));
    } finally {
      setAvatarUploading(false);
    }
  }

  function copyLink() {
    if (!tap?.slug) return;
    void navigator.clipboard.writeText(tapUrl(tap.slug));
    toast.success('Link copied');
  }

  async function shareLink() {
    if (!tap?.slug) return;
    const url = tapUrl(tap.slug);
    if (navigator.share) {
      try {
        await navigator.share({ title: draft?.display_name || 'My SHYGON Tap', url });
        return;
      } catch {
        /* share sheet dismissed */
      }
    }
    copyLink();
  }

  const experienceOwned = ownsExperience(entitlements, toExperience(tap?.selected_ui_tier));

  return (
    <AppShell
      eyebrow="Your SHYGON Tap"
      title="Tap profile"
      description="This is what people see the instant they tap your card or scan your QR. Anything you publish here is public to anyone with the link, so share only what you're happy for others to see."
      actions={
        tap ? (
          <>
            <button className="btn btn-ghost btn-sm" onClick={openPreview}>
              <Eye size={15} /> Preview
            </button>
            {tap.slug && (
              <>
                <button className="btn btn-ghost btn-sm" onClick={copyLink}>
                  <Copy size={15} /> Copy link
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => void shareLink()}>
                  <Share2 size={15} /> Share
                </button>
              </>
            )}
          </>
        ) : undefined
      }
    >
      {loading ? (
        <div className="panel">
          <div className="panel-body">
            <Skeleton height={140} radius={20} />
            <div style={{ height: 16 }} />
            <Skeleton height={40} />
          </div>
        </div>
      ) : setupRequired ? (
        <div className="panel">
          <SetupRequiredState feature="The Tap profile" />
        </div>
      ) : error && !tap ? (
        <div className="panel">
          <ErrorState message={error} onRetry={refresh} />
        </div>
      ) : !tap ? (
        <div className="panel">
          <NoTapState purpose="This is where you write your Tap page and publish it." />
        </div>
      ) : (
        <>
          {/* ------------------------------------------- the editing window */}
          {editState && (
            <section
              className={canEdit ? 'panel' : 'panel panel-warning'}
              style={{ marginBottom: 18 }}
            >
              <div
                className="panel-body"
                style={{
                  display: 'flex',
                  gap: 14,
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
                  {editState.has_pass ? (
                    <Sparkles size={19} color="var(--blue)" />
                  ) : canEdit ? (
                    <CalendarClock size={19} color="var(--blue)" />
                  ) : (
                    <Lock size={19} color="var(--ds-color-state-warning)" />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: 14 }}>
                      {editState.has_pass
                        ? 'Customization Pass — edit as often as you like'
                        : canEdit
                          ? 'You can make one change now'
                          : `Next change in ${editState.days_remaining} day${editState.days_remaining === 1 ? '' : 's'}`}
                    </strong>
                    <p style={{ margin: '3px 0 0', color: 'var(--muted)', fontSize: 12.5 }}>
                      {editState.has_pass
                        ? 'Every colour palette on your experience is unlocked too.'
                        : canEdit
                          ? `Profile changes are limited to one every ${intervalDays} days. Publishing, pausing and switching to something you own are never limited.`
                          : `You last changed your profile on ${editState.last_edit_at ? new Date(editState.last_edit_at).toLocaleDateString('en-IN') : 'a recent date'}. The Customization Pass removes this limit.`}
                    </p>
                  </div>
                </div>
                {!editState.has_pass && (
                  <button className="btn btn-blue btn-sm" onClick={() => navigate('/shygontap/tiers')}>
                    <Sparkles size={14} /> {canEdit ? 'See the Pass' : 'Edit anytime — ₹999'}
                  </button>
                )}
              </div>
            </section>
          )}

          {/* --------------------------------- the "you are live" moment */}
          {justPublished && tap.slug && status === 'active' && (
            <section
              className="panel panel-success"
              style={{ marginBottom: 18 }}
            >
              <div className="panel-body">
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <CheckCircle2 size={22} color="var(--ds-color-state-success)" style={{ flex: '0 0 auto', marginTop: 2 }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <strong style={{ fontSize: 15 }}>Your Tap is live</strong>
                    <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 13 }}>
                      Anyone who taps your card or opens your link sees your profile now.
                    </p>
                    <div
                      style={{
                        marginTop: 12,
                        padding: '10px 12px',
                        borderRadius: 12,
                        background: 'var(--ds-surface-raised)',
                        border: '1px solid var(--line)',
                        fontSize: 13,
                        fontWeight: 650,
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {tapUrl(tap.slug).replace(/^https?:\/\//, '')}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                      <button className="btn btn-blue btn-sm" onClick={() => void shareLink()}>
                        <Share2 size={14} /> Share
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={copyLink}>
                        <Copy size={14} /> Copy link
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setShowQr(true)}>
                        <QrCode size={14} /> QR code
                      </button>
                      <a
                        className="btn btn-ghost btn-sm"
                        href={tapUrl(tap.slug)}
                        target="_blank"
                        rel="noreferrer"
                        style={{ textDecoration: 'none' }}
                      >
                        <ExternalLink size={14} /> Open public Tap
                      </a>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setJustPublished(false)}
                      >
                        Done
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          <div className="tap-editor-layout">
            <div style={{ display: 'grid', gap: 20, minWidth: 0 }}>
              <section className="panel">
                <div className="panel-head">
                  <UserRound size={19} />
                  <div>
                    <h2>About you</h2>
                    <p>Shown at the top of your public Tap.</p>
                  </div>
                </div>
                <div className="panel-body">
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 20 }}>
                    <div
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: 20,
                        overflow: 'hidden',
                        background: 'var(--blue-soft)',
                        display: 'grid',
                        placeItems: 'center',
                        flex: '0 0 auto',
                      }}
                    >
                      {draft?.avatar_url ? (
                        <img
                          src={draft.avatar_url}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <UserRound size={26} color="var(--blue)" />
                      )}
                    </div>
                    <div>
                      <label
                        className="btn btn-ghost btn-sm"
                        style={{ cursor: canEdit ? 'pointer' : 'not-allowed', opacity: canEdit ? 1 : 0.55 }}
                      >
                        {avatarUploading ? <Loader2 size={14} className="spin" /> : null}
                        {avatarUploading ? 'Uploading…' : 'Change photo'}
                        <input
                          type="file"
                          accept="image/*"
                          hidden
                          disabled={avatarUploading || !canEdit}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void uploadAvatar(file);
                          }}
                        />
                      </label>
                      <p className="field-hint" style={{ marginTop: 8 }}>JPG, PNG or WebP</p>
                    </div>
                  </div>

                  <label className="field">
                    <span>Display name</span>
                    <input
                      className="input"
                      value={draft?.display_name ?? ''}
                      disabled={!canEdit}
                      onChange={(e) => update('display_name', e.target.value)}
                      placeholder="Your name"
                    />
                  </label>

                  <label className="field">
                    <span>Headline</span>
                    <input
                      className="input"
                      value={draft?.headline ?? ''}
                      disabled={!canEdit}
                      onChange={(e) => update('headline', e.target.value)}
                      placeholder="Founder · SHYGON Technologies"
                      maxLength={80}
                    />
                  </label>

                  <div className="field-row">
                    <label className="field">
                      <span>Designation</span>
                      <input
                        className="input"
                        value={draft?.designation ?? ''}
                        disabled={!canEdit}
                        onChange={(e) => update('designation', e.target.value)}
                        placeholder="Founder"
                        maxLength={60}
                      />
                    </label>
                    <label className="field">
                      <span>Company</span>
                      <input
                        className="input"
                        value={draft?.company ?? ''}
                        disabled={!canEdit}
                        onChange={(e) => update('company', e.target.value)}
                        placeholder="SHYGON Technologies"
                        maxLength={60}
                      />
                    </label>
                  </div>

                  <label className="field">
                    <span>Bio</span>
                    <textarea
                      className="textarea"
                      rows={3}
                      maxLength={220}
                      value={draft?.bio ?? ''}
                      disabled={!canEdit}
                      onChange={(e) => update('bio', e.target.value)}
                      placeholder="Tell people a little about yourself…"
                    />
                    <p className="field-hint" style={{ textAlign: 'right' }}>
                      {(draft?.bio ?? '').length}/220
                    </p>
                  </label>

                  <p className="field-hint" style={{ margin: 0 }}>
                    Location is an optional paid add-on. Turn it on below after purchasing it.
                  </p>
                </div>
              </section>

              <section className="panel">
                <div className="panel-head">
                  <Phone size={19} />
                  <div>
                    <h2>Contact</h2>
                    <p>Phone and email need no add-on. Switch any of them off to keep it off your public Tap.</p>
                  </div>
                </div>
                <div className="panel-body">
                  {([
                    { key: 'phone', label: 'Phone', icon: Phone, placeholder: '+91 98765 43210', type: 'tel' },
                    { key: 'email', label: 'Email', icon: Mail, placeholder: 'you@example.com', type: 'email' },
                  ] as const).map(({ key, label, icon: Icon, placeholder, type }) => (
                    <div key={key} style={{ marginBottom: 16 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: 7,
                          gap: 10,
                        }}
                      >
                        <label
                          htmlFor={`tap-contact-${key}`}
                          style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ds-text-secondary)' }}
                        >
                          {label}
                        </label>
                        <label
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 7,
                            fontSize: 12,
                            fontWeight: 650,
                            color: 'var(--muted)',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={(draft?.enabled_customizations ?? []).includes(key)}
                            onChange={() => toggleContact(key)}
                          />
                          Show on Tap
                        </label>
                      </div>
                      <div className="input-prefixed">
                        <Icon size={15} />
                        <input
                          id={`tap-contact-${key}`}
                          type={type}
                          value={draft?.[key] ?? ''}
                          disabled={!canEdit}
                          onChange={(e) => update(key, e.target.value)}
                          placeholder={placeholder}
                        />
                      </div>
                    </div>
                  ))}

                  {CONTACT_ADDONS.map(({ key, icon: Icon, label }) => {
                    const owned = entitlements.customizations.includes(key);
                    const enabled = (draft?.enabled_customizations ?? []).includes(key);
                    const fieldKey = key as keyof TapDraft;

                    return (
                      <div key={key} style={{ marginBottom: 16 }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: 7,
                            gap: 10,
                          }}
                        >
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ds-text-secondary)' }}>{label}</span>
                          {owned ? (
                            <label
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 7,
                                fontSize: 12,
                                fontWeight: 650,
                                color: 'var(--muted)',
                              }}
                            >
                              <input type="checkbox" checked={enabled} onChange={() => toggleAddon(key)} />
                              Show on Tap
                            </label>
                          ) : (
                            <button
                              type="button"
                              className="pill pill-amber"
                              style={{ border: 0, cursor: 'pointer' }}
                              onClick={() => navigate('/shygontap/customizations')}
                            >
                              <Lock size={11} /> Locked — add-on
                            </button>
                          )}
                        </div>
                        <div className="input-prefixed">
                          <Icon size={15} />
                          <input
                            value={(draft?.[fieldKey] as string) ?? ''}
                            disabled={!owned || !canEdit}
                            onChange={(e) => update(fieldKey, e.target.value as never)}
                            placeholder={key === 'whatsapp' ? '+91 98765 43210' : `Your ${label}`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <div
                style={{
                  position: 'sticky',
                  bottom: 16,
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 10,
                }}
              >
                <div
                  className="panel"
                  style={{
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  {dirty && <span className="pill pill-amber">Unsaved changes</span>}
                  <button className="btn btn-ghost btn-sm" onClick={openPreview}>
                    <Eye size={15} /> Preview
                  </button>
                  <button
                    className="btn btn-blue"
                    onClick={() => void save()}
                    disabled={saving || !dirty || !(canEdit || visibilityOnly)}
                  >
                    {saving ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />}
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </div>
            </div>

            <aside style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <p className="mini-label">Public address</p>
                    <h2>Your Tap link</h2>
                  </div>
                </div>
                <div className="panel-body">
                  {tap.slug ? (
                    <>
                      <div
                        style={{
                          padding: '10px 12px',
                          borderRadius: 12,
                          background: 'var(--ds-surface-raised)',
                          border: '1px solid var(--line)',
                          fontSize: 13,
                          fontWeight: 650,
                          wordBreak: 'break-all',
                        }}
                      >
                        {tapUrl(tap.slug).replace(/^https?:\/\//, '')}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                        <button className="btn btn-ghost btn-sm" onClick={copyLink}>
                          <Copy size={13} /> Copy
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => void shareLink()}>
                          <Share2 size={13} /> Share
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setShowQr(true)}>
                          <QrCode size={13} /> QR code
                        </button>
                        <a
                          className="btn btn-ghost btn-sm"
                          href={tapUrl(tap.slug)}
                          target="_blank"
                          rel="noreferrer"
                          style={{ textDecoration: 'none' }}
                        >
                          <ExternalLink size={13} /> View
                        </a>
                      </div>
                      <p className="field-hint" style={{ marginTop: 10 }}>
                        This is the address your card's NFC chip and QR code open.
                      </p>
                    </>
                  ) : (
                    <>
                      <label className="field" style={{ marginBottom: 8 }}>
                        <span>Choose your Tap address</span>
                        <input
                          className="input"
                          value={slugInput}
                          aria-invalid={Boolean(slugError)}
                          onChange={(e) => {
                            setSlugInput(suggestSlug(e.target.value));
                            setSlugError('');
                          }}
                          placeholder="your-name"
                        />
                        {slugError && <p className="field-error">{slugError}</p>}
                        <p className="field-hint">/tap/{slugInput || 'your-name'}</p>
                      </label>
                      <button
                        className="btn btn-blue btn-block"
                        onClick={() => void handleClaimSlug()}
                        disabled={claiming || slugInput.trim().length < 3}
                      >
                        {claiming ? <Loader2 size={14} className="spin" /> : null}
                        {claiming ? 'Claiming…' : 'Claim address'}
                      </button>
                    </>
                  )}
                </div>
              </section>

              {/* ------------------------------------------------ Tap status */}
              <section className="panel">
                <div className="panel-body" style={{ display: 'grid', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700 }}>Tap status</span>
                    <span className={status === 'active' ? 'pill pill-green' : 'pill'}>
                      <span className="pill-dot" />
                      {TAP_STATUS_LABELS[status]}
                    </span>
                  </div>
                  <p className="field-hint" style={{ margin: 0 }}>
                    {TAP_STATUS_HINTS[status]}
                  </p>

                  {status === 'active' ? (
                    <button
                      className="btn btn-block"
                      onClick={() => setConfirmPause(true)}
                      disabled={statusBusy}
                    >
                      {statusBusy ? <Loader2 size={15} className="spin" /> : <Pause size={15} />}
                      Pause Tap
                    </button>
                  ) : (
                    <button
                      className="btn btn-block btn-blue"
                      onClick={() => void changeStatus('active')}
                      disabled={statusBusy}
                    >
                      {statusBusy ? <Loader2 size={15} className="spin" /> : <Play size={15} />}
                      {status === 'paused' ? 'Resume Tap' : 'Publish Tap'}
                    </button>
                  )}

                  {status === 'paused' && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => void changeStatus('draft')}
                      disabled={statusBusy}
                    >
                      Move back to draft
                    </button>
                  )}
                </div>
              </section>

              <section className="panel">
                <div className="panel-head">
                  <div>
                    <p className="mini-label">Digital experience</p>
                    <h2>{EXPERIENCE_LABELS[toExperience(tap.selected_ui_tier)]}</h2>
                  </div>
                  <div className="panel-head-actions">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => navigate('/shygontap/tiers')}
                    >
                      Change
                    </button>
                  </div>
                </div>
                <div className="panel-body">
                  <p className="field-hint" style={{ margin: 0 }}>
                    {experienceOwned
                      ? 'Your public Tap opens in this experience.'
                      : `You have not purchased this experience — your Tap opens in ${EXPERIENCE_LABELS[entitlements.maxExperience]} instead.`}
                  </p>
                </div>
              </section>
            </aside>
          </div>
        </>
      )}

      {/* -------------------------------------------------------- preview */}
      {showPreview && previewRow && (
        <div
          className="modal-scrim"
          onMouseDown={(e) => e.target === e.currentTarget && setShowPreview(false)}
        >
          <div className="modal tap-preview-modal">
            <div className="tap-preview-head">
              <div style={{ minWidth: 0 }}>
                <p className="mini-label">Preview</p>
                <h2 style={{ margin: '4px 0 0' }}>
                  {EXPERIENCE_LABELS[previewRow.experience]} experience
                </h2>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setPreviewNonce((n) => n + 1)}>
                  <RefreshCw size={13} /> Replay
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowPreview(false)}>
                  Close
                </button>
              </div>
            </div>
            <p className="field-hint" style={{ margin: '0 0 12px' }}>
              Exactly what a visitor sees, including anything hidden because it needs an add-on you
              do not own yet.
            </p>
            <div className="tap-preview-frame">
              <TapExperience data={previewRow} preview introKey={previewNonce} />
            </div>
            {dirty && (
              <p className="field-hint" style={{ margin: '12px 0 0' }}>
                You are previewing unsaved changes. Save, then publish, to make them public.
              </p>
            )}
          </div>
        </div>
      )}

      {tap?.slug && showQr && (
        <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && setShowQr(false)}>
          <div className="modal" style={{ textAlign: 'center' }}>
            <h2>Your Tap QR code</h2>
            <p>Scanning this opens your public Tap profile.</p>
            <div style={{ display: 'grid', placeItems: 'center', margin: '18px 0' }}>
              <QrCodeCanvas value={tapUrl(tap.slug)} size={220} />
            </div>
            <div className="modal-actions" style={{ justifyContent: 'center' }}>
              <button className="btn btn-ghost" onClick={() => setShowQr(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmPause}
        title="Pause your Tap?"
        description="Visitors will see a 'temporarily unavailable' message instead of your profile. Your content is kept, and you can resume any time."
        confirmLabel="Pause Tap"
        tone="danger"
        busy={statusBusy}
        onConfirm={() => void changeStatus('paused')}
        onCancel={() => setConfirmPause(false)}
      />
    </AppShell>
  );
}
