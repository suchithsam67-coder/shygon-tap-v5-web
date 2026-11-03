import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, FileText, Layers } from 'lucide-react';
import { AppShell } from '../components/app/AppShell';
import { ConfirmDialog } from '../components/app/ConfirmDialog';
import { ErrorState, Skeleton } from '../components/app/States';
import { InfoView } from '../components/info/PublicInfoPage';
import { INFO_CATEGORY_LABEL } from '../components/info/categories';
import { INFO_RELEASED, LOST_RELEASED, PREVIEW_PAGES } from '../components/showroom/modes';
import type { InfoCategory, PublicInfo } from '../lib/database.types';
import {
  INFO_LIMITS,
  ModesError,
  activateMode,
  clearInfo,
  getInfo,
  getModesState,
  previewInfo,
  saveInfo,
  type InfoField,
  type InfoState,
  type ModesState,
  type PublicationStatus,
  type TapMode,
} from '../services/tapMode';

/**
 * What your Tap shows: your Business profile, an Info page, or the Lost page
 * (AAROH-API v0.8 §6, Lost v0.10; DEC-2026-041 and A-1). Every state on this
 * page is the server's: a switch or a save shows as done only after its 200,
 * and the words "Live" are never used (owner, 2026-10-20 §3); "Showing on your
 * Tap" says the same thing plainly. Not linked anywhere until Info or Lost is
 * released; a production build redirects this address (Q-C, `OwnerPage`), and
 * shows only the released modes' parts of it.
 */

const SHOW_INFO = INFO_RELEASED || PREVIEW_PAGES;
const SHOW_LOST = LOST_RELEASED || PREVIEW_PAGES;

const DESCRIPTION =
  SHOW_INFO && SHOW_LOST
    ? 'Your Business profile, an Info page about a thing or a place, or Lost mode if your card is missing.'
    : SHOW_LOST
      ? 'Your Business profile, or Lost mode if your card is missing.'
      : 'Your Business profile, or an Info page about a thing or a place.';

/**
 * Lost mode's words (the coordinator's checked table, GPT-6, 2026-10-30).
 * DRAFT: the owner approves the exact strings at the frontend gate.
 */
const LOST_COPY = {
  name: 'Lost',
  about: 'Let someone who finds your card message you privately.',
  switchTo: 'Switch to Lost mode',
  banner: 'Lost mode is on. Taps show only the private message page.',
  success: 'Your card is now in Lost mode. Taps show only the private message page.',
  setup: 'To use Lost mode, turn on Return to Owner first.',
  openSetup: 'Open Return to Owner',
  unavailable: 'Lost mode is not available right now. SHYGON has switched it off.',
  inbox: 'Messages from finders arrive on your Return to Owner page.',
  confirm: {
    title: 'Switch this card to Lost mode?',
    body: 'Taps will show only a page where a finder can message you privately. Your profile stays hidden until you switch back.',
    yes: 'Yes, switch to Lost',
  },
  back: {
    title: 'Switch back to Business?',
    body: "Your card's Business profile will show when someone taps it.",
    yes: 'Switch to Business',
  },
} as const;

const FIELD_LABEL: Record<InfoField, string> = {
  title: 'Title',
  shortDescription: 'Short description',
  category: 'Category',
  detailedInformation: 'Detailed information',
};

const STATUS_WORD: Record<PublicationStatus, string> = {
  draft: 'Draft',
  ready: 'Ready',
  live: 'Showing on your Tap',
  unavailable: 'Unavailable',
};

const REASON_TEXT: Record<string, string> = {
  too_long: 'This is too long.',
  markup: 'Plain text only: remove < and > and any code.',
  control_characters: 'Remove the special characters.',
  not_allowed: 'Choose one of the listed categories.',
  unknown: 'This field cannot be saved.',
  not_text: 'This must be text.',
};

/** Only a record written straight to the database can hold this (v0.9.2); the API refuses it. */
const NEEDS_ATTENTION = 'This text cannot be shown. Change it or clear it, then save.';

const SHOWS: Record<TapMode, string> = {
  business: 'Your Tap shows your Business profile.',
  info: 'Your Tap shows your Info page.',
  lost: LOST_COPY.banner,
};

const DONE: Record<TapMode, string> = {
  business: 'Done. Your Tap now shows your Business profile.',
  info: 'Done. Your Tap now shows your Info page.',
  lost: LOST_COPY.success,
};

/** Our own words for each refusal; the server's text is never shown as is. */
function messageOf(error: unknown, action: 'load' | 'switch' | 'save' | 'other' = 'other', mode?: TapMode): string {
  if (!(error instanceof ModesError)) return 'Something went wrong. Please try again.';
  switch (error.code) {
    case 'unauthenticated':
      return 'Your session has expired. Sign in again.';
    case 'no_tap':
      return 'You do not have a Tap yet. Set up your Tap first.';
    case 'tap_suspended':
      return 'Your Tap is suspended, so what it shows cannot change.';
    case 'mode_unavailable':
      return mode === 'lost' ? LOST_COPY.unavailable : 'Info pages are not available yet. SHYGON has not switched them on.';
    case 'needs_setup':
      return mode === 'lost' ? LOST_COPY.setup : 'Add a title and a short description to your Info page first.';
    case 'stale_version':
      return action === 'save'
        ? 'Your Info page changed somewhere else since you opened it, so this was not saved. Saving again replaces that version with what you see here.'
        : 'Your Tap changed somewhere else, so nothing was switched. Check what it shows now and try again.';
    case 'mode_active':
      return 'Your Tap is showing this Info page. Switch it to your Business profile first.';
    case 'invalid_field':
      return 'One of the fields needs a change before it can be saved.';
    default:
      return error.message;
  }
}

type Draft = { title: string; shortDescription: string; category: InfoCategory | ''; detailedInformation: string };
const emptyDraft: Draft = { title: '', shortDescription: '', category: '', detailedInformation: '' };
const draftOf = (state: InfoState): Draft =>
  state.info
    ? {
        title: state.info.title ?? '',
        shortDescription: state.info.shortDescription ?? '',
        category: state.info.category ?? '',
        detailedInformation: state.info.detailedInformation ?? '',
      }
    : emptyDraft;

type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; modes: ModesState; info: InfoState };

export default function TapMode() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ field: InfoField; message: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  /** A switch into or out of Lost mode waits for the owner to confirm it. */
  const [confirmSwitch, setConfirmSwitch] = useState<TapMode | null>(null);
  const [preview, setPreview] = useState<{ view: PublicInfo | null } | null>(null);
  const switchKey = useRef<{ mode: TapMode; key: string } | null>(null);

  const read = useCallback(async (): Promise<Load> => {
    try {
      const [modes, info] = await Promise.all([getModesState(), getInfo()]);
      return { kind: 'ready', modes, info };
    } catch (failure) {
      return { kind: 'error', message: messageOf(failure) };
    }
  }, []);

  useEffect(() => {
    let live = true;
    void read().then((next) => {
      if (!live) return;
      setLoad(next);
      if (next.kind === 'ready') setDraft(draftOf(next.info));
    });
    return () => {
      live = false;
    };
  }, [read, attempt]);

  const reload = async () => {
    const next = await read();
    setLoad(next);
    if (next.kind === 'ready') setDraft(draftOf(next.info));
  };

  if (load.kind !== 'ready') {
    return (
      <AppShell eyebrow="Your Tap" title="What your Tap shows" description={DESCRIPTION}>
        {load.kind === 'loading' ? (
          <div className="panel" style={{ padding: 24 }}>
            <Skeleton height={140} radius={18} />
          </div>
        ) : (
          <div className="panel">
            <ErrorState title="We couldn't load your Tap's mode" message={load.message} onRetry={() => setAttempt((n) => n + 1)} />
          </div>
        )}
      </AppShell>
    );
  }

  const { modes, info } = load;
  const active = modes.activeMode;
  const infoMode = modes.modes.find((m) => m.mode === 'info');
  // Shown only when the server lists it: an older backend has no Lost (§6).
  const lostMode = SHOW_LOST ? modes.modes.find((m) => m.mode === 'lost') : undefined;
  const infoVersion = info.info?.version ?? 0;
  const infoNeeds = (field: InfoField) => infoMode?.reason === 'needs_setup' && Boolean(infoMode.missing?.includes(field));

  const switchMode = async (target: TapMode) => {
    if (busy) return;
    // One key per intent: kept only for a retry after a network failure.
    if (switchKey.current?.mode !== target) switchKey.current = { mode: target, key: crypto.randomUUID() };
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await activateMode(target, modes.version, switchKey.current.key);
      switchKey.current = null;
      await reload();
      setNotice(DONE[result.activeMode] ?? DONE.business);
    } catch (failure) {
      if (!(failure instanceof ModesError && failure.code === 'network')) switchKey.current = null;
      if (failure instanceof ModesError && failure.code === 'stale_version') await reload();
      // Switched off or not set up since this page loaded: show the server's state now, keeping any Info draft.
      if (failure instanceof ModesError && (failure.code === 'mode_unavailable' || failure.code === 'needs_setup')) {
        const fresh = await getModesState().catch(() => null);
        if (fresh) setLoad({ kind: 'ready', modes: fresh, info });
      }
      setError(messageOf(failure, 'switch', target));
    } finally {
      setBusy(false);
      setConfirmSwitch(null);
    }
  };

  /** Into Lost, or from Lost back to Business, the owner confirms first; any other switch is one click. */
  const requestSwitch = (target: TapMode) => {
    if (target === 'lost' || (target === 'business' && active === 'lost')) setConfirmSwitch(target);
    else void switchMode(target);
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setFieldError(null);
    try {
      const saved = await saveInfo(
        {
          title: draft.title.trim() || null,
          shortDescription: draft.shortDescription.trim() || null,
          category: draft.category || null,
          detailedInformation: draft.detailedInformation.trim() || null,
        },
        infoVersion,
      );
      setLoad({ kind: 'ready', modes: await getModesState().catch(() => modes), info: saved });
      setDraft(draftOf(saved));
      setPreview(null);
      setNotice('Saved.');
    } catch (failure) {
      if (failure instanceof ModesError && failure.code === 'invalid_field' && failure.detail.field) {
        const field = failure.detail.field as InfoField;
        setFieldError({ field, message: REASON_TEXT[failure.detail.reason ?? ''] ?? REASON_TEXT.unknown });
      }
      // A stale save keeps what the owner typed and shows the latest version's number.
      if (failure instanceof ModesError && failure.code === 'stale_version') {
        const next = await read();
        if (next.kind === 'ready') setLoad(next);
      }
      setError(messageOf(failure, 'save'));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await clearInfo();
      setConfirmClear(false);
      setPreview(null);
      await reload();
      setNotice('Your Info page was deleted.');
    } catch (failure) {
      setConfirmClear(false);
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  const showPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      setPreview({ view: (await previewInfo()).view });
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  const infoStatus = (): string => {
    if (!infoMode) return 'Unavailable';
    switch (infoMode.reason) {
      case 'active':
        return 'Showing on your Tap';
      case 'ready':
        return 'Ready to show';
      case 'needs_setup': {
        const missing = infoMode.missing ?? ['title', 'shortDescription'];
        const add = missing.filter((f): f is InfoField => f === 'title' || f === 'shortDescription');
        // v0.9.2: detailed information is only ever "missing" when its stored text is invalid.
        const steps = [
          add.length ? `add ${add.map((f) => FIELD_LABEL[f].toLowerCase()).join(' and ')}` : null,
          missing.includes('detailedInformation') ? 'check detailed information' : null,
        ].filter(Boolean);
        return `Setup required: ${steps.join('; ') || 'add title and short description'}`;
      }
      default:
        return 'Unavailable: SHYGON has not switched Info pages on yet';
    }
  };

  /**
   * The preview is null whenever a visitor would get nothing (v0.11.1): Info
   * switched off, the page incomplete, or the Tap paused, unpublished or
   * suspended. Say which, from the owner's state, rather than show an empty page.
   */
  const previewUnavailable = (): string =>
    infoMode?.reason === 'not_available'
      ? 'Until SHYGON switches Info pages on, visitors see "Tap not found" instead.'
      : infoMode?.reason === 'needs_setup'
        ? 'Your page is not complete, so a visitor would see "Tap not found" instead.'
        : 'Visitors cannot see this page right now: your Tap is paused, not published or suspended.';

  const lostStatus = (): string => {
    switch (lostMode?.reason) {
      case 'active':
        return 'Showing on your Tap';
      case 'ready':
        return 'Ready to show';
      case 'needs_setup':
        return LOST_COPY.setup;
      default:
        return LOST_COPY.unavailable;
    }
  };

  const field = (name: 'title' | 'shortDescription' | 'detailedInformation', multiline: boolean, rows = 3) => {
    const limit = INFO_LIMITS[name];
    const value = draft[name];
    const id = `info-${name}`;
    const problem = fieldError?.field === name ? fieldError.message : null;
    const attention = !problem && name === 'detailedInformation' && infoNeeds('detailedInformation') ? NEEDS_ATTENTION : null;
    const common = {
      id,
      className: 'input',
      maxLength: limit,
      value,
      disabled: busy,
      'aria-invalid': problem || attention ? true : undefined,
      'aria-describedby': `${id}-note`,
    };
    const change = (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [name]: e.target.value }));
    return (
      <div className="field" style={{ margin: 0 }}>
        <label htmlFor={id}>
          {FIELD_LABEL[name]}
          {name === 'detailedInformation' ? ' (optional)' : ''}
        </label>
        {multiline ? <textarea {...common} rows={rows} onChange={change} /> : <input {...common} onChange={change} />}
        {problem ? (
          <p id={`${id}-note`} className="field-error" role="alert">
            {problem}
          </p>
        ) : attention ? (
          <p id={`${id}-note`} className="field-error">
            {attention}
          </p>
        ) : (
          <p id={`${id}-note`} className="field-hint">
            {value.length}/{limit}
          </p>
        )}
      </div>
    );
  };

  const confirmCopy = confirmSwitch === 'lost' ? LOST_COPY.confirm : LOST_COPY.back;

  return (
    <AppShell eyebrow="Your Tap" title="What your Tap shows" description={DESCRIPTION}>
      <div style={{ display: 'grid', gap: 18, maxWidth: 760 }}>
        {error && (
          <p className="field-error" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}
        {notice && (
          <p className="field-hint" role="status" style={{ margin: 0 }}>
            {notice}
          </p>
        )}

        <section className="panel" aria-labelledby="tm-mode">
          <div className="panel-head">
            <Layers size={19} aria-hidden="true" />
            <div>
              <h2 id="tm-mode">Showing now</h2>
              <p data-testid="tm-active">{SHOWS[active] ?? SHOWS.business}</p>
            </div>
          </div>
          <div className="panel-body" style={{ display: 'grid', gap: 16 }}>
            {active !== 'business' && (
              <div>
                <button type="button" className="btn btn-blue btn-sm" disabled={busy} onClick={() => requestSwitch('business')}>
                  Show my Business profile instead
                </button>
              </div>
            )}

            {SHOW_INFO && (
              <div style={{ display: 'grid', gap: 8 }}>
                <p style={{ margin: 0, fontSize: 13.5 }}>
                  <strong>Info page:</strong> <span data-testid="tm-info-status">{infoStatus()}</span>
                </p>
                {active !== 'info' && (
                  <div>
                    <button
                      type="button"
                      className="btn btn-blue btn-sm"
                      disabled={busy || !infoMode?.available}
                      onClick={() => requestSwitch('info')}
                    >
                      Show the Info page instead
                    </button>
                  </div>
                )}
                <p className="field-hint" style={{ margin: 0 }}>
                  One at a time: while the Info page shows, visitors do not see your Business profile, contact details or any buttons.
                </p>
              </div>
            )}

            {lostMode && (
              <div style={{ display: 'grid', gap: 8 }} data-testid="tm-lost">
                <p style={{ margin: 0, fontSize: 13.5 }}>
                  <strong>{LOST_COPY.name}:</strong> {LOST_COPY.about}
                </p>
                <p style={{ margin: 0, fontSize: 13.5 }} data-testid="tm-lost-status">
                  {lostStatus()}
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {active !== 'lost' && (
                    <button
                      type="button"
                      className="btn btn-blue btn-sm"
                      disabled={busy || !lostMode.available}
                      onClick={() => requestSwitch('lost')}
                    >
                      {LOST_COPY.switchTo}
                    </button>
                  )}
                  {lostMode.reason === 'needs_setup' && (
                    <Link to="/shygontap/return-to-owner" className="btn btn-ghost btn-sm">
                      {LOST_COPY.openSetup}
                    </Link>
                  )}
                </div>
                {active === 'lost' && (
                  <p className="field-hint" style={{ margin: 0 }}>
                    {LOST_COPY.inbox} <Link to="/shygontap/return-to-owner">{LOST_COPY.openSetup}</Link>
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        {SHOW_INFO && (
          <section className="panel" aria-labelledby="tm-info">
            <div className="panel-head">
              <FileText size={19} aria-hidden="true" />
              <div>
                <h2 id="tm-info">Your Info page</h2>
                <p>
                  <span data-testid="tm-publication">{STATUS_WORD[info.publicationStatus]}</span>. A public page about a thing or a
                  place, such as a product, a room or a piece of equipment. Plain text only; no links or images.
                </p>
              </div>
            </div>
            <form
              className="panel-body"
              style={{ display: 'grid', gap: 14 }}
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              {field('title', false)}
              {field('shortDescription', true, 3)}
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="info-category">Category (optional)</label>
                <select
                  id="info-category"
                  className="input"
                  value={draft.category}
                  disabled={busy}
                  aria-invalid={fieldError?.field === 'category' ? true : undefined}
                  onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value as InfoCategory | '' }))}
                >
                  <option value="">None</option>
                  {(Object.keys(INFO_CATEGORY_LABEL) as InfoCategory[]).map((c) => (
                    <option key={c} value={c}>
                      {INFO_CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </select>
                {fieldError?.field === 'category' && (
                  <p className="field-error" role="alert">
                    {fieldError.message}
                  </p>
                )}
              </div>
              {field('detailedInformation', true, 6)}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="submit" className="btn btn-blue btn-sm" disabled={busy}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
                {info.info && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void showPreview()}>
                    <Eye size={15} aria-hidden="true" /> Preview what visitors see
                  </button>
                )}
                {info.info && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirmClear(true)}>
                    Delete the Info page
                  </button>
                )}
              </div>
            </form>
          </section>
        )}

        {preview && (
          <section className="panel" aria-labelledby="tm-preview">
            <div className="panel-head">
              <Eye size={19} aria-hidden="true" />
              <div>
                <h2 id="tm-preview">What visitors see</h2>
                <p>{preview.view ? 'Exactly what a visitor sees when your Tap shows the Info page.' : previewUnavailable()}</p>
              </div>
            </div>
            {preview.view && (
              <div className="panel-body info-preview" data-testid="tm-preview">
                <InfoView info={preview.view} headingLevel={2} />
              </div>
            )}
          </section>
        )}
      </div>

      <ConfirmDialog
        open={confirmClear}
        tone="danger"
        title="Delete your Info page?"
        description="Its title, description, category and details are deleted. Your Business profile is not affected."
        confirmLabel="Delete"
        busy={busy}
        onConfirm={() => void clear()}
        onCancel={() => setConfirmClear(false)}
      />
      <ConfirmDialog
        open={confirmSwitch !== null}
        title={confirmCopy.title}
        description={confirmCopy.body}
        confirmLabel={confirmCopy.yes}
        busy={busy}
        onConfirm={() => {
          if (confirmSwitch) void switchMode(confirmSwitch);
        }}
        onCancel={() => setConfirmSwitch(null)}
      />
    </AppShell>
  );
}
