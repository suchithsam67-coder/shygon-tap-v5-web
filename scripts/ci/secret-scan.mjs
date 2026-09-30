// Secret-scanning gate (doc 12 M0.1): gitleaks over the full git history.
//
// Runs `gitleaks git` across every ref with full redaction. For each finding it
// prints only the rule, file, line and commit, never the matched text. It exits
// non-zero on any finding and on any failure to scan. The gate fails closed: a
// missing or wrong-version binary fails it, it never skips it.
//
// The only exceptions are fingerprints in .gitleaksignore. Each must be backed
// by an APPROVED DEC record (today only DEC-2026-020), and there is no
// .gitleaks.toml allowlist. Never add a fingerprint for a real secret: rotate
// the secret instead (doc 13 PB-4).
//
//   gitleaks 8.30.1 on PATH, or GITLEAKS_BIN=/path/to/gitleaks
//   npm run test:secrets
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PINNED_VERSION = '8.30.1';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = process.env.GITLEAKS_BIN || 'gitleaks';

const fail = (message) => {
  console.error(`FAIL  ${message}`);
  process.exit(1);
};

const version = spawnSync(BIN, ['version'], { encoding: 'utf8' });
if (version.error || version.status !== 0) {
  fail(`gitleaks is not runnable (${BIN}). Install gitleaks ${PINNED_VERSION} or set GITLEAKS_BIN.`);
}
const found = version.stdout.trim().replace(/^v/, '');
if (found !== PINNED_VERSION) fail(`gitleaks ${found} found; this gate is pinned to ${PINNED_VERSION}.`);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-scan-'));
const report = path.join(dir, 'report.json');
try {
  const scan = spawnSync(
    BIN,
    ['git', '--redact=100', '--no-banner', '--log-opts=--all', '--exit-code', '1',
      '--report-format', 'json', '--report-path', report, ROOT],
    { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] },
  );
  if (scan.error || ![0, 1].includes(scan.status) || !fs.existsSync(report)) {
    fail(`gitleaks did not complete a scan (exit ${scan.status ?? scan.error?.message}).`);
  }
  const findings = JSON.parse(fs.readFileSync(report, 'utf8') || '[]');
  for (const f of findings) {
    console.log(`  LEAK  ${f.RuleID}  ${f.File}:${f.StartLine}  commit ${String(f.Commit).slice(0, 12)}`);
  }
  if (findings.length > 0 || scan.status !== 0) {
    fail(`${findings.length} secret finding(s) in git history. Values are redacted; rotate any real secret (PB-4).`);
  }
  console.log('PASS  gitleaks: no findings in full history (exceptions: .gitleaksignore, DEC-2026-020)');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
