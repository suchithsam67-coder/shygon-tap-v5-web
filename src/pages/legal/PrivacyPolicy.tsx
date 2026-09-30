import { Link } from 'react-router-dom';
import LegalLayout, { ContactBlock, type LegalSection } from './LegalLayout';
import { DATA_WE_COLLECT, LEGAL, PROCESSORS } from '../../data/legal';

const sections: LegalSection[] = [
  {
    id: 'who-we-are',
    title: 'Who we are',
    body: (
      <>
        <p>
          {LEGAL.brand} is run by {LEGAL.legalName} (“we”, “us”). We decide how and why your personal data is
          used, so under the Digital Personal Data Protection Act, 2023 we are the <em>Data Fiduciary</em> for it.
        </p>
        <ContactBlock grievance />
      </>
    ),
  },
  {
    id: 'data-we-collect',
    title: 'What data we collect',
    body: (
      <>
        <p>
          We collect only what we need to sell you a card, run your digital profile and support you. This is
          the complete list.
        </p>
        <div className="legal-table-wrap">
          <table className="legal-table">
            <caption className="sr-only">Personal data SHYGON Tap collects</caption>
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Examples</th>
                <th scope="col">Why we need it</th>
                <th scope="col">Who else processes it</th>
              </tr>
            </thead>
            <tbody>
              {DATA_WE_COLLECT.map((row) => (
                <tr key={row.what}>
                  <th scope="row">{row.what}</th>
                  <td data-label="Examples">{row.examples}</td>
                  <td data-label="Why">{row.why}</td>
                  <td data-label="Shared with">{row.sharedWith}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          We do <strong>not</strong> use advertising or analytics trackers, we do not set cookies, and we do not
          sell or rent your data to anyone.
        </p>
      </>
    ),
  },
  {
    id: 'lawful-basis',
    title: 'Why we are allowed to use it',
    body: (
      <ul>
        <li>
          <strong>Your consent</strong> — when you create an account, you agree to this policy. You can withdraw
          consent at any time (see “Your rights”); withdrawing does not undo anything done before.
        </li>
        <li>
          <strong>Things you ask us to do</strong> — when you place an order or publish a Tap, we use the data
          you give us to do exactly that (DPDP Act, section 7(a)).
        </li>
        <li>
          <strong>The law</strong> — we keep invoices and payment records because tax and company law require
          it, and we may share data when a court or government authority lawfully requires us to.
        </li>
      </ul>
    ),
  },
  {
    id: 'service-providers',
    title: 'Service providers',
    body: (
      <>
        <p>
          These companies process data for us, only to provide their service, under contract. Some may process
          data outside India, which the DPDP Act allows except to countries the Government restricts.
        </p>
        <div className="legal-table-wrap">
          <table className="legal-table">
            <caption className="sr-only">Service providers that process personal data</caption>
            <thead>
              <tr>
                <th scope="col">Provider</th>
                <th scope="col">What they do</th>
                <th scope="col">Where</th>
              </tr>
            </thead>
            <tbody>
              {PROCESSORS.map((p) => (
                <tr key={p.name}>
                  <th scope="row">{p.name}</th>
                  <td data-label="What they do">{p.role}</td>
                  <td data-label="Where">{p.where}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          When you choose to contact us on WhatsApp, open a location on Google Maps, or follow a link on
          someone’s Tap, you leave our site and that service’s own privacy policy applies.
        </p>
      </>
    ),
  },
  {
    id: 'public-tap',
    title: 'Your public Tap',
    body: (
      <p>
        Your Tap is a public web page. Anyone who taps your card, scans your QR code or has the link can see what
        you publish, and can save or share it. Publish only what you are comfortable making public. You can edit
        any field, hide contact details, or unpublish your Tap from your account at any time.
      </p>
    ),
  },
  {
    id: 'retention',
    title: 'How long we keep it',
    body: (
      <ul>
        <li>Account, profile and Tap data: while your account is open. We delete it within 30 days of your request to delete your account.</li>
        <li>Tap visit statistics: while your Tap exists; deleted with your account.</li>
        <li>Orders, invoices and payment records: for as long as Indian tax and company law requires (up to 8 years), then deleted.</li>
        <li>Support conversations: while your account is open, unless we need them for an open dispute.</li>
        <li>Server logs: for a short period by our hosting providers, for security.</li>
      </ul>
    ),
  },
  {
    id: 'your-rights',
    title: 'Your rights',
    body: (
      <>
        <p>Under the DPDP Act, 2023 you can ask us to:</p>
        <ul>
          <li>tell you what personal data we hold about you and how we use it, and who we have shared it with;</li>
          <li>correct, complete or update it (most of it you can edit yourself in your account);</li>
          <li>delete it, including closing your account — except records the law requires us to keep;</li>
          <li>withdraw your consent;</li>
          <li>nominate someone to exercise these rights if you die or become unable to;</li>
          <li>resolve a complaint (see “Grievances”).</li>
        </ul>
        <p>
          Email <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a> from the address on your account. We may ask
          you to confirm it is you. There is no charge.
        </p>
      </>
    ),
  },
  {
    id: 'security',
    title: 'How we protect it',
    body: (
      <ul>
        <li>Every connection to our site and database is encrypted (HTTPS).</li>
        <li>Passwords are stored only as one-way hashes; nobody at SHYGON can read them.</li>
        <li>Database rules let each customer read only their own records. Staff access is limited by role and logged.</li>
        <li>Card and bank details go straight to Razorpay and never reach our servers.</li>
      </ul>
    ),
  },
  {
    id: 'breach',
    title: 'If something goes wrong',
    body: (
      <p>
        If a personal data breach affects you, we will tell you and the Data Protection Board of India as the law
        requires, with what happened, what it means for you and what we are doing about it.
      </p>
    ),
  },
  {
    id: 'children',
    title: 'Children',
    body: (
      <p>
        SHYGON Tap is for adults. You must be 18 or older to create an account or buy. We do not knowingly
        collect data from anyone under 18; if you believe we have, contact us and we will delete it.
      </p>
    ),
  },
  {
    id: 'grievances',
    title: 'Grievances',
    body: (
      <>
        <p>
          Contact our Grievance Officer with any complaint about your data or our service. We acknowledge every
          complaint within 48 hours and resolve it within one month.
        </p>
        <ContactBlock grievance />
        <p>
          If you are not satisfied with our response, you can complain to the Data Protection Board of India.
        </p>
      </>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    body: (
      <p>
        We will update the date at the top when this policy changes, and tell you by email or in your account
        before a change that affects how we use your existing data. See also our{' '}
        <Link to="/shygontap/cookie-policy">Cookie Policy</Link> and{' '}
        <Link to="/shygontap/terms">Terms and Conditions</Link>.
      </p>
    ),
  },
];

export default function PrivacyPolicy() {
  return (
    <LegalLayout
      page="privacy"
      intro={
        <p>
          This policy explains, in plain language, what personal data {LEGAL.brand} collects, why, who processes
          it, how long we keep it and how you control it. It follows India’s Digital Personal Data Protection Act,
          2023 and the Information Technology Act, 2000.
        </p>
      }
      sections={sections}
    />
  );
}
