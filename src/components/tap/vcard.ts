import type { PublicProfile } from '../../lib/database.types';

/**
 * "Save contact": a vCard 3.0 of exactly what this page shows, built in the
 * browser (no request), which phones open straight into "Add to contacts".
 *
 * Its own chunk, preloaded once the page has rendered (TapExperience), so it
 * costs the public Tap's entry bundle nothing and the tap stays a direct user
 * gesture, which some phones need before they allow a download.
 */
function href(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

export function saveContact(data: PublicProfile) {
  // Every value is the page owner's own text: escape it so it cannot end a
  // line and add properties (or whole extra contacts) to the file.
  const esc = (value: string) =>
    value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/([,;])/g, '\\$1');
  // Phone numbers, addresses and links are not escaped text in vCard 3.0, but
  // a line break would still start a new property.
  const one = (value: string | undefined) => (value ?? '').replace(/[\r\n]+/g, ' ').trim();
  const name = data.displayName?.trim() || 'SHYGON Tap contact';
  const parts = name.split(/\s+/);
  const last = parts.length > 1 ? parts.pop()! : '';
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${esc(name)}`,
    `N:${esc(last)};${esc(parts.join(' '))};;;`,
    data.company && `ORG:${esc(data.company)}`,
    (data.designation || data.headline) && `TITLE:${esc(data.designation || data.headline || '')}`,
    data.phone && `TEL;TYPE=CELL:${one(data.phone)}`,
    data.whatsapp && data.whatsapp !== data.phone && `TEL;TYPE=WORK:${one(data.whatsapp)}`,
    data.email && `EMAIL;TYPE=INTERNET:${one(data.email)}`,
    data.website && `URL:${one(href(data.website))}`,
    data.location && `ADR;TYPE=WORK:;;${esc(data.location)};;;;`,
    data.linkedin && `X-SOCIALPROFILE;TYPE=linkedin:${one(href(data.linkedin))}`,
    data.instagram && `X-SOCIALPROFILE;TYPE=instagram:${one(href(data.instagram))}`,
    `NOTE:${esc(`SHYGON Tap · ${window.location.origin}/shygontap/${data.slug}`)}`,
    'END:VCARD',
  ].filter(Boolean);
  const blob = new Blob([lines.join('\r\n')], { type: 'text/vcard;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name.replace(/[^\w\- ]+/g, '').trim() || 'contact'}.vcf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
