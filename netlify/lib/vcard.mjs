/**
 * The owner's own Business card as a vCard 3.0 (RFC 2426), the version phone
 * contact apps import most reliably. Used by /api/account owner.export
 * (DEC-2026-044 Q5). The fields come from migration 038's
 * account_export_request: only those the owner's privacy switches show on the
 * public profile, so the file is safe to share.
 *
 *   buildVcard(fields, siteUrl) -> string (CRLF lines, folded at 75 octets)
 */

/** Text values: backslash, comma, semicolon and line breaks are escaped (RFC 2426 §5). */
const text = (value) => String(value)
  .replace(/\\/g, '\\\\')
  .replace(/\r\n|\r|\n/g, '\\n')
  .replace(/,/g, '\\,')
  .replace(/;/g, '\\;');

/** URI values are not escaped, but a line break can never be part of one. */
const uri = (value) => String(value).replace(/[\r\n]+/g, '');

const present = (value) => typeof value === 'string' && value.trim() !== '';

/** Folds a content line at 75 octets, never inside a UTF-8 character (RFC 2425 §5.8.1). */
function fold(line) {
  const out = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const bytes = Buffer.byteLength(ch, 'utf8');
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with one space
    if (size + bytes > limit) {
      out.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += bytes;
  }
  out.push(current);
  return out.join('\r\n ');
}

export function buildVcard(fields, siteUrl) {
  if (!fields || typeof fields !== 'object') return null;
  const name = present(fields.displayName) ? fields.displayName.trim() : 'SHYGON contact';
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:;${text(name)};;;`, `FN:${text(name)}`];
  if (present(fields.company)) lines.push(`ORG:${text(fields.company)}`);
  const title = present(fields.designation) ? fields.designation : fields.headline;
  if (present(title)) lines.push(`TITLE:${text(title)}`);
  if (present(fields.phone)) lines.push(`TEL;TYPE=CELL:${text(fields.phone)}`);
  if (present(fields.whatsapp) && fields.whatsapp !== fields.phone) lines.push(`TEL;TYPE=CELL:${text(fields.whatsapp)}`);
  if (present(fields.email)) lines.push(`EMAIL;TYPE=INTERNET:${text(fields.email)}`);
  if (present(fields.location)) lines.push(`ADR:;;${text(fields.location)};;;;`);
  if (present(fields.slug) && present(siteUrl)) {
    lines.push(`URL:${uri(`${siteUrl.replace(/\/+$/, '')}/t/${encodeURIComponent(fields.slug)}`)}`);
  }
  if (present(fields.website)) lines.push(`URL:${uri(fields.website)}`);
  for (const network of ['instagram', 'linkedin', 'youtube']) {
    if (present(fields[network])) lines.push(`X-SOCIALPROFILE;TYPE=${network}:${uri(fields[network])}`);
  }
  lines.push('END:VCARD');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
