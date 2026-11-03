// The SUN crypto core for NTAG 424 DNA taps — U1 "Verified Tap": published
// known answers first, then every refusal this server must make.
//
//   node --import ./scripts/ci/deny-network.mjs netlify/tests/sun.mjs
//
// Every known-answer value below is quoted from a published document, with its
// section next to it:
//   - RFC 4493 §4                     AES-CMAC examples 1-4
//   - NXP AN10922 §2.2.1, Table 2     AES-128 key diversification
//   - NXP AN12196 §3.3, Table 1       SDM session key (SV2)
//   - NXP AN12196 §3.4.2.2, Table 2   encrypted PICCData decryption
//   - NXP AN12196 §3.4.4.2.1, Table 4 SDMMAC over a zero-length message
//   - NXP AN12196 §3.4.4.2.2, Table 5 SDMMAC over the URL text (end to end)
// Nothing here is invented: negative cases are built at run time and only have
// to be refused. The run is offline (deny-network), touches no database, no
// environment variable and no key store, and prints no key or UID on success.
import crypto from 'node:crypto';
import { assert, assertEqual, createHarness } from '../../supabase/local/testkit.mjs';
import {
  SUN_FAILURES,
  acceptCounter,
  aesCmac,
  decryptPiccData,
  diversifyKey,
  sdmMac,
  sdmSessionMacKey,
  verifySun,
} from '../lib/sun.mjs';

const t = createHarness('SUN crypto core: NTAG 424 DNA known answers and refusals');
const bytes = (value) => Buffer.from(value, 'hex');
const ZERO_KEY = '00000000000000000000000000000000'; // the transport value of every NTAG 424 DNA AppKey

/** A refusal, with its reason checked against the fixed set. */
function refusal(result) {
  assert(result && result.ok === false, 'expected a refusal');
  assert(SUN_FAILURES.includes(result.reason), `reason outside the fixed set: ${result.reason}`);
  return result.reason;
}

/** The error a throwing helper must raise, or a failure. */
function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw, got a value');
}

// ---------------------------------------------------------------------------
t.section('RFC 4493 §4: AES-CMAC known answers (key 2b7e…4f3c)');

const RFC_KEY = '2b7e151628aed2a6abf7158809cf4f3c';
const RFC_M = bytes('6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710');

for (const [label, length, expected] of [
  ['example 1: len = 0', 0, 'bb1d6929e95937287fa37d129b756746'],
  ['example 2: len = 16 (complete block → K1)', 16, '070a16b46b4d4144f79bdd9dd04a287c'],
  ['example 3: len = 40 (padded last block → K2)', 40, 'dfa66747de9ae63030ca32611497c827'],
  ['example 4: len = 64', 64, '51f0bebf7e3b9d92fc49741779363cfe'],
]) {
  await t.check(`RFC 4493 §4 ${label}`, () => {
    assertEqual(aesCmac(RFC_KEY, RFC_M.subarray(0, length)), expected, 'AES-CMAC');
    return `${length} bytes`;
  });
}

// ---------------------------------------------------------------------------
t.section('NXP AN10922 §2.2.1: AES-128 key diversification (Table 2)');

const AN10922_KEY = '00112233445566778899aabbccddeeff';
const AN10922_INPUT = bytes('04782e21801d803042f54e585020416275'); // UID || DESFire AID || system id, 17 bytes

await t.check('AN10922 §2.2.1: the published diversified key', () => {
  assertEqual(diversifyKey(AN10922_KEY, AN10922_INPUT), 'a8dd63a3b89d54b37ca802473fda9175', 'diversified key');
  return 'master 001122…eeff, input 17 bytes';
});

await t.check('AN10922 §2.2.1: over 15 input bytes it is plain CMAC over 01||M (the note in the section)', () => {
  assertEqual(diversifyKey(AN10922_KEY, AN10922_INPUT), aesCmac(AN10922_KEY, Buffer.concat([Buffer.from([0x01]), AN10922_INPUT])), 'shortcut');
});

await t.check('diversification: one card, one key — stable per input, different between inputs', () => {
  const other = bytes('04782e21801d803142f54e585020416275'); // the same shape, a different UID byte
  assertEqual(diversifyKey(AN10922_KEY, AN10922_INPUT), diversifyKey(AN10922_KEY, AN10922_INPUT), 'deterministic');
  assert(diversifyKey(AN10922_KEY, AN10922_INPUT) !== diversifyKey(AN10922_KEY, other), 'two cards derived the same key');
  assert(diversifyKey(AN10922_KEY, AN10922_INPUT) !== diversifyKey(ZERO_KEY, AN10922_INPUT), 'two master keys derived the same key');
});

await t.check('diversification: only bytes, only 1…31 of them, keys exactly 32 hex characters', () => {
  thrown(() => diversifyKey(AN10922_KEY, Buffer.alloc(0)));
  thrown(() => diversifyKey(AN10922_KEY, Buffer.alloc(32)));
  thrown(() => diversifyKey(AN10922_KEY, '04782e21801d803042f54e585020416275')); // a string must not pass for bytes
  thrown(() => diversifyKey(AN10922_KEY.slice(1), AN10922_INPUT));
  thrown(() => diversifyKey('zz'.repeat(16), AN10922_INPUT));
});

// ---------------------------------------------------------------------------
t.section('NXP AN12196 §3.3: SDM session MAC key (SV2, then CMAC)');

await t.check('AN12196 §3.3 Table 1: non-zero SDMFileReadKey, counter 010000', () => {
  assertEqual(
    sdmSessionMacKey('5ace7e50ab65d5d51fd5bf5a16b8205b', '04C767F2066180', 1),
    '3a3e8110e05311f7a3fcf0d969bf2b48',
    'KsesSDMFileReadMAC',
  );
});

await t.check('AN12196 §3.4.4.2.1 Table 4: all-zero key, UID 04DE5F1EACC040, counter 61', () => {
  assertEqual(sdmSessionMacKey(ZERO_KEY, '04de5f1eacc040', 61), '3fb5f6e3a807a03d5e3570ace393776f', 'KsesSDMFileReadMAC');
});

await t.check('AN12196 §3.4.4.2.2 Table 5: all-zero key, UID 04958CAA5C5E80, counter 8', () => {
  assertEqual(sdmSessionMacKey(ZERO_KEY, '04958caa5c5e80', 8), '3ed0920e5e6a0320d823d5987feafbb1', 'KsesSDMFileReadMAC');
});

await t.check('SV2 carries the counter LSB first and no other bytes (16 in total)', () => {
  const key = '5ace7e50ab65d5d51fd5bf5a16b8205b';
  const manual = bytes('3cc30001008004c767f2066180030201'); // prefix || UID || 010203 as 03 02 01
  assertEqual(sdmSessionMacKey(key, '04c767f2066180', 0x010203), aesCmac(key, manual), 'byte order');
  thrown(() => sdmSessionMacKey(key, '04c767f20661', 1)); // 6-byte UID
  thrown(() => sdmSessionMacKey(key, '04c767f2066180', 0x1000000)); // past the 24-bit counter
});

// ---------------------------------------------------------------------------
t.section('NXP AN12196 §3.4.2.2: encrypted PICCData (AES-128-CBC, zero IV)');

await t.check('AN12196 §3.4.2.2 Table 2: tag C7, UID, counter 61 (3D0000, LSB first)', () => {
  const picc = decryptPiccData(ZERO_KEY, 'EF963FF7828658A599F3041510671E88');
  assertEqual(picc.tag, 0xc7, 'tag');
  assertEqual(picc.uid, '04de5f1eacc040', 'uid');
  assertEqual(picc.readCounter, 61, 'readCounter');
});

await t.check('AN12196 §3.4.4.2.2 Table 5: the second published PICCData block', () => {
  const picc = decryptPiccData(ZERO_KEY, 'FD91EC264309878BE6345CBE53BADF40');
  assertEqual(picc.uid, '04958caa5c5e80', 'uid');
  assertEqual(picc.readCounter, 8, 'readCounter');
});

await t.check('a tag byte that does not announce a mirrored 7-byte UID plus counter is refused', () => {
  const encrypt = (plain) => {
    const cipher = crypto.createCipheriv('aes-128-cbc', bytes(ZERO_KEY), Buffer.alloc(16));
    cipher.setAutoPadding(false);
    return Buffer.concat([cipher.update(plain), cipher.final()]).toString('hex');
  };
  const block = (tag, uid = '04de5f1eacc040') =>
    Buffer.concat([Buffer.from([tag]), bytes(uid), Buffer.from([61, 0, 0]), Buffer.alloc(5)]);
  // 00: no mirrors; 47: counter only; C4/C6: a different UID length; E7: the RFU bits set (NT4H2421Gx Table 21).
  const refused = [];
  for (const tag of [0x00, 0x47, 0xc4, 0xc6, 0xe7]) {
    thrown(() => decryptPiccData(ZERO_KEY, encrypt(block(tag))));
    refused.push(tag.toString(16));
  }
  // Control: the same constructor with the right tag gets past the tag rule and
  // fails only at the MAC (the UID differs, the counter does not) — so the
  // refusals above are the tag rule working, not a broken builder.
  assertEqual(
    refusal(verifySun({
      encPiccHex: encrypt(block(0xc7, '04de5f1eacc041')),
      macHex: '94EED9EE65337086',
      metaReadKey: ZERO_KEY,
      fileReadKey: ZERO_KEY,
    })),
    'bad_mac',
    'control: tag C7, another UID',
  );
  return `${refused.length} wrong tags refused, control reached the MAC`;
});

// ---------------------------------------------------------------------------
t.section('NXP AN12196 §3.4.4: the SDMMAC and its truncation');

await t.check('AN12196 §3.4.4.2.1 Table 4: full CMAC over the empty message, then the 8 kept bytes', () => {
  const sessionKey = '3fb5f6e3a807a03d5e3570ace393776f';
  assertEqual(aesCmac(sessionKey, Buffer.alloc(0)), 'e194c7ee12d9f7ee8a65c8331b704386', 'full CMAC (the section\'s pseudo-code)');
  assertEqual(sdmMac(sessionKey, ''), '94eed9ee65337086', 'truncated SDMMAC');
});

await t.check('AN12196 §3.4.4.2.2 Table 5: the URL text the card covered', () => {
  const sessionKey = '3ed0920e5e6a0320d823d5987feafbb1';
  const macInput = 'CEE9A53E3E463EF1F459635736738962&cmac=';
  assertEqual(aesCmac(sessionKey, macInput), '81ec45c175e72ff6fac61bc7ab3baef6', 'full CMAC');
  assertEqual(sdmMac(sessionKey, macInput), 'ecc1e7f6c6c73bf6', 'truncated SDMMAC');
  assertEqual(sdmMac(sessionKey, Buffer.from(macInput, 'ascii')), 'ecc1e7f6c6c73bf6', 'bytes instead of text');
});

// ---------------------------------------------------------------------------
t.section('verifySun: both published taps, end to end');

const KNOWN_TAP = {
  encPiccHex: 'EF963FF7828658A599F3041510671E88',
  macHex: '94EED9EE65337086',
  metaReadKey: ZERO_KEY,
  fileReadKey: ZERO_KEY,
};

await t.check('the widely cited example (e=EF96…, c=94EE…, all-zero keys) verifies as UID + counter 61', () => {
  assertEqual(verifySun(KNOWN_TAP), { ok: true, uid: '04de5f1eacc040', readCounter: 61 }, 'verified tap');
});

await t.check('AN12196 §3.4.4.2.2 Table 5 verifies with its URL text as the MAC input', () => {
  assertEqual(
    verifySun({
      encPiccHex: 'FD91EC264309878BE6345CBE53BADF40',
      macHex: 'ECC1E7F6C6C73BF6',
      metaReadKey: ZERO_KEY,
      fileReadKey: ZERO_KEY,
      macInput: 'CEE9A53E3E463EF1F459635736738962&cmac=',
    }),
    { ok: true, uid: '04958caa5c5e80', readCounter: 8 },
    'verified tap',
  );
});

await t.check('either letter case is accepted; macInput defaults to the empty message', () => {
  assertEqual(verifySun({ ...KNOWN_TAP, encPiccHex: KNOWN_TAP.encPiccHex.toLowerCase(), macHex: KNOWN_TAP.macHex.toLowerCase() }), {
    ok: true,
    uid: '04de5f1eacc040',
    readCounter: 61,
  }, 'lowercase');
  assertEqual(verifySun({ ...KNOWN_TAP, encPiccHex: KNOWN_TAP.encPiccHex.toUpperCase(), macHex: KNOWN_TAP.macHex.toUpperCase() }), {
    ok: true,
    uid: '04de5f1eacc040',
    readCounter: 61,
  }, 'uppercase');
});

// ---------------------------------------------------------------------------
t.section('verifySun: every single-bit flip in e and in c is refused');

await t.check('e: all 128 single-bit flips refused', () => {
  const enc = bytes(KNOWN_TAP.encPiccHex);
  const accepted = [];
  const reasons = new Set();
  for (let bit = 0; bit < enc.length * 8; bit++) {
    const flipped = Buffer.from(enc);
    flipped[bit >> 3] ^= 1 << (bit & 7);
    const result = verifySun({ ...KNOWN_TAP, encPiccHex: flipped.toString('hex') });
    if (result.ok) accepted.push(bit);
    else reasons.add(refusal(result));
  }
  assertEqual(accepted, [], 'flips that verified');
  return `128 refused (${[...reasons].join(', ')})`;
});

await t.check('c: all 64 single-bit flips refused', () => {
  const mac = bytes(KNOWN_TAP.macHex);
  const accepted = [];
  for (let bit = 0; bit < mac.length * 8; bit++) {
    const flipped = Buffer.from(mac);
    flipped[bit >> 3] ^= 1 << (bit & 7);
    const result = verifySun({ ...KNOWN_TAP, macHex: flipped.toString('hex') });
    if (result.ok) accepted.push(bit);
    else refusal(result);
  }
  assertEqual(accepted, [], 'flips that verified');
  return '64 refused (bad_mac)';
});

// ---------------------------------------------------------------------------
t.section('verifySun: the wrong key and the wrong shape');

await t.check('the wrong key: meta read, file read, or both', () => {
  assertEqual(refusal(verifySun({ ...KNOWN_TAP, metaReadKey: 'ff'.repeat(16) })), 'bad_picc', 'wrong meta read key');
  assertEqual(refusal(verifySun({ ...KNOWN_TAP, fileReadKey: 'ff'.repeat(16) })), 'bad_mac', 'wrong file read key');
  assertEqual(refusal(verifySun({ ...KNOWN_TAP, metaReadKey: 'ff'.repeat(16), fileReadKey: 'ff'.repeat(16) })), 'bad_picc', 'both wrong');
  // The same card, one character of its MAC key changed — the realistic "wrong card" case.
  assertEqual(refusal(verifySun({ ...KNOWN_TAP, fileReadKey: '000000000000000000000000000000ff' })), 'bad_mac', 'one byte off');
});

await t.check('wrong lengths, non-hex input and extra characters: bad_format, never a throw', () => {
  assertEqual(refusal(verifySun()), 'bad_format', 'no arguments at all');
  assertEqual(refusal(verifySun({})), 'bad_format', 'an empty object');
  const malformed = [
    ['enc missing', { encPiccHex: undefined }],
    ['enc one character short', { encPiccHex: 'EF963FF7828658A599F3041510671E8' }],
    ['enc one character over', { encPiccHex: 'EF963FF7828658A599F3041510671E880' }],
    ['enc empty', { encPiccHex: '' }],
    ['enc with a non-hex digit', { encPiccHex: 'EF963FF7828658A599F3041510671E8Z' }],
    ['enc with a trailing space', { encPiccHex: 'EF963FF7828658A599F3041510671E88 ' }],
    ['enc with a 0x prefix', { encPiccHex: '0xEF963FF7828658A599F3041510671E88' }],
    ['enc as bytes instead of text', { encPiccHex: bytes('ef963ff7828658a599f3041510671e88') }],
    ['mac missing', { macHex: undefined }],
    ['mac short', { macHex: '94EED9EE6533708' }],
    ['mac long', { macHex: '94EED9EE6533708600' }],
    ['mac non-hex', { macHex: '94EED9EE6533708G' }],
    ['meta read key short', { metaReadKey: ZERO_KEY.slice(1) }],
    ['meta read key non-hex', { metaReadKey: 'z'.repeat(32) }],
    ['file read key long', { fileReadKey: `${ZERO_KEY}00` }],
    ['macInput null', { macInput: null }],
    ['macInput a number', { macInput: 42 }],
  ];
  for (const [label, patch] of malformed) {
    const result = patch === undefined ? verifySun() : verifySun({ ...KNOWN_TAP, ...patch });
    assertEqual(refusal(result), 'bad_format', label);
  }
  return `${malformed.length + 2} malformed inputs refused`;
});

await t.check('the low-level helpers throw a fixed message and never echo the value', () => {
  thrown(() => aesCmac('not-a-key', Buffer.alloc(0)));
  thrown(() => aesCmac(RFC_KEY, 42));
  thrown(() => decryptPiccData(ZERO_KEY.slice(1), KNOWN_TAP.encPiccHex));
  thrown(() => decryptPiccData(ZERO_KEY, 'EF963FF7828658A599F3041510671E8')); // short ciphertext
  thrown(() => sdmSessionMacKey(ZERO_KEY, 'zz', 1));
  thrown(() => sdmSessionMacKey(ZERO_KEY, '04de5f1eacc040', -1));
  thrown(() => sdmMac(ZERO_KEY, null));
  thrown(() => sdmMac('ff', ''));
});

// ---------------------------------------------------------------------------
t.section('acceptCounter: the replay rule');

await t.check('strictly greater, first tap, the limit, and everything that is not an integer in range', () => {
  const cases = [
    [null, 0, true],       // first tap, counter at its reset value
    [null, 61, true],      // first tap
    [null, 0xfffffe, true],
    [null, 0xffffff, false], // the 24-bit limit: the card can never beat it again
    [0, 1, true],
    [5, 6, true],
    [5, 7, true],          // a gap: taps that never reached us still counted
    [5, 5, false],         // replay
    [5, 4, false],         // replay of an older tap
    [5, 0, false],
    [0xffffff, 0xffffff, false],
    [0xffffff, 1, false],
    [61, 61, false],
    [61, 62, true],
    [null, -1, false],
    [null, 1.5, false],
    [null, '7', false],
    [null, 0x1000000, false],
    [undefined, 7, false], // only null means "never seen"
    ['5', 6, false],
    [5, null, false],
    [-1, 5, false],
  ];
  for (const [lastSeen, readCounter, expected] of cases) {
    assertEqual(acceptCounter(lastSeen, readCounter), expected, `acceptCounter(${String(lastSeen)}, ${String(readCounter)})`);
  }
  return `${cases.length} cases`;
});

// ---------------------------------------------------------------------------
t.section('Canary: no refusal and no thrown error carries a key or a UID');

await t.check('keys, UIDs and decrypted bytes never reach a failure result or an error message', () => {
  const metaReadKey = '00112233445566778899aabbccddeeff';
  const fileReadKey = '5ace7e50ab65d5d51fd5bf5a16b8205b';
  const masterKey = 'ffeeddccbbaa99887766554433221100';
  const uid = '04de5f1eacc040';
  const sessionKey = sdmSessionMacKey(ZERO_KEY, uid, 61);
  const plaintext = 'c704de5f1eacc0403d0000da5cf60941';

  const texts = [];
  const failing = [
    verifySun({ ...KNOWN_TAP, macHex: '00'.repeat(8) }),
    verifySun({ ...KNOWN_TAP, metaReadKey, fileReadKey }),
    verifySun({ ...KNOWN_TAP, encPiccHex: '00'.repeat(16) }),
    verifySun({ ...KNOWN_TAP, fileReadKey: 'ff'.repeat(16) }),
    verifySun({ ...KNOWN_TAP, encPiccHex: 'short' }),
    verifySun({ ...KNOWN_TAP, macInput: null }),
    verifySun(),
  ];
  for (const result of failing) {
    refusal(result);
    texts.push(JSON.stringify(result));
  }
  const throws = [
    () => aesCmac('bad', Buffer.alloc(0)),
    () => aesCmac(fileReadKey, 42),
    () => decryptPiccData(metaReadKey, KNOWN_TAP.encPiccHex),
    () => decryptPiccData(metaReadKey, 'zz'),
    () => diversifyKey(masterKey, 'a string is not bytes'),
    () => diversifyKey(masterKey, Buffer.alloc(40)),
    () => sdmSessionMacKey(fileReadKey, '04de5f1eacc04', 61),
    () => sdmSessionMacKey(fileReadKey, uid, 0x1000000),
    () => sdmMac(sessionKey, null),
  ];
  for (const fn of throws) texts.push(String(thrown(fn).message));

  const secrets = [metaReadKey, fileReadKey, masterKey, uid, sessionKey, plaintext, KNOWN_TAP.encPiccHex, KNOWN_TAP.macHex];
  for (const text of texts) {
    const lower = text.toLowerCase();
    for (const secret of secrets) {
      assert(!lower.includes(secret.toLowerCase()), 'a failure or a thrown error leaked a key, a UID or a decrypted byte');
    }
  }
  return `${texts.length} failures and throws x ${secrets.length} secrets`;
});

// ---------------------------------------------------------------------------
const ok = t.finish();
process.exit(ok ? 0 : 1);
