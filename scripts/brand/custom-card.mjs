// Writes only the custom card's art (public/assets/cards/custom-*.svg), without
// regenerating every other brand asset the way generate.mjs does.
//
//   node scripts/brand/custom-card.mjs
//
// generate.mjs writes the same files too, since `custom` is one of CONCEPTS.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderConcept } from './concepts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SITE = 'https://shygontech.com';
const COMPANY = fs.readFileSync(path.join(ROOT, 'src/lib/site.ts'), 'utf8').match(/COMPANY_NAME = '([^']+)'/)[1];

let written = 0;
for (const material of ['pvc', 'metal', 'transparent']) {
  for (const finish of ['standard', 'premium']) {
    for (const face of ['front', 'back']) {
      const name = `custom-${material}${finish === 'premium' ? '-premium' : ''}${face === 'back' ? '-back' : ''}.svg`;
      const svg = renderConcept({ key: 'custom', material, finish, face, site: SITE, company: COMPANY });
      fs.writeFileSync(path.join(ROOT, 'public/assets/cards', name), svg);
      written++;
    }
  }
}
console.log(`custom card: ${written} files`);
