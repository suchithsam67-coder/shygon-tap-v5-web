import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, FileText, Layers } from 'lucide-react';
import { AppShell } from '../components/app/AppShell';
import { ConfirmDialog } from '../components/app/ConfirmDialog';
import { ErrorState, Skeleton } from '../components/app/States';
import { InfoView } from '../components/info/PublicInfoPage';
import { INFO_CATEGORY_LABEL } from '../components/info/categories';
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
 * What your Tap shows: your Business profile or an Info page (AAROH-API v0.8
 * §6, DEC-2026-041). Every state on this page is the server's: a switch or a
 * save shows as done only after its 200, and the words "Live" are never used
 * (owner, 2026-10-20 §3); "Showing on your Tap" says the same thing plainly.
 * Not linked anywhere until Info is released; a production build redirects
 * this address (Q-C, `OwnerPage`).
 */

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

/** Our own words for each refusal; the server's text is never shown as is. */
function messageOf(error: unknown, action: 'load' | 'switch' | 'save' | 'other' = 'other'): string {
  if (!(error instanceof ModesError)) return 'Something went wrong. Please try again.';
  switch (error.code) {
    case 'unauthenticated':
      return 'Your session has expired. Sign in again.';
    case 'no_tap':
      return 'You do not have a Tap yet. Set up your Tap first.';
    case 'tap_suspended':
      return 'Your Tap is suspended, so what it shows cannot change.';
    case 'mode_unavailable':
      return 'Info pages are not available yet. SHYGON has not switched them on.';
    case 'needs_setup':
      return 'Add a title and a short description to your Info page first.';
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
      <AppShell eyebrow="Your Tap" title="What your Tap shows" description="Your Business profile, or an Info page about a thing or a place.">
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
  const infoMode = modes.modes.find((m) => m.mode === 'info');
  const showingInfo = modes.activeMode === 'info';
  const target: TapMode = showingInfo ? 'business' : 'info';
  const canSwitch = target === 'business' || Boolean(infoMode?.available);
  const infoVersion = info.info?.version ?? 0;

  const switchMode = async () => {
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
      setNotice(result.activeMode === 'info' ? 'Done. Your Tap now shows your Info page.' : 'Done. Your Tap now shows your Business profile.');
    } catch (failure) {
      if (!(failure instanceof ModesError && failure.code === 'network')) switchKey.current = null;
      if (failure instanceof ModesError && failure.code === 'stale_version') await reload();
      setError(messageOf(failure, 'switch'));
    } finally {
      setBusy(false);
    }
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
      case 'needs_setup':
        return `Setup required: add ${(infoMode.missing ?? ['title', 'shortDescription']).map((f) => FIELD_LABEL[f].toLowerCase()).join(' and ')}`;
      default:
        return 'Unavailable: SHYGON has not switched Info pages on yet';
    }
  };

  const field = (name: 'title' | 'shortDescription' | 'detailedInformation', multiline: boolean, rows = 3) => {
    const limit = INFO_LIMITS[name];
    const value = draft[name];
    const id = `info-${name}`;
    const problem = fieldError?.field === name ? fieldError.message : null;
    const common = {
      id,
      className: 'input',
      maxLength: limit,
      value,
      disabled: busy,
      'aria-invalid': problem ? true : undefined,
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
        ) : (
          <p id={`${id}-note`} className="field-hint">
            {value.length}/{limit}
          </p>
        )}
      </div>
    );
  };

  return (
    <AppShell eyebrow="Your Tap" title="What your Tap shows" description="Your Business profile, or an Info page about a thing or a place.">
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
              <p data-testid="tm-active">{showingInfo ? 'Your Tap shows your Info page.' : 'Your Tap shows your Business profile.'}</p>
            </div>
          </div>
          <div className="panel-body" style={{ display: 'grid', gap: 10 }}>
            <p style={{ margin: 0, fontSize: 13.5 }}>
              <strong>Info page:</strong> <span data-testid="tm-info-status">{infoStatus()}</span>
            </p>
            <div>
              <button type="button" className="btn btn-blue btn-sm" disabled={busy || !canSwitch} onClick={() => void switchMode()}>
                {target === 'info' ? 'Show the Info page instead' : 'Show my Business profile instead'}
              </button>
            </div>
            <p className="field-hint" style={{ margin: 0 }}>
              One at a time: while the Info page shows, visitors do not see your Business profile, contact details or any buttons.
            </p>
          </div>
        </section>

        <section className="panel" aria-labelledby="tm-info">
          <div className="panel-head">
            <FileText size={19} aria-hidden="true" />
            <div>
              <h2 id="tm-info">Your Info page</h2>
              <p>
                <span data-testid="tm-publication">{STATUS_WORD[info.publicationStatus]}</span>. A public page about a thing or a place,
                such as a product, a room or a piece of equipment. Plain text only; no links or images.
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

        {preview && (
          <section className="panel" aria-labelledby="tm-preview">
            <div className="panel-head">
              <Eye size={19} aria-hidden="true" />
              <div>
                <h2 id="tm-preview">What visitors see</h2>
                <p>
                  {preview.view
                    ? infoMode?.reason === 'not_available'
                      ? 'This is your page as saved. Until SHYGON switches Info pages on, visitors see "Tap not found" instead.'
                      : 'Exactly what a visitor sees when your Tap shows the Info page.'
                    : 'Your page is not complete, so a visitor would see "Tap not found" instead.'}
                </p>
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
    </AppShell>
  );
}
