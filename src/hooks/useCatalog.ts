import { useEffect, useState } from 'react';
import { fetchCatalog, type Catalog } from '../services/catalog';

/**
 * The live catalogue, or null while it loads or when it cannot be reached.
 * Display only: checkout prices every order again on the server.
 */
export function useCatalog(): Catalog | null {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchCatalog()
      .then((loaded) => {
        if (!cancelled) setCatalog(loaded);
      })
      .catch(() => {
        /* the pages fall back to the bundled copy */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return catalog;
}
