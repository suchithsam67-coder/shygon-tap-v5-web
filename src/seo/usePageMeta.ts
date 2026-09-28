import { useEffect } from 'react';
import { SITE_URL } from '../lib/site';
import type { PageMeta } from './meta';

/**
 * Applies a page's metadata to <head>: title, description, canonical, robots,
 * Open Graph / Twitter tags and JSON-LD.
 *
 * Tags are updated in place (found by selector, created if missing), so the
 * static copies the build writes into each page's HTML are replaced rather
 * than duplicated. Kept free of the product catalogue so the public Tap, which
 * uses it too, does not pull the catalogue into its bundle.
 */

const DEFAULT_IMAGE = '/og/shygon-tap.jpg';

function upsert(selector: string, create: () => HTMLElement): HTMLElement {
  let el = document.head.querySelector<HTMLElement>(selector);
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  return el;
}

function setMeta(attr: 'name' | 'property', key: string, content: string | null) {
  const selector = `meta[${attr}="${key}"]`;
  if (content === null) {
    document.head.querySelector(selector)?.remove();
    return;
  }
  const el = upsert(selector, () => {
    const m = document.createElement('meta');
    m.setAttribute(attr, key);
    return m;
  });
  el.setAttribute('content', content);
}

export function absoluteUrl(path: string): string {
  if (/^https?:/.test(path)) return path;
  // The canonical form has no trailing slash (except the bare origin).
  const clean = path === '/' ? '' : path.replace(/\/+$/, '');
  return `${SITE_URL}${clean.startsWith('/') || clean === '' ? '' : '/'}${clean}`;
}

export function applyPageMeta(meta: PageMeta) {
  const url = absoluteUrl(meta.path);
  const image = absoluteUrl(meta.image ?? DEFAULT_IMAGE);

  document.title = meta.title;
  setMeta('name', 'description', meta.description);
  setMeta('name', 'robots', meta.noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large');

  const canonical = upsert('link[rel="canonical"]', () => {
    const l = document.createElement('link');
    l.rel = 'canonical';
    return l;
  }) as HTMLLinkElement;
  // An error or private page has no canonical version of its own.
  if (meta.noindex) canonical.remove();
  else canonical.href = url;

  setMeta('property', 'og:type', meta.type === 'product' ? 'product' : meta.type === 'profile' ? 'profile' : 'website');
  setMeta('property', 'og:site_name', 'SHYGON Tap');
  setMeta('property', 'og:locale', 'en_IN');
  setMeta('property', 'og:title', meta.title);
  setMeta('property', 'og:description', meta.description);
  setMeta('property', 'og:url', meta.noindex ? null : url);
  setMeta('property', 'og:image', image);
  setMeta('property', 'og:image:alt', meta.imageAlt ?? meta.title);
  setMeta('name', 'twitter:card', 'summary_large_image');
  setMeta('name', 'twitter:title', meta.title);
  setMeta('name', 'twitter:description', meta.description);
  setMeta('name', 'twitter:image', image);

  const existing = document.head.querySelector('script#page-jsonld');
  if (meta.jsonLd?.length) {
    const script = (existing ?? document.createElement('script')) as HTMLScriptElement;
    script.id = 'page-jsonld';
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify({ '@context': 'https://schema.org', '@graph': meta.jsonLd });
    if (!existing) document.head.appendChild(script);
  } else {
    existing?.remove();
  }
}

/** Applies `meta` while the calling page is mounted. Pass a stable value. */
export function usePageMeta(meta: PageMeta | null) {
  useEffect(() => {
    if (meta) applyPageMeta(meta);
  }, [meta]);
}
