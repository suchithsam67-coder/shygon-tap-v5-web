import type { PublicInfo } from '../../lib/database.types';
import { INFO_CATEGORY_LABEL } from './categories';
import './info.css';

/**
 * A Tap in Info mode (AAROH-API v0.8 §6, DEC-2026-041): a public page about a
 * thing or a place, not about a person.
 *
 * Plain text only. React escapes every value, nothing is turned into a link,
 * and line breaks in the details are kept by CSS. It shows the five published
 * fields and nothing else: no Business data, no image, and no capability
 * buttons (no Return to Owner, emergency or Connect, PQ-3). It records no
 * visitor event (PQ-2); that is the caller's rule too.
 *
 * The owner's preview renders the same component, so what they check is what
 * a visitor gets.
 */

function updatedOn(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function InfoView({ info, headingLevel = 1 }: { info: PublicInfo; headingLevel?: 1 | 2 }) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  const updated = updatedOn(info.updatedAt);
  return (
    <article className="info-card">
      {info.category && <p className="info-category">{INFO_CATEGORY_LABEL[info.category]}</p>}
      <Heading className="info-title">{info.title}</Heading>
      <p className="info-lead">{info.shortDescription}</p>
      {info.detailedInformation && <div className="info-details">{info.detailedInformation}</div>}
      {updated && <p className="info-updated">Updated {updated}</p>}
    </article>
  );
}

export default function PublicInfoPage({ info }: { info: PublicInfo }) {
  return (
    <main className="info-page">
      <InfoView info={info} />
      <p className="info-footnote">
        Powered by SHYGON · <a href="/shygontap">What is SHYGON Tap?</a> · <a href="/shygontap/privacy-policy">Privacy</a>
      </p>
    </main>
  );
}
