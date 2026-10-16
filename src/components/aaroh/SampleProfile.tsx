import { TapExperience } from '../tap/TapExperience';
import { DEFAULT_THEME, type PublicProfile } from '../../lib/database.types';

/**
 * What someone sees when they tap an AAROH card: a sample profile drawn by the
 * same `<TapExperience>` every published profile uses, with the Essential
 * experience and the default look, and only the buttons Essential includes
 * (call and email).
 *
 * The person is a labelled sample (the name the concept card art carries), the
 * contact details are reserved example values, and nothing is stored. The
 * frame is inert and hidden from assistive technology: it is a picture of a
 * page, and the caption says in words what it shows.
 */
const SAMPLE: PublicProfile = {
  slug: 'aaroh-sample',
  experience: 'essential',
  displayName: 'Arjun Mehta',
  headline: 'Founder · Mehta Studio',
  designation: null,
  company: null,
  bio: 'A small studio for considered brands.',
  avatarUrl: null,
  location: null,
  phone: '+91 98765 43210',
  whatsapp: null,
  email: 'hello@example.com',
  website: null,
  instagram: null,
  linkedin: null,
  youtube: null,
  customLinks: [],
  theme: DEFAULT_THEME,
  activeEvent: null,
};

export default function SampleProfile({ className = '' }: { className?: string }) {
  return (
    <figure className={`aaroh-preview ${className}`.trim()}>
      <div className="aaroh-preview-phone" aria-hidden="true" inert>
        <span className="aaroh-preview-notch" />
        <div className="tap-preview-frame">
          <TapExperience data={SAMPLE} preview introKey="aaroh-sample" />
        </div>
      </div>
      <figcaption>
        <span>Sample profile</span>
        Essential experience, default look
      </figcaption>
    </figure>
  );
}
