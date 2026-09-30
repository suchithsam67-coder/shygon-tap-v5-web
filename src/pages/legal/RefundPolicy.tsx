import { Link } from 'react-router-dom';
import LegalLayout, { ContactBlock, type LegalSection } from './LegalLayout';
import { LEGAL } from '../../data/legal';

const { reportDefectDays, initiateRefundBusinessDays, bankCreditBusinessDays } = LEGAL.refunds;

const sections: LegalSection[] = [
  {
    id: 'cancel',
    title: 'Cancelling an order',
    body: (
      <ul>
        <li>
          <strong>Before dispatch:</strong> you can cancel for a full refund. Contact us with your order number
          (it starts with ST-, and is in your account under Orders) as soon as possible.
        </li>
        <li>
          <strong>After dispatch:</strong> the card has been prepared for you and is on its way, so the order can no
          longer be cancelled. If there is a problem with it when it arrives, see below.
        </li>
      </ul>
    ),
  },
  {
    id: 'returns',
    title: 'Returns',
    body: (
      <p>
        Each card is prepared for your order and linked to your own digital profile, so we cannot take back a card
        that arrives as ordered and working because of a change of mind. This does not affect your rights if a
        card is damaged, faulty or not what you ordered.
      </p>
    ),
  },
  {
    id: 'faulty',
    title: 'Damaged, faulty or wrong cards',
    body: (
      <>
        <p>
          Tell us within {reportDefectDays} days of delivery if your card arrives damaged, does not work when tapped
          on a compatible phone, or is not what you ordered. Send your order number and a photo or short video.
        </p>
        <p>
          Once we confirm the problem, we will replace the card free of charge or, if you prefer, refund what you
          paid for it. You do not pay for return delivery.
        </p>
      </>
    ),
  },
  {
    id: 'digital',
    title: 'Digital upgrades and the Customization Pass',
    body: (
      <>
        <p>
          Upgrades (Business, Premium, GOAT) and the Customization Pass are applied to your account as soon as
          payment is confirmed, so they are not refundable once applied — except:
        </p>
        <ul>
          <li>if you were charged but the upgrade was not applied and we cannot fix it — full refund;</li>
          <li>if you were charged twice for the same thing — the duplicate is refunded;</li>
          <li>if an upgrade does not work as described and we cannot fix it — full refund.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'failed-payments',
    title: 'Failed or duplicate payments',
    body: (
      <p>
        If money left your account but the order did not go through, it is usually returned automatically by
        Razorpay or your bank. If it has not arrived after {bankCreditBusinessDays} business days, contact us with
        the payment reference and we will trace it.
      </p>
    ),
  },
  {
    id: 'how-refunds-work',
    title: 'How refunds are paid',
    body: (
      <ul>
        <li>Refunds go back to the original payment method, through Razorpay. We cannot refund to a different account.</li>
        <li>We start an approved refund within {initiateRefundBusinessDays} business days and email you when we do.</li>
        <li>Your bank or card issuer then usually takes {bankCreditBusinessDays} business days to show it.</li>
        <li>Refunds are for the amount you paid. There are no cancellation fees.</li>
      </ul>
    ),
  },
  {
    id: 'contact',
    title: 'How to ask',
    body: (
      <>
        <p>
          Email or WhatsApp us with your order number. You can also raise a request from{' '}
          <Link to="/shygontap/support">Support</Link> in your account. We acknowledge every request within 48
          hours.
        </p>
        <ContactBlock grievance />
      </>
    ),
  },
];

export default function RefundPolicy() {
  return (
    <LegalLayout
      page="refunds"
      intro={
        <p>
          When you can cancel, what happens if a card arrives damaged, and how refunds are paid. See also our{' '}
          <Link to="/shygontap/shipping-policy">Shipping and Delivery Policy</Link>.
        </p>
      }
      sections={sections}
    />
  );
}
