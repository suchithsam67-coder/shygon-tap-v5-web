import crypto from 'node:crypto';

/**
 * The SUN (Secure Unique NFC) crypto core for NTAG 424 DNA cards — U1 "Verified Tap".
 *
 * Every AAROH tap opens `…/d/<code>?e=…&c=…`: the card appends encrypted PICC data
 * (the UID plus the read counter) and a truncated AES-CMAC. This module re-derives
 * both on the server and says whether the tap checks out.
 *
 * Pure functions on node:crypto only: no dependencies, no I/O, no environment
 * reads, no logging, no storage. Keys and UIDs never appear in a message this
 * module throws or returns on failure. What it deliberately does NOT do — key
 * custody, replay storage, the `/d/` endpoint, the iOS caveat — is written down in
 * docs/v6/aaroh/U1_sun-crypto-notes.md, together with the source of every vector.
 *
 * Published sources implemented here:
 *   - RFC 4493 "The AES-CMAC Algorithm": §2.3 subkeys, §2.4 MAC, §4 test vectors;
 *   - NXP AN10922 "Symmetric key diversifications" Rev 2.2: §2.2 AES-128 method;
 *   - NXP AN12196 "NTAG 424 DNA and NTAG 424 DNA TagTamper features and hints"
 *     Rev 2.0: §2 truncation, §3.3 session keys, §3.4.2.2 PICC data, §3.4.4 SDMMAC;
 *   - NXP NT4H2421Gx data sheet Rev 3.0: §9.3.1 counter, Table 21 tag byte,
 *     §9.3.4.1 CBC with a zero IV.
 */

const AES_BLOCK = 16;
/** RFC 4493 const_Rb: only the low byte differs from zero. */
const RB_LAST_BYTE = 0x87;
/** AN12196 §3.3: SV2 = 3CC3 0001 0080 || UID || SDMReadCtr. */
const SV2_PREFIX = Buffer.from('3cc300010080', 'hex');
/**
 * The tag byte that says "UID mirrored, SDMReadCtr mirrored, bits 5-4 RFU,
 * UID length 7": 1100_0111b (NT4H2421Gx data sheet Table 21; AN12196 §3.4.2.2
 * steps 8-11). Anything else is a card layout we do not handle.
 */
const PICC_DATA_TAG = 0xc7;
/** SDMReadCtr is 24 bits (data sheet §9.3.1), so 0xFFFFFF is the last value. */
export const COUNTER_LIMIT = 0xffffff;
/** The only failure reasons verifySun ever returns. */
export const SUN_FAILURES = ['bad_format', 'bad_picc', 'bad_mac'];
/** AN12196 §2 / data sheet §9.1.3: keep bytes 1,3,…,15 of the 16-byte CMAC. */
const TRUNCATED_BYTE_INDEXES = [1, 3, 5, 7, 9, 11, 13, 15];

// ---------------------------------------------------------------------------
// Strict parsing. Error messages name the field and the expected shape, never
// the value: a caller's log must never show a key.
// ---------------------------------------------------------------------------

const isHex = (value, bytes) =>
  typeof value === 'string' && value.length === bytes * 2 && /^[0-9a-f]+$/i.test(value);

function hexBytes(value, bytes, field) {
  if (!isHex(value, bytes)) throw new TypeError(`sun: ${field} must be exactly ${bytes * 2} hex characters`);
  return Buffer.from(value, 'hex');
}

/** Bytes, or a string read as UTF-8 (the SUN MAC input is URL text). */
function messageBytes(value, field) {
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError(`sun: ${field} must be a string or bytes`);
}

function counterBytes(readCounter) {
  if (!Number.isInteger(readCounter) || readCounter < 0 || readCounter > COUNTER_LIMIT) {
    throw new TypeError('sun: readCounter must be an integer from 0 to 0xFFFFFF');
  }
  return Buffer.from([readCounter & 0xff, (readCounter >>> 8) & 0xff, (readCounter >>> 16) & 0xff]);
}

function xor(a, b) {
  const out = Buffer.allocUnsafe(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

/** One AES-128 block, ECB, no padding: the primitive RFC 4493 and AN10922 build on. */
function aesBlock(key, block) {
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(block), cipher.final()]);
}

/** CBC decryption with an all-zero IV; the input is whole blocks, so no padding mode. */
function aesCbcDecrypt(key, data) {
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, Buffer.alloc(AES_BLOCK));
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/** RFC 4493 §2.3 Generate_Subkey: L = AES(K,0), K1 = L<<1 (+Rb), K2 = K1<<1 (+Rb). */
function subkeys(key) {
  const shift = (block) => {
    const out = Buffer.alloc(AES_BLOCK);
    let carry = 0;
    for (let i = AES_BLOCK - 1; i >= 0; i--) {
      out[i] = ((block[i] << 1) | carry) & 0xff;
      carry = block[i] >>> 7;
    }
    if (carry) out[AES_BLOCK - 1] ^= RB_LAST_BYTE;
    return out;
  };
  const first = shift(aesBlock(key, Buffer.alloc(AES_BLOCK)));
  return [first, shift(first)];
}

/** RFC 4493 §2.4, in the steps the RFC writes them: K1 for a complete last block, K2 + 10* otherwise. */
function cmac(key, message) {
  const [k1, k2] = subkeys(key);
  const blocks = Math.ceil(message.length / AES_BLOCK) || 1; // an empty message is one padded block
  const complete = message.length > 0 && message.length % AES_BLOCK === 0;
  const start = (blocks - 1) * AES_BLOCK;
  let last;
  if (complete) {
    last = xor(message.subarray(start), k1);
  } else {
    const tail = Buffer.alloc(AES_BLOCK);
    message.copy(tail, 0, start);
    tail[message.length - start] = 0x80;
    last = xor(tail, k2);
  }
  let x = Buffer.alloc(AES_BLOCK);
  for (let i = 0; i < blocks - 1; i++) x = aesBlock(key, xor(x, message.subarray(i * AES_BLOCK, (i + 1) * AES_BLOCK)));
  return aesBlock(key, xor(x, last));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * AES-CMAC (RFC 4493). Node ships no CMAC, so it is built from AES-128-ECB.
 *
 * @param {string} key16 16 bytes as hex, either case.
 * @param {Uint8Array|string} message bytes to authenticate; a string is UTF-8.
 * @returns {string} the 16-byte MAC as lowercase hex.
 */
export function aesCmac(key16, message) {
  return cmac(hexBytes(key16, 16, 'key16'), messageBytes(message, 'message')).toString('hex');
}

/**
 * AES-128 key diversification, NXP AN10922 §2.2 (the CMAC-based method): each
 * card holds a key derived from a master key the server keeps, so one card key
 * leaking never opens another card.
 *
 * D = 0x01 || input || 80 00… padded to exactly 32 bytes, last block XORed with
 * K2 — with K1 only when the input is the full 31 bytes and nothing is padded —
 * then AES-128-CBC with a zero IV; the diversified key is the last block.
 *
 * @param {string} masterKey16 16 bytes as hex, either case.
 * @param {Uint8Array} diversificationInput 1-31 raw bytes (UID, key number, …).
 *   Bytes only: a hex string would be read as its ASCII characters, which is
 *   never what the card was given.
 * @returns {string} the 16-byte diversified key as lowercase hex.
 */
export function diversifyKey(masterKey16, diversificationInput) {
  const key = hexBytes(masterKey16, 16, 'masterKey16');
  if (!ArrayBuffer.isView(diversificationInput)) {
    throw new TypeError('sun: diversificationInput must be bytes (Uint8Array), not a string');
  }
  const input = Buffer.from(diversificationInput.buffer, diversificationInput.byteOffset, diversificationInput.byteLength);
  if (input.length < 1 || input.length > 31) throw new TypeError('sun: diversificationInput must be 1 to 31 bytes');
  const padded = input.length < 31; // AN10922 §2.2: the flag decides K1 or K2 in the last round
  const diversification = Buffer.alloc(32);
  diversification[0] = 0x01; // AN10922 §2.2: the AES-128 diversification constant
  input.copy(diversification, 1);
  if (padded) diversification[1 + input.length] = 0x80;
  const [k1, k2] = subkeys(key);
  const mask = padded ? k2 : k1;
  const chain = aesBlock(key, diversification.subarray(0, AES_BLOCK));
  return aesBlock(key, xor(xor(diversification.subarray(AES_BLOCK), mask), chain)).toString('hex');
}

/**
 * Decrypt the encrypted PICC data of one tap: AES-128-CBC with an all-zero IV
 * (AN12196 §3.4.2.2, data sheet §9.3.4.1). The single block is
 * `tag || UID(7) || SDMReadCtr(3, LSB first) || random padding`.
 *
 * Refuses anything whose tag byte does not announce exactly a mirrored 7-byte
 * UID plus a counter (0xC7); the thrown message carries no decrypted bytes.
 *
 * @param {string} sdmMetaReadKey16 16 bytes as hex, either case.
 * @param {string} encHex the `e=` parameter: exactly 32 hex characters.
 * @returns {{tag: number, uid: string, readCounter: number}} uid as lowercase hex,
 *   readCounter as an integer (the 3 counter bytes are LSB first).
 */
export function decryptPiccData(sdmMetaReadKey16, encHex) {
  const key = hexBytes(sdmMetaReadKey16, 16, 'sdmMetaReadKey');
  const enc = hexBytes(encHex, 16, 'encHex');
  const plain = aesCbcDecrypt(key, enc);
  if (plain[0] !== PICC_DATA_TAG) throw new Error('sun: PICCData tag is not a mirrored 7-byte UID plus a counter');
  return {
    tag: plain[0],
    uid: plain.subarray(1, 8).toString('hex'),
    readCounter: plain[8] | (plain[9] << 8) | (plain[10] << 16),
  };
}

/**
 * The per-tap session MAC key: SV2, then CMAC (AN12196 §3.3). The card derives
 * the same key from the same UID and counter, so a copied URL still has to fit
 * the counter the card is actually at.
 *
 * SV2 = 3CC300010080 || UID || SDMReadCtr is exactly 16 bytes, because UID and
 * counter are always mirrored when PICCData is encrypted (AN12196 Table 1 note 1).
 *
 * @param {string} sdmFileReadKey16 16 bytes as hex, either case.
 * @param {string} uid the 7-byte UID as 14 hex characters, either case.
 * @param {number} readCounter 0 … 0xFFFFFF.
 * @returns {string} the 16-byte session key as lowercase hex.
 */
export function sdmSessionMacKey(sdmFileReadKey16, uid, readCounter) {
  const key = hexBytes(sdmFileReadKey16, 16, 'sdmFileReadKey');
  const sv2 = Buffer.concat([SV2_PREFIX, hexBytes(uid, 7, 'uid'), counterBytes(readCounter)]);
  return cmac(key, sv2).toString('hex');
}

/**
 * The SUN MAC: CMAC under the session key, then AN12196's truncation — keep the
 * eight odd-numbered bytes (0-based indexes 1,3,…,15) in order, which the data
 * sheet calls "the 8 even-numbered bytes … in most-to-least-significant order".
 * Example: e194c7ee12d9f7ee8a65c8331b704386 → 94eed9ee65337086 (AN12196 §3.4.4.2.1).
 *
 * @param {string} sessionMacKey 16 bytes as hex, from sdmSessionMacKey().
 * @param {Uint8Array|string} macInput exactly the bytes the card covered
 *   (SDMMACInputOffset … SDMMACOffset-1). The default configuration starts the
 *   CMAC at the CMAC offset, so the message is empty (AN12196 §3.4.4.2.1); a
 *   string is UTF-8, which for URL text is the bytes on the wire.
 * @returns {string} the 8-byte truncated MAC as lowercase hex.
 */
export function sdmMac(sessionMacKey, macInput) {
  const full = cmac(hexBytes(sessionMacKey, 16, 'sessionMacKey'), messageBytes(macInput, 'macInput'));
  return Buffer.from(TRUNCATED_BYTE_INDEXES.map((index) => full[index])).toString('hex');
}

/**
 * One tap, checked. Order matters and so do the refusals: format first, then
 * decrypt, then MAC — and a failure carries only its reason, never a key, a UID
 * or anything decrypted.
 *
 * @param {{encPiccHex?: string, macHex?: string, metaReadKey?: string,
 *   fileReadKey?: string, macInput?: Uint8Array|string}} tap the `e=` and `c=`
 *   parameters, the two per-card keys, and the MAC input (default: empty).
 * @returns {{ok: true, uid: string, readCounter: number} |
 *   {ok: false, reason: 'bad_format'|'bad_picc'|'bad_mac'}}
 */
export function verifySun(tap) {
  const { encPiccHex, macHex, metaReadKey, fileReadKey, macInput = '' } = tap ?? {};
  if (!isHex(encPiccHex, 16) || !isHex(macHex, 8) || !isHex(metaReadKey, 16) || !isHex(fileReadKey, 16)) {
    return { ok: false, reason: 'bad_format' };
  }
  if (typeof macInput !== 'string' && !ArrayBuffer.isView(macInput)) return { ok: false, reason: 'bad_format' };

  let picc;
  try {
    picc = decryptPiccData(metaReadKey, encPiccHex);
  } catch {
    return { ok: false, reason: 'bad_picc' }; // wrong key or a tag we refuse: never echo the plaintext
  }
  const expected = Buffer.from(sdmMac(sdmSessionMacKey(fileReadKey, picc.uid, picc.readCounter), macInput), 'hex');
  const received = Buffer.from(macHex, 'hex');
  // Both sides are 8 bytes here (checked above), so timingSafeEqual is legal and constant time.
  if (!crypto.timingSafeEqual(expected, received)) return { ok: false, reason: 'bad_mac' };
  return { ok: true, uid: picc.uid, readCounter: picc.readCounter };
}

/**
 * The replay rule, as a pure predicate: accept only a counter strictly greater
 * than the last one stored (null = the first tap for this card).
 *
 * "Strictly greater", not "equal to last + 1": taps that never reach the server
 * still advance the card's counter (the counter increments on the card per first
 * read, AN12196 §3.2 and data sheet §9.3.1), so a gap wider than one is normal
 * traffic and must not look like an attack. What must never pass again is a
 * value the server has already seen or gone past.
 *
 * 0xFFFFFF is refused outright: the data sheet §9.3.1 says the card returns an
 * error once the counter reaches that value, so no later tap can ever be greater.
 * Accepting it would pin the card at its last value, and the final URL could be
 * replayed as "the newest" until re-personalisation. Anything that is not an
 * integer in range is refused too.
 *
 * @param {number|null} lastSeen the stored counter, or null for a first tap.
 * @param {number} readCounter the counter this tap claims.
 * @returns {boolean} true only for a fresh, strictly newer, in-range counter.
 */
export function acceptCounter(lastSeen, readCounter) {
  if (!Number.isInteger(readCounter) || readCounter < 0 || readCounter >= COUNTER_LIMIT) return false;
  if (lastSeen === null) return true;
  if (!Number.isInteger(lastSeen) || lastSeen < 0) return false;
  return readCounter > lastSeen;
}
