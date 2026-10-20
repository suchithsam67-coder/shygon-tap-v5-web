import { useMemo } from 'react';
import PublicExperience from '../components/showroom/PublicExperience';
import BrandMark from '../components/brand/BrandMark';
import { DEFAULT_THEME, type PublicProfile } from '../lib/database.types';
// Type-only: the meta builders carry the catalogue, which this page must not load.
import type { PageMeta } from '../seo/meta';
import { usePageMeta } from '../seo/usePageMeta';

/**
 * The AAROH demo showroom (FE-D7): `/aaroh/experience`.
 *
 * The same opening, showroom and modes a real Tap uses, with sample data,
 * plus every planned mode under its real status, so anyone can see what an
 * AAROH card opens and what is still to come. It belongs to nobody: it is
 * labelled as a demo throughout, it is kept out of search results, it calls
 * no backend, and its sample contact details use reserved example domains.
 */

const SAMPLE: PublicProfile = {
  slug: 'demo',
  experience: 'premium',
  displayName: 'Sample Profile',
  headline: 'This is what a visitor sees',
  designation: 'Product designer',
  company: 'Sample Studio',
  bio: 'Sample text. On a real card, this is the owner’s own bio, written and published from their SHYGON account.',
  avatarUrl: null,
  location: 'Bengaluru',
  // No phone number: a sample number could ring a real person.
  phone: null,
  whatsapp: null,
  email: 'hello@example.com',
  website: 'example.com',
  instagram: null,
  linkedin: 'example.com/sample',
  youtube: null,
  customLinks: [{ label: 'Portfolio', url: 'example.com/portfolio' }],
  theme: { ...DEFAULT_THEME },
  activeEvent: null,
};

export default function AarohExperienceDemo() {
  usePageMeta(
    useMemo<PageMeta>(
      () => ({
        title: 'SHYGON AAROH experience (demo) | SHYGON Tap',
        description: 'A demo of what an AAROH card opens, with sample data: the opening, the showroom and each mode, with what works today and what is still to come.',
        path: '/aaroh/experience',
        noindex: true,
      }),
      [],
    ),
  );

  return (
    <div className="sr-demo">
      <p className="sr-demo-banner" role="note">
        <strong>Demo</strong> · Sample data. This is not a real person’s card, and nothing here is sent anywhere.
      </p>
      <PublicExperience
        data={SAMPLE}
        demo
        footer={
          <p className="sr-footnote">
            <BrandMark className="sr-footnote-mark" /> SHYGON AAROH · <a href="/shygontap/store/aaroh">See the collection</a> ·{' '}
            <a href="/shygontap/privacy-policy">Privacy</a>
          </p>
        }
      />
    </div>
  );
}
