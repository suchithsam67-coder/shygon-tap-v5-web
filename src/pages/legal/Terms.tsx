import { Link } from 'react-router-dom';
import LegalLayout, { ContactBlock, type LegalSection } from './LegalLayout';
import { LEGAL } from '../../data/legal';

const sections: LegalSection[] = [
  {
    id: 'agreement',
    title: 'About these terms',
    body: (
      <>
        <p>
          These terms are an agreement between you and {LEGAL.legalName} (“we”, “us”), which runs{' '}
          {LEGAL.brand} at {LEGAL.website}. By creating an account or placing an order you accept them, together
          with our <Link to="/shygontap/privacy-policy">Privacy Policy</Link>,{' '}
          <Link to="/shygontap/refund-policy">Cancellation and Refund Policy</Link> and{' '}
          <Link to="/shygontap/shipping-policy">Shipping and Delivery Policy</Link>.
        </p>
        <p>Nothing in these terms takes away rights you have as a consumer under Indian law.</p>
      </>
    ),
  },
  {
    id: 'eligibility',
    title: 'Who can use SHYGON Tap',
    body: (
      <p>
        You must be 18 or older and able to enter a binding contract under Indian law. We sell and deliver in
        India only.
      </p>
    ),
  },
  {
    id: 'account',
    title: 'Your account',
    body: (
      <ul>
        <li>Give accurate details and keep them up to date.</li>
        <li>Keep your password private. You are responsible for activity on your account.</li>
        <li>Tell us straight away at <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a> if you think someone else has used it.</li>
      </ul>
    ),
  },
  {
    id: 'products',
    title: 'What we sell',
    body: (
      <>
        <p>{LEGAL.brand} has two parts:</p>
        <ul>
          <li>
            <strong>A physical NFC card</strong> in the design, material and finish you choose, prepared for your order.
          </li>
          <li>
            <strong>A digital profile (“Tap”)</strong> that opens when the card is tapped or its QR code is
            scanned. Essential is included with every card; Business, Premium and GOAT are optional one-time
            upgrades.
          </li>
        </ul>
        <p>
          Product photos are illustrations of the design. Colours can look slightly different on the physical
          card because of screens and materials.
        </p>
      </>
    ),
  },
  {
    id: 'prices',
    title: 'Prices and payment',
    body: (
      <ul>
        <li>
          Prices are in Indian rupees. The total shown at checkout is the full amount you pay: delivery within
          India is included and nothing is added at payment.
        </li>
        <li>
          Payments are processed by Razorpay. Your order is confirmed only after our server has verified the
          payment with Razorpay.
        </li>
        <li>
          If a price is clearly wrong because of an error, or we cannot fulfil an order, we will tell you and
          refund you in full. We will not charge you more than the price you accepted.
        </li>
        <li>Upgrades and the Customization Pass are one-time payments, not subscriptions.</li>
      </ul>
    ),
  },
  {
    id: 'digital',
    title: 'Digital experiences and the Customization Pass',
    body: (
      <ul>
        <li>An upgrade is linked to your account and applies to your Tap as soon as payment is confirmed.</li>
        <li>
          You can change your Tap’s content once every 14 days. The Customization Pass removes that limit and
          unlocks every colour palette.
        </li>
        <li>
          Your Tap stays online while your account is open and your card is active. If a card is deactivated, the
          Tap linked to it stops opening until it is reactivated or replaced.
        </li>
      </ul>
    ),
  },
  {
    id: 'compatibility',
    title: 'Phone compatibility',
    body: (
      <p>
        Most modern Android phones and iPhone XS or newer read an NFC card without an app, while unlocked and
        held close to the card. Some phones need NFC switched on, and some older phones cannot read NFC at all.
        Your Tap also has a QR code (download it from your account) that any phone camera can scan.
      </p>
    ),
  },
  {
    id: 'content',
    title: 'Your Tap content',
    body: (
      <>
        <p>
          You own what you publish on your Tap. You allow us to store, display and deliver it to people who open
          your Tap, only to provide the service.
        </p>
        <p>You must not publish anything that:</p>
        <ul>
          <li>is unlawful, misleading, defamatory, obscene, hateful or harassing;</li>
          <li>infringes someone else’s copyright, trademark or privacy (including their photo or contact details without permission);</li>
          <li>impersonates another person or business;</li>
          <li>contains malware or links to scams or phishing.</li>
        </ul>
        <p>
          We may suspend a Tap that breaks these rules or that we are lawfully asked to remove, and we will tell
          you why unless the law prevents it.
        </p>
      </>
    ),
  },
  {
    id: 'ip',
    title: 'Our intellectual property',
    body: (
      <p>
        The {LEGAL.brand} name, logo, card designs, website and software belong to {LEGAL.legalName}. You may not
        copy or reuse them except to use the service as intended. Other names that appear on the site (for
        example Google, WhatsApp or Razorpay) belong to their owners and are used only to describe compatibility
        or services.
      </p>
    ),
  },
  {
    id: 'liability',
    title: 'Our responsibility to you',
    body: (
      <>
        <p>
          We make the cards and run the service with reasonable care and skill. If a card is faulty, the{' '}
          <Link to="/shygontap/refund-policy">Cancellation and Refund Policy</Link> explains how we put it right.
        </p>
        <p>
          We are not responsible for losses that were not reasonably foreseeable, for problems caused by your
          phone, network or third-party services, or for how other people use information you publish on your Tap.
          As far as the law allows, our total liability for an order is limited to the amount you paid for it.
          None of this limits liability that cannot be limited by law.
        </p>
      </>
    ),
  },
  {
    id: 'ending',
    title: 'Ending your account',
    body: (
      <p>
        You can ask us to close your account at any time. We may suspend or close an account that breaks these
        terms. Paid upgrades are tied to the account and end when it is closed.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    body: (
      <p>
        We may update these terms and will change the date at the top when we do. The terms that applied when you
        placed an order apply to that order.
      </p>
    ),
  },
  {
    id: 'law',
    title: 'Governing law and disputes',
    body: (
      <p>
        These terms are governed by the laws of India. Please contact us first — most problems are quickest to
        solve directly. Subject to your right to approach a Consumer Disputes Redressal Commission, the courts at{' '}
        {LEGAL.jurisdiction} have jurisdiction.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact and grievances',
    body: (
      <>
        <p>
          We acknowledge every complaint within 48 hours and resolve it within one month.
        </p>
        <ContactBlock grievance />
      </>
    ),
  },
];

export default function Terms() {
  return (
    <LegalLayout
      page="terms"
      intro={
        <p>
          The rules for buying and using {LEGAL.brand}, written to be read. If anything is unclear, ask us before
          you order.
        </p>
      }
      sections={sections}
    />
  );
}
