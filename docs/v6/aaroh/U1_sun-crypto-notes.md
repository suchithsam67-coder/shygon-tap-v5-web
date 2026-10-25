# U1 "Verified Tap": the SUN crypto core

| | |
|---|---|
| Files | `netlify/lib/sun.mjs` (the library), `netlify/tests/sun.mjs` (the proof), this page |
| Branch / status | `opencode/u1-sun-crypto`, base 234f95a — **BUILT-LOCAL, never deployed** |
| Proves | differentiation-plan §4 A1 (first half) and §5 U1 ("CMAC verification with NXP's published test vectors, read-counter refusal") |
| Does not prove | the `/d/<code>` resolver, key custody, replay storage, the badge — all still U1 + DEC-2026-043 |
| Evidence labels | OBSERVED = ran here; INFERRED = reasoned from a cited document |

## 1. What the library is

Pure functions, `node:crypto` only: no dependencies, no I/O, no environment reads, no
logging, no storage. Hex in, hex out, either letter case, exact lengths. Nothing it
throws or returns on failure contains a key, a UID or a decrypted byte (OBSERVED: the
canary check in the suite).

| Function | Implements | Source (document, section) |
|---|---|---|
| `aesCmac(key16, message)` | AES-CMAC built on AES-128-ECB: subkeys K1/K2, `10*` padding, K1 on a complete last block | RFC 4493 §2.3, §2.4 |
| `diversifyKey(masterKey16, input)` | `D = 0x01 ‖ input ‖ 80 00…` to exactly 32 bytes, last block XOR K2 (K1 only for a full 31-byte input), AES-128-CBC zero IV, last block out | NXP AN10922 Rev 2.2 §2.1, §2.2, §2.2.1 |
| `decryptPiccData(key16, encHex)` | `tag ‖ UID(7) ‖ SDMReadCtr(3, LSB first) ‖ random padding`, AES-128-CBC, IV all zero; refuses any tag ≠ `0xC7` | AN12196 Rev 2.0 §3.4.2.2 (Table 2); NT4H2421Gx Rev 3.0 §9.3.4.1, Table 21 |
| `sdmSessionMacKey(fileReadKey16, uid, counter)` | `SV2 = 3CC300010080 ‖ UID ‖ SDMReadCtr` (16 bytes), then CMAC → `KsesSDMFileReadMAC` | AN12196 §3.3 (Table 1) |
| `sdmMac(sessionMacKey, macInput)` | CMAC, then truncation: keep bytes at indexes 1,3,…,15 ("the 8 even-numbered bytes, most-to-least-significant") | AN12196 §2; NT4H2421Gx §9.1.3 |
| `verifySun({encPiccHex, macHex, metaReadKey, fileReadKey, macInput=''})` | strict format → decrypt → MAC, `crypto.timingSafeEqual` on the two 8-byte MACs; `{ok,uid,readCounter}` or `{ok:false,reason}` with `bad_format` / `bad_picc` / `bad_mac` only | order per AN12196 §3.4.2.2 + §3.4.4 |
| `acceptCounter(lastSeen, readCounter)` | strictly greater than `lastSeen`; `null` = first tap; refuses `0xFFFFFF` and anything not an integer in 0…0xFFFFFF | NT4H2421Gx §9.3.1 (24-bit counter, the card errors at the limit); AN12196 §3.2 (the counter advances on the card) |

**Why "greater than" and not "equal to last + 1":** the counter increments on the card
per first read (datasheet §9.3.1), so taps whose URL never reached us still moved it —
a gap wider than one is ordinary traffic, never an attack. What must never pass again is
a value already seen or passed. **Why `0xFFFFFF` is refused:** at that value the card
itself returns an error on the next first read (§9.3.1), so no later tap can ever be
greater — accepting it would let the card's final URL be replayed as "the newest".
Treat it as end of verifiable life → re-personalise (open question below).

## 2. Vectors used, and where each comes from

Every known answer below is quoted from the document; none is invented (OBSERVED: suite
passes against them).

| Vector | Value | Source |
|---|---|---|
| AES-CMAC examples 1–4 (len 0/16/40/64) | `bb1d6929…`, `070a16b4…`, `dfa66747…`, `51f0bebf…` under key `2b7e1516…4f3c` | RFC 4493 §4 |
| AES-128 diversification | K `00112233445566778899AABBCCDDEEFF`, M `04782E21801D803042F54E585020416275` → `A8DD63A3B89D54B37CA802473FDA9175` | AN10922 §2.2.1 Table 2 |
| SDM session key (non-zero key) | K `5ACE7E50AB65D5D51FD5BF5A16B8205B`, UID `04C767F2066180`, ctr 1 → `3A3E8110E05311F7A3FCF0D969BF2B48` | AN12196 §3.3 Table 1 |
| PICCData decryption | `EF963FF7828658A599F3041510671E88`, all-zero key → tag `C7`, UID `04DE5F1EACC040`, ctr `3D0000` = **61** | AN12196 §3.4.2.2 Table 2 |
| Session key + SDMMAC, empty message | all-zero key, UID `04DE5F1EACC040`, ctr 61 → key `3FB5F6E3A807A03D5E3570ACE393776F`, CMAC `e194c7ee12d9f7ee8a65c8331b704386`, truncated **`94EED9EE65337086`** | AN12196 §3.4.4.2.1 Table 4 |
| End-to-end tap with URL text | `e=FD91EC264309878BE6345CBE53BADF40`, `c=ECC1E7F6C6C73BF6`, all-zero keys, `macInput = "CEE9A53E3E463EF1F459635736738962&cmac="` → UID `04958CAA5C5E80`, ctr 8 | AN12196 §3.4.4.2.2 Table 5 |

The widely circulated example (`e=EF963F…`, `c=94EED9…`, all-zero keys → UID
`04DE5F1EACC040`, counter 61) was treated as a hint only: **it matches the document**
(AN12196 §3.4.2.2 Table 2 + §3.4.4.2.1 Table 4), so it is asserted with the document's
section numbers, not the hint's.

## 3. How it was verified (OBSERVED)

```
node --import ./scripts/ci/deny-network.mjs netlify/tests/sun.mjs   → 27 passed, 0 failed, exit 0
npm run lint                                                          → no output, exit 0
```

The suite covers: the 4 RFC examples; the AN10922 key plus its documented "over 15 bytes
it is plain CMAC over `01‖M`" shortcut; three AN12196 session-key vectors; two PICC
decryption vectors; both SDMMAC vectors; two end-to-end taps (either letter case);
**all 128 single-bit flips of `e` and all 64 of `c` refused**; wrong meta key, wrong file
key, one byte off; 19 malformed inputs → `bad_format`; 5 wrong tag bytes → `bad_picc`
with a control that reaches the MAC; 22 `acceptCounter` cases; and a canary over 16
failures/throws × 8 secrets (keys, UID, session key, plaintext) — no leak.

Note (OBSERVED): `npx eslint --print-config netlify/lib/sun.mjs` resolves `"rules": {}`
— `npm run lint` parses the `.mjs` files but applies no rules to them, exactly as for the
other `netlify/**` files. The syntax check is real; there is no style enforcement there.

## 4. What this library deliberately does NOT do

- **Key storage or custody.** It never reads an environment variable. Who holds the
  master key, how `diversifyKey` output reaches a card record, and key rotation are
  DEC-2026-043 (migration 036 is not written).
- **Replay storage.** `acceptCounter` is a pure predicate; somebody else must read and
  write `lastSeen` per card, transactionally, and decide what happens on a refusal.
- **The endpoint.** No routing, no `/d/<code>` lookup, no query parsing, no URL
  construction, no rate limiting, no logging, no badge wording. It takes `e`, `c` and the
  MAC input as parameters — whoever slices the URL must reproduce exactly
  `SDMMACInputOffset … SDMMACOffset-1` bytes (AN12196 §3.4.4.2), which for the
  configuration in §5 of that note is the `enc` value plus `&cmac=`.
- **Encrypted file data.** `SDMENCFileData` (with `SesSDMFileReadENC` and the `IVe`
  construction) is out of scope; only `e` and `c` are verified here.
- **iOS behaviour.** The datasheet says SUN works on Android without an app and on iOS
  with an app (NT4H2421Gx §1.1); per differentiation-plan §6 we still may not claim
  "unclonable" or "cannot be copied". What a tap does on a phone without the app is not
  answered by this library.
- **LRP-mode cards.** In LRP mode the plaintext is `PICCRand(8) ‖ E_LRP(PICCData)` and
  the placeholder doubles (datasheet §9.3.4.2) → `e` is no longer 32 hex characters, so
  `decryptPiccData` refuses it by construction. We only support AES-mode cards.

Two properties worth knowing when you wire this up (OBSERVED in the suite):

1. With the default empty `macInput` (AN12196 §3.4.4.2.1), the MAC binds the session
   key derived from `UID ‖ counter`; it does not cover the random padding inside `e`.
   That is not malleable: any single-bit change of the one AES block re-randomises the
   whole plaintext, and all 128 flips are refused (mostly `bad_picc`, some `bad_mac`).
2. `verifySun` never returns a UID on failure, so a caller cannot leak one by logging the
   refusal — it must also not log its own inputs (keys are the caller's to redact).

## 5. Open questions for DEC-2026-043

1. **Custody:** where does the master key live, and is `diversifyKey`'s input the card UID
   alone, or UID ‖ key number as AN10922 §2.1 suggests? Both SDMMetaRead and SDMFileRead
   must be derived from one master without colliding.
2. **Which AppKey is which:** one key number is the `SDMMetaReadKey`, another the
   `SDMFileReadKey` (datasheet §8.2.3.4). Who records that mapping per card?
3. **MAC input contract:** the byte range depends on `SDMMACInputOffset`/`SDMMACOffset`
   chosen at personalisation. Is one NDEF layout fixed for all AAROH cards, so the
   endpoint can hard-code it?
4. **Counter storage:** table, index, and the transaction that compares-and-stores
   `lastSeen` (two taps racing must not both pass). What does a refusal do to the visitor
   — warning badge, or a counter reset?
5. **`0xFFFFFF`:** this library refuses it as end of verifiable life. Is re-personalising
   the card the agreed answer, and who is told when a card approaches the limit?
6. **LRP / RandomID:** if a batch is ever switched to LRP mode or RandomID (datasheet
   §10.5), `e` changes shape. Do we detect and reject loudly, or keep AES-mode only?
7. **iOS wording:** what the page may say when the tap arrives through an app vs the
   Android background read (claims register §6).
