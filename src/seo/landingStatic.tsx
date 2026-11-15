import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { LandingStaticTop } from '../pages/ShygonTap';

/**
 * The landing's static first paint (V01 T-14, OC-4), rendered at build time.
 *
 * vite.config.ts loads this module with Vite's server renderer after the
 * build, and writes the result into /shygontap's HTML, so the page opens
 * already showing its real header and hero instead of a loading screen. It is
 * the same component tree the page renders, so it cannot drift from it; the
 * live page replaces it in the same frame (src/lib/staticLanding.ts).
 *
 * Effects never run here, so nothing is fetched and no browser API is used;
 * the database client is a stand-in (src/seo/supabaseStub.ts).
 */
export function renderLandingStatic(): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/shygontap']}>
      <LandingStaticTop />
    </MemoryRouter>,
  );
}
