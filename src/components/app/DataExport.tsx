import { useState, type ReactNode } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { AccountError, exportMyAccount, type AccountExport } from '../../services/account';
import { downloadFile } from '../../services/privacy';

/**
 * "Download your data" (V6-072), built by the server (AAROH-API v0.12 §4a).
 *
 * The click saves the JSON file at once. The Business profile's vCard gets its
 * own button, because browsers hold back a second download that no click
 * asked for. The page then says, in the server's own plain words, what the
 * file leaves out and why, and which long lists were cut. The limit (five
 * copies a day) is told calmly, with the wait. Customer wording is DRAFT for
 * the owner's gate.
 */

const day = () => new Date().toISOString().slice(0, 10);

/** "about 3 hours" / "about 20 minutes": a calm, rounded wait. */
function waitFor(seconds: number | undefined): string {
  const minutes = Math.max(1, Math.ceil((seconds ?? 3600) / 60));
  if (minutes < 90) return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} hour${hours === 1 ? '' : 's'}`;
}

function messageOf(error: unknown): string {
  if (!(error instanceof AccountError)) return 'Something went wrong. Please try again.';
  switch (error.code) {
    case 'rate_limited':
      return `You have downloaded your data several times today. You can download it again in ${waitFor(error.retryAfter)}.`;
    case 'unauthenticated':
      return 'Your session has expired. Sign in again.';
    case 'network':
      return error.message;
    default:
      return 'We could not prepare your data. Please try again.';
  }
}

type Ready = { data: AccountExport; vcard: string | null };

export function DataExport({ children }: { children?: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<Ready | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setProblem(null);
    try {
      const { export: data, vcard } = await exportMyAccount();
      downloadFile(`shygon-account-${day()}.json`, JSON.stringify(data, null, 2), 'application/json');
      setReady({ data, vcard });
    } catch (failure) {
      setProblem(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }

  const excluded = Array.isArray(ready?.data.excluded) ? ready.data.excluded : [];
  const truncated = Array.isArray(ready?.data.truncated) ? ready.data.truncated : [];

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => void download()} disabled={busy}>
          {busy ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
          Download your data
        </button>
        {children}
      </div>
      {problem && (
        <p className="field-error" role="alert" style={{ margin: 0 }}>
          {problem}
        </p>
      )}
      {ready && (
        <div style={{ display: 'grid', gap: 10 }} data-testid="data-export-ready">
          <p className="field-hint" role="status" style={{ margin: 0 }}>
            Your data is downloading: a JSON file with everything your account holds.
          </p>
          {ready.vcard && (
            <div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => downloadFile(`shygon-tap-${day()}.vcf`, ready.vcard!, 'text/vcard')}
              >
                <Download size={14} /> Save your Business profile as a contact card (.vcf)
              </button>
            </div>
          )}
          {truncated.length > 0 && (
            <p className="field-hint" style={{ margin: 0 }}>
              Some long lists were cut to their newest 2,000 entries: {truncated.join(', ')}.
            </p>
          )}
          {excluded.length > 0 && (
            <div>
              <strong style={{ fontSize: 13 }}>What the file leaves out, and why</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.6 }}>
                {excluded.map((item) => (
                  <li key={item.what}>
                    <strong>{item.what}.</strong> {item.why}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
