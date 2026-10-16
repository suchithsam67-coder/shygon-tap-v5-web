import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, Download, ExternalLink, QrCode, Share2 } from 'lucide-react';
import { AppShell } from '../components/app/AppShell';
import { useAccount } from '../lib/account-context';
import { useToast } from '../components/app/toast-context';
import { ErrorState, Skeleton } from '../components/app/States';
import { QrCodeCanvas } from '../components/app/QrCode';
import { TAP_STATUS_HINTS, TAP_STATUS_LABELS, tapUrl } from '../services/tap';

/**
 * Rasterises the on-screen QR (an SVG) to a `size`×`size` PNG: the SVG is
 * serialised, loaded as an image and drawn onto an offscreen canvas. The copy
 * drops the on-screen rounded corners and draws with crisp edges, so the file
 * is a square with no anti-aliased seams between neighbouring modules.
 */
function svgToPng(svg: SVGSVGElement, size: number): Promise<Blob> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', String(size));
  copy.setAttribute('height', String(size));
  copy.setAttribute('shape-rendering', 'crispEdges');
  copy.removeAttribute('style');
  const source = new XMLSerializer().serializeToString(copy);

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error('The QR image could not be loaded.'));
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('No 2D canvas.'));
        return;
      }
      context.drawImage(image, 0, 0, size, size);
      canvas.toBlob((png) => (png ? resolve(png) : reject(new Error('No PNG.'))), 'image/png');
    };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
  });
}

/**
 * The customer's QR code.
 *
 * The code encodes the Tap's public address and nothing else, which is what
 * makes it survive every change the customer makes: switching experience,
 * repainting the theme or editing the profile all leave the address alone, so a
 * printed or engraved QR never goes stale. The only thing that would change it
 * is claiming a different Tap address.
 */
export default function TapQr() {
  const navigate = useNavigate();
  const { tap, loading, setupRequired } = useAccount();
  const toast = useToast();
  const holder = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(280);

  const canonicalUrl = tap?.slug ? tapUrl(tap.slug) : null;
  const url = canonicalUrl ? `${canonicalUrl}?src=qr` : null;

  function copyLink() {
    if (!canonicalUrl) return;
    void navigator.clipboard.writeText(canonicalUrl);
    toast.success('Link copied');
  }

  async function share() {
    if (!canonicalUrl) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: tap?.display_name || 'My SHYGON Tap', url: canonicalUrl });
        return;
      } catch {
        /* share sheet dismissed */
      }
    }
    copyLink();
  }

  /**
   * Downloads the code the page already drew, so the file is exactly the code
   * on screen, rasterised to a PNG at the size picked on the slider.
   */
  async function download() {
    const svg = holder.current?.querySelector('svg');
    if (!svg || !tap?.slug) {
      toast.error('Nothing to download', 'Claim your Tap address first.');
      return;
    }
    const filename = `shygon-tap-${tap.slug}.png`;
    try {
      const href = URL.createObjectURL(await svgToPng(svg, size));
      const link = document.createElement('a');
      link.download = filename;
      link.href = href;
      link.click();
      // Revoked later, not at once: some browsers read the URL after click() returns.
      window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
      toast.success('QR downloaded', `Saved as ${filename}`);
    } catch {
      toast.error('Could not download', 'Your browser blocked the download. Try a screenshot.');
    }
  }

  return (
    <AppShell
      eyebrow="Share"
      title="Your QR code"
      description="Print it, stick it on a table tent, or show it on your phone. It opens the same profile your card does."
    >
      {loading ? (
        <div className="panel" style={{ padding: 24 }}>
          <Skeleton height={200} radius={18} />
        </div>
      ) : setupRequired ? (
        <div className="panel">
          <ErrorState
            title="Almost ready"
            message="We're finishing your SHYGON Tap setup. Please try again shortly."
          />
        </div>
      ) : !tap?.slug ? (
        <div className="panel">
          <ErrorState
            title="Claim your Tap address first"
            message="Your QR code points at your public Tap address, so you need one before we can generate it."
            onRetry={() => navigate('/shygontap/tap')}
          />
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 18, maxWidth: 640 }}>
          <section className="panel">
            <div className="panel-body" style={{ textAlign: 'center' }}>
              <div
                ref={holder}
                style={{
                  display: 'inline-grid',
                  placeItems: 'center',
                  padding: 22,
                  borderRadius: 22,
                  background: '#fff',
                  border: '1px solid var(--line)',
                }}
              >
                <QrCodeCanvas value={url!} size={size} />
              </div>

              <p
                style={{
                  margin: '18px 0 0',
                  fontSize: 13,
                  fontWeight: 650,
                  overflowWrap: 'anywhere',
                }}
              >
                {url!.replace(/^https?:\/\//, '')}
              </p>

              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                  marginTop: 18,
                }}
              >
                <button className="btn btn-blue btn-sm" onClick={() => void download()}>
                  <Download size={14} /> Download PNG
                </button>
                <button className="btn btn-ghost btn-sm" onClick={copyLink}>
                  <Copy size={14} /> Copy link
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => void share()}>
                  <Share2 size={14} /> Share
                </button>
                <a
                  className="btn btn-ghost btn-sm"
                  href={url!}
                  target="_blank"
                  rel="noreferrer"
                  style={{ textDecoration: 'none' }}
                >
                  <ExternalLink size={14} /> Open
                </a>
              </div>

              <label className="field" style={{ maxWidth: 320, margin: '20px auto 0' }}>
                <span>Size · {size}px</span>
                <input
                  type="range"
                  min={180}
                  max={1024}
                  // 1024 − 180 is a multiple of 4, so the slider can reach 1024 (with 20 it stops at 1020).
                  step={4}
                  value={size}
                  onChange={(e) => setSize(Number(e.target.value))}
                />
                <p className="field-hint">Larger sizes print more reliably.</p>
              </label>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <QrCode size={19} />
              <div>
                <h2>Where this points</h2>
              </div>
            </div>
            <div className="panel-body">
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13, lineHeight: 1.65 }}>
                This code always opens your Tap address. Changing your experience, colours or
                profile does not change it, so a printed code never stops working. Your card's NFC
                chip opens the same address.
              </p>
              <div
                style={{
                  marginTop: 14,
                  padding: '12px 14px',
                  borderRadius: 13,
                  background: 'var(--ds-surface-raised)',
                  border: '1px solid var(--line)',
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <span className={tap.status === 'active' ? 'pill pill-green' : 'pill pill-amber'}>
                  <span className="pill-dot" />
                  {TAP_STATUS_LABELS[tap.status]}
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--muted)', flex: 1, minWidth: 200 }}>
                  {TAP_STATUS_HINTS[tap.status]}
                </span>
                {tap.status !== 'active' && (
                  <button className="btn btn-ghost btn-sm" onClick={() => navigate('/shygontap/tap')}>
                    Publish
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}
