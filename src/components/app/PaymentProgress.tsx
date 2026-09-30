import { Check, Loader2 } from 'lucide-react';
import BrandMark from '../brand/BrandMark';
import type { CheckoutStage } from '../../services/payments';

export type PaymentStage = CheckoutStage | 'confirmed';

const STEPS: Array<{ stage: PaymentStage; label: string }> = [
  { stage: 'creating', label: 'Securing your order' },
  { stage: 'awaiting-payment', label: 'Complete payment in the Razorpay window' },
  { stage: 'verifying', label: 'Verifying your payment' },
  { stage: 'confirmed', label: 'Payment confirmed' },
];

/**
 * Card transaction animation shown during checkout.
 *
 * Every step is driven by a real event from startCheckout (order created,
 * Razorpay opened, payment returned for verification, server confirmed), so
 * the animation can never run ahead of what has actually happened.
 */
export default function PaymentProgress({ stage }: { stage: PaymentStage }) {
  const current = STEPS.findIndex((s) => s.stage === stage);
  const confirmed = stage === 'confirmed';

  return (
    <div className="pay-overlay" role="status" aria-live="polite">
      <div className={`pay-panel${confirmed ? ' is-confirmed' : ''}`}>
        <div className="pay-stage" aria-hidden="true">
          <div className="pay-terminal">
            <span className="pay-wave" />
            <span className="pay-wave" />
            <span className="pay-wave" />
            <span className="pay-terminal-check">
              <Check size={26} strokeWidth={3} />
            </span>
          </div>
          <div className="pay-card">
            <span className="pay-card-chip" />
            <span className="pay-card-brand">
              <BrandMark className="pay-card-mark" />
              SHYGON <b>TAP</b>
            </span>
            <span className="pay-card-lines" />
          </div>
        </div>

        <ol className="pay-steps">
          {STEPS.map((step, index) => {
            const state = index < current || confirmed ? 'done' : index === current ? 'now' : 'next';
            return (
              <li key={step.stage} className={`pay-step pay-step-${state}`} aria-current={state === 'now' ? 'step' : undefined}>
                <span className="pay-step-icon" aria-hidden="true">
                  {state === 'done' ? <Check size={14} strokeWidth={3} /> : state === 'now' ? <Loader2 size={14} className="spin" /> : null}
                </span>
                {step.label}
              </li>
            );
          })}
        </ol>
        <p className="pay-note">Please keep this page open.</p>
      </div>
    </div>
  );
}
