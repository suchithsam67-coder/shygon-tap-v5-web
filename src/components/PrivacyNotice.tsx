import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import {
  PRIVACY_NOTICE_REOPEN_EVENT,
  acknowledgePrivacyNotice,
  privacyNoticeAcknowledged,
} from '../lib/privacyNotice';

/**
 * First-visit privacy notice.
 *
 * SHYGON Tap sets no cookies and loads no trackers; the only things it keeps
 * in the browser are essential (sign-in, cart, last configuration). So this
 * is a notice, not an accept/reject wall: there is nothing optional to refuse,
 * and pretending otherwise would be its own kind of dark pattern. If a
 * non-essential tool is ever added, this is where consent for it belongs.
 */
export default function PrivacyNotice() {
  const [open, setOpen] = useState(() => !privacyNoticeAcknowledged());

  useEffect(() => {
    const reopen = () => setOpen(true);
    window.addEventListener(PRIVACY_NOTICE_REOPEN_EVENT, reopen);
    return () => window.removeEventListener(PRIVACY_NOTICE_REOPEN_EVENT, reopen);
  }, []);

  if (!open) return null;

  return (
    <section className="privacy-notice" role="region" aria-label="Privacy notice">
      <ShieldCheck size={20} aria-hidden="true" className="privacy-notice-icon" />
      <p>
        <strong>No cookies, no tracking.</strong> We only keep what the site needs in your browser — your
        sign-in and your cart. Read our <Link to="/shygontap/cookie-policy">Cookie Policy</Link> and{' '}
        <Link to="/shygontap/privacy-policy">Privacy Policy</Link>.
      </p>
      <button
        type="button"
        className="btn btn-blue btn-sm"
        onClick={() => {
          acknowledgePrivacyNotice();
          setOpen(false);
        }}
      >
        Got it
      </button>
    </section>
  );
}
