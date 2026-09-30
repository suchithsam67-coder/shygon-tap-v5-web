import { Link } from 'react-router-dom';
import LegalLayout, { type LegalSection } from './LegalLayout';
import { LEGAL } from '../../data/legal';
import { reopenPrivacyNotice } from '../../lib/privacyNotice';

/** Everything the site keeps in the browser. Keep in step with the code. */
const STORAGE = [
  {
    key: 'shygon-tap-auth',
    purpose: 'Keeps you signed in. Created when you sign in and removed when you sign out.',
    kind: 'Essential',
  },
  {
    key: 'shygon_pending_order',
    purpose: 'Remembers the card in your cart while you sign in and check out.',
    kind: 'Essential',
  },
  {
    key: 'shygon_builder_selection',
    purpose: 'Remembers the card, material and experience you last configured.',
    kind: 'Essential',
  },
  {
    key: 'shygon_theme',
    purpose: 'Remembers whether you chose the light or dark theme. Only set if you use the theme switch.',
    kind: 'Preference',
  },
  {
    key: 'shygon_privacy_notice',
    purpose: 'Remembers that you have seen our privacy notice, so it is not shown on every page.',
    kind: 'Essential',
  },
];

const sections: LegalSection[] = [
  {
    id: 'summary',
    title: 'The short version',
    body: (
      <ul>
        <li>
          {LEGAL.brand} sets <strong>no cookies</strong>.
        </li>
        <li>We use no analytics, advertising, tracking pixels or social media plugins.</li>
        <li>
          Our fonts and images are served from our own site, so opening a page does not send your data to
          anyone else.
        </li>
        <li>
          We keep a few small items in your browser’s local storage: four the site needs to work, and your
          light/dark theme choice if you use the switch. None of them track you.
        </li>
      </ul>
    ),
  },
  {
    id: 'storage',
    title: 'What we keep in your browser',
    body: (
      <div className="legal-table-wrap">
        <table className="legal-table">
          <caption className="sr-only">Items SHYGON Tap stores in your browser</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Purpose</th>
              <th scope="col">Type</th>
            </tr>
          </thead>
          <tbody>
            {STORAGE.map((row) => (
              <tr key={row.key}>
                <th scope="row">
                  <code>{row.key}</code>
                </th>
                <td data-label="Purpose">{row.purpose}</td>
                <td data-label="Type">{row.kind}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  },
  {
    id: 'third-parties',
    title: 'Third-party services and embeds',
    body: (
      <>
        <p>
          We do not embed third-party content (videos, maps or social feeds) in our pages. These services are
          involved only when you choose to use them:
        </p>
        <ul>
          <li>
            <strong>Razorpay</strong> — its secure checkout window opens only when you pay. Razorpay may use its
            own cookies there for fraud prevention, under its own privacy policy.
          </li>
          <li>
            <strong>WhatsApp, Google Maps and links on a Tap</strong> — these are ordinary links. Following one
            takes you to that service, whose own policy then applies.
          </li>
          <li>
            <strong>Desktop notifications</strong> — only if you turn them on in your account. Your browser, not
            us, stores that permission.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'control',
    title: 'Your choices',
    body: (
      <>
        <p>
          You can clear this data at any time in your browser settings, or by signing out. The site will still
          work, but you will need to sign in again and your cart will be emptied.
        </p>
        <p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={reopenPrivacyNotice}>
            Show the privacy notice again
          </button>
        </p>
      </>
    ),
  },
  {
    id: 'changes',
    title: 'If this changes',
    body: (
      <p>
        If we ever add a cookie or tool that is not essential, we will ask for your consent first and update
        this page. See our <Link to="/shygontap/privacy-policy">Privacy Policy</Link> for everything else.
      </p>
    ),
  },
];

export default function CookiePolicy() {
  return (
    <LegalLayout
      page="cookies"
      intro={<p>What {LEGAL.brand} stores on your device, and why. It is a short list.</p>}
      sections={sections}
    />
  );
}
