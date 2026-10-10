// No keys in the bundle (V6 Stage 5): what the browser downloads carries no
// secret, whatever the build environment held.
//
//   node scripts/ci/check-bundle-secrets.mjs [dist-dir]
//
// Fails, naming only the file and the kind of finding (never the value), when
// the built site contains:
//   - a JWT whose role is not "anon" (the anon key is public by design; a
//     service_role or any other project key would bypass row level security);
//   - the name of a server-only setting (it would mean server configuration
//     was compiled in);
//   - a private key block;
//   - a live Razorpay key id while live payments are not approved (set
//     LIVE_PAYMENTS_APPROVED=true at the go-live gate, B-3);
//   - a source map, or a reference to one (they publish the unminified source).
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(process.argv[2] ?? 'dist');
const TEXT = /\.(js|mjs|css|html|txt|xml|json|webmanifest|svg|map)$/i;
const SERVER_ONLY = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'OTP_SECRET',
  'TWILIO_AUTH_TOKEN',
  'MSG91_AUTH_KEY',
];
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}/g;

if (!fs.existsSync(path.join(DIR, 'index.html'))) {
  console.log(`FAIL  ${DIR} has no index.html: build first`);
  process.exit(1);
}

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}

const findings = [];
let scanned = 0;
let anonKeys = 0;
for (const file of files(DIR)) {
  const name = path.relative(DIR, file).replace(/\\/g, '/');
  if (/\.map$/i.test(file)) findings.push(`${name}: a source map`);
  if (!TEXT.test(file)) continue;
  scanned++;
  const text = fs.readFileSync(file, 'utf8');
  if (/[#@]\s*sourceMappingURL=/.test(text)) findings.push(`${name}: a sourceMappingURL reference`);
  for (const [token] of text.matchAll(JWT)) {
    let role = 'unreadable';
    try {
      role = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).role ?? 'none';
    } catch {
      /* stays unreadable */
    }
    if (role === 'anon') anonKeys++;
    else findings.push(`${name}: a JWT with role "${role}"`);
  }
  for (const setting of SERVER_ONLY) {
    if (text.includes(setting)) findings.push(`${name}: the server-only setting name ${setting}`);
  }
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) findings.push(`${name}: a private key block`);
  if (/\brzp_live_[A-Za-z0-9]+/.test(text) && process.env.LIVE_PAYMENTS_APPROVED !== 'true') {
    findings.push(`${name}: a live Razorpay key id, but live payments are not approved (B-3)`);
  }
}

if (findings.length) {
  for (const finding of findings) console.log(`FAIL  ${finding}`);
  process.exit(1);
}
console.log(`PASS  ${scanned} files in ${path.relative(process.cwd(), DIR) || DIR}: no secret, no source map (${anonKeys} anon key reference${anonKeys === 1 ? '' : 's'}, public by design)`);
