import { Link } from 'react-router-dom';
import LegalLayout, { ContactBlock, type LegalSection } from './LegalLayout';
import { LEGAL } from '../../data/legal';

const sections: LegalSection[] = [
  {
    id: 'where',
    title: 'Where we deliver',
    body: (
      <p>
        We deliver to addresses in India. Enter your PIN code at checkout to check it before you pay. Delivery
        is included in the price — there is no separate delivery charge.
      </p>
    ),
  },
  {
    id: 'when',
    title: 'When it arrives',
    body: (
      <>
        <p>
          We prepare your card after your payment is confirmed, then hand it to a courier. Checkout shows a delivery
          estimate for your PIN code: a courier’s date where one is available, otherwise our usual range of{' '}
          {LEGAL.shipping.estimateBusinessDays} business days.
        </p>
        <p>
          Estimates are not guarantees. Public holidays, remote areas and courier delays can add time. If your
          order will be late, we will tell you.
        </p>
      </>
    ),
  },
  {
    id: 'tracking',
    title: 'Tracking',
    body: (
      <p>
        When your card ships, the tracking number and courier appear in your account under{' '}
        <Link to="/shygontap/orders">Orders</Link>, and you get a notification. Orders update live as they move.
      </p>
    ),
  },
  {
    id: 'address',
    title: 'Your address',
    body: (
      <p>
        Please check your name, phone number and address before paying. If you need to change them, contact us
        before the order is dispatched. We are not responsible for delays or loss caused by an incorrect address,
        but we will help you recover the parcel where we can.
      </p>
    ),
  },
  {
    id: 'problems',
    title: 'Lost or damaged parcels',
    body: (
      <p>
        If your parcel has not arrived well after the estimate, or arrives damaged, contact us. We will chase the
        courier and, if it is lost or the card is damaged, send a replacement or refund you as described in our{' '}
        <Link to="/shygontap/refund-policy">Cancellation and Refund Policy</Link>.
      </p>
    ),
  },
  {
    id: 'digital',
    title: 'Digital upgrades',
    body: (
      <p>Upgrades and the Customization Pass are not shipped. They apply to your account as soon as payment is confirmed.</p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact',
    body: <ContactBlock />,
  },
];

export default function ShippingPolicy() {
  return (
    <LegalLayout
      page="shipping"
      intro={<p>How and when your {LEGAL.brand} card reaches you.</p>}
      sections={sections}
    />
  );
}
