import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { AppShell } from '../components/app/AppShell';
import { PhoneVerification } from '../components/app/PhoneVerification';

/**
 * "Verify your phone" (AAROH-API v0.13 §4b), reached from Settings and from the
 * card page. The work is in PhoneVerification; this page gives it a frame and a
 * way back to the cards.
 */
export default function VerifyPhone() {
  return (
    <AppShell
      eyebrow="Your SHYGON account"
      title="Verify your phone"
      description="Codes for activating or deactivating your card are sent only to a verified mobile number."
    >
      <section className="panel">
        <div className="panel-head">
          <ShieldCheck size={19} aria-hidden="true" />
          <div>
            <h2>Your mobile number</h2>
            <p>We text a one-time code to the number in your account details.</p>
          </div>
        </div>
        <div className="panel-body">
          <PhoneVerification />
        </div>
      </section>
      <p className="card-otp-footnote phone-verify-back">
        <Link to="/shygontap/cards">Back to your cards</Link>
      </p>
    </AppShell>
  );
}
