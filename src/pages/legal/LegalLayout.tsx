import { useEffect, useMemo, type ReactNode } from 'react';
import BrandMark from '../../components/brand/BrandMark';
import ThemeToggle from '../../components/ThemeToggle';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import StoreFooter from '../../components/StoreFooter';
import { LEGAL } from '../../data/legal';
import { SITE_URL } from '../../lib/site';
import { legalMeta, LEGAL_PAGES, type LegalPageId } from '../../seo/meta';
import { usePageMeta } from '../../seo/usePageMeta';

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

/**
 * Shared frame for the policy pages: storefront header, breadcrumb, one h1,
 * the effective date, a table of contents, the sections, and links to the
 * other policies. Written for people first — short sections, plain words.
 */
export default function LegalLayout({
  page,
  intro,
  sections,
}: {
  page: LegalPageId;
  intro: ReactNode;
  sections: LegalSection[];
}) {
  const meta = useMemo(() => legalMeta(SITE_URL, page), [page]);
  usePageMeta(meta);
  const info = LEGAL_PAGES[page];

  // A link such as /shygontap/privacy-policy#data-we-collect lands on its
  // section: the router does not scroll to hashes on its own.
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    let cancelled = false;
    const scroll = () => {
      if (!cancelled) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
    };
    const frame = requestAnimationFrame(scroll);
    // Again once the fonts have loaded: the text reflows and moves the section.
    void document.fonts?.ready.then(scroll);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [hash, page]);

  return (
    <div className="product-page">
      <header className="product-header">
        <div className="product-header-inner py-4 flex items-center justify-between">
          <Link to="/shygontap" className="store-brand text-xl">
            <BrandMark className="store-brand-mark" />
            SHYGON <span>TAP</span>
          </Link>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link to="/shygontap/store" className="text-sm font-semibold hover:text-[var(--ds-accent)]">
              All cards
            </Link>
          </div>
        </div>
      </header>

      <main className="product-main legal">
        <nav className="text-sm text-[var(--ds-text-tertiary)] mb-6" aria-label="Breadcrumb">
          <Link to="/shygontap" className="hover:text-[var(--ds-text)]">
            SHYGON Tap
          </Link>
          <ChevronRight size={14} className="inline mx-1 -mt-0.5" aria-hidden="true" />
          <span>Legal</span>
          <ChevronRight size={14} className="inline mx-1 -mt-0.5" aria-hidden="true" />
          <span className="text-[var(--ds-text)] font-semibold" aria-current="page">
            {info.name}
          </span>
        </nav>

        <p className="legal-eyebrow">Legal</p>
        <h1>{info.name}</h1>
        <p className="legal-updated">
          Last updated <time>{LEGAL.lastUpdated}</time>
        </p>
        <div className="legal-intro">{intro}</div>

        <div className="legal-layout">
          <nav className="legal-toc" aria-labelledby="legal-toc-title">
            <p id="legal-toc-title" className="legal-toc-title">
              On this page
            </p>
            <ol>
              {sections.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>{section.title}</a>
                </li>
              ))}
            </ol>
          </nav>

          <article className="legal-body">
            {sections.map((section) => (
              <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`}>
                <h2 id={`${section.id}-title`}>{section.title}</h2>
                {section.body}
              </section>
            ))}

            <aside className="legal-related" aria-label="Other policies">
              <h2>Other policies</h2>
              <ul>
                {(Object.keys(LEGAL_PAGES) as LegalPageId[])
                  .filter((id) => id !== page)
                  .map((id) => (
                    <li key={id}>
                      <Link to={LEGAL_PAGES[id].path}>{LEGAL_PAGES[id].name}</Link>
                    </li>
                  ))}
              </ul>
            </aside>
          </article>
        </div>
      </main>

      <StoreFooter />
    </div>
  );
}

/** Business identity and contact block, shared by several policies. */
export function ContactBlock({ grievance = false }: { grievance?: boolean }) {
  const officer = LEGAL.grievanceOfficer;
  return (
    <dl className="legal-contact">
      <div>
        <dt>Business</dt>
        <dd>
          {LEGAL.legalName}, trading as {LEGAL.brand}
        </dd>
      </div>
      <div>
        <dt>{LEGAL.registeredAddress ? 'Registered office' : 'Location'}</dt>
        <dd>{LEGAL.registeredAddress ?? `${LEGAL.city}, ${LEGAL.state}, ${LEGAL.country}`}</dd>
      </div>
      {LEGAL.cin && (
        <div>
          <dt>CIN</dt>
          <dd>{LEGAL.cin}</dd>
        </div>
      )}
      {LEGAL.gstin && (
        <div>
          <dt>GSTIN</dt>
          <dd>{LEGAL.gstin}</dd>
        </div>
      )}
      <div>
        <dt>Email</dt>
        <dd>
          <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>
        </dd>
      </div>
      <div>
        <dt>Phone / WhatsApp</dt>
        <dd>
          <a href={LEGAL.whatsappUrl} target="_blank" rel="noreferrer">
            {LEGAL.phone}
          </a>
        </dd>
      </div>
      {grievance && (
        <div>
          <dt>{officer.designation ?? 'Grievance Officer'}</dt>
          <dd>
            {officer.name ? `${officer.name}, ` : ''}
            <a href={`mailto:${officer.email}`}>{officer.email}</a>
            {officer.phone ? `, ${officer.phone}` : ''}
          </dd>
        </div>
      )}
    </dl>
  );
}
