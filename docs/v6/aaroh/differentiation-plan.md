# SHYGON AAROH differentiation plan (2026-10-25)

| | |
|---|---|
| Direction | [OWNER] 2026-10-25, in session: "you plan and commit yourself", the product "should be unique than every product in market", "search the web plan and commit and update to another sessions also", "do not ask me for this" |
| Status | **PLAN, owner-directed.** Each build phase below still follows the standing rules: a DEC where one is required, local work only, no production, no deploy, no public switch. |
| Owner of this file | Session A (backend). Session B (frontend) is told of every change. |
| Evidence labels | OBSERVED (seen in a source or in this repository), INFERRED, PROPOSED, BUILT-LOCAL (built and tested on a local branch, never deployed) |

## 1. What the market sells today
Web research, 2026-10-25 (§8). Most sources are vendor pages and vendor-written comparisons. **Read their numbers as claims, not tests.**

| Category | Examples | What it does | How it earns / where it stops |
|---|---|---|---|
| Digital business cards | Popl, Blinq, HiHello, V1CE, Mobilo, Wave | A profile page and lead capture behind an NFC card or QR | Popl's free plan shows only 5 collected contacts; Blinq charges credits per badge scan and CRM sync; HiHello gives 4 profiles free, as separate cards; V1CE sells materials from about $79 (PVC) to $450 (24K gold) |
| India marketplace cards | IndiaMART sellers, Tagtual, sip.cards | The same, mostly as a printed card plus a link | PVC from about ₹45–70; metal about ₹799–2,199. A commodity |
| Emergency / medical ID | KOPILOT.ID, UNIT 1 Safety ID, twICEme, Hero Link, CareTag, EIO | A separate tag that shows medical details to a responder | Single-purpose; vendors disclaim that responders will use it |
| Lost and found | Tagnito, ScanTaps, Gear Trakr, SmartTag2 / AirTag lost mode | A finder reaches the owner, sometimes anonymously | Single-purpose; a separate tag per item |
| Authenticity | Dior sneakers, collectID, Verisart, Collectors Universe, NiFe WARS | An NFC tap proves a physical item is genuine (often NTAG 424 DNA) | Proves goods, never the person carrying them |
| Luxury / concierge | bank metal cards (Boubyan), The Digital Key | Concierge and privileges attached to a card | A service bundle; the card itself is passive |

Known weaknesses across the market [OBSERVED in the sources]:
- **The card dies with the vendor.** MOO stopped its NFC cards in 2020; programmed actions stopped working in January 2023.
- **Writable tags get rewritten** to point at phishing pages. Kaspersky's 2024–25 warnings describe this. A static URL proves nothing about the card.
- **Consent is a disclaimer, not a record.** Vendor guides recommend consent text at capture. None we found keeps an auditable two-sided record or lets the other person withdraw.
- **One job per object.** Contacts, safety, return-if-lost and authenticity are sold as different products.

## 2. The gap [INFERRED]
No product found combines these in one object a person already carries:
1. a card that **proves itself genuine on every tap**;
2. **owner-chosen contexts** (Business, Info, and later Guardian and Lost), with each context's data provably kept from the others;
3. a **safety layer** (Emergency Profile, Return-to-Owner) that never exposes the owner's number;
4. **contact exchange with a two-sided consent record**;
5. a **numbered material edition** whose tap is its own certificate.

This comes from a limited search, not an exhaustive survey. **Do not claim "first" or "only" publicly** until it has been verified (§6).

## 3. Positioning (draft for the owner; not public copy)
**"One genuine object. Many lives. Your consent, on record."**

AAROH is not a business card with extras. It is a verified personal object that changes what it does when its owner says so, and that refuses to leak one life into another.

## 4. The pillars

| # | Pillar | What makes it different | State today |
|---|---|---|---|
| A1 | **Verified Tap** | Every tap carries a one-time NTAG 424 DNA SUN signature, checked server-side at `/d/<code>`. The page says "Genuine SHYGON AAROH No. 037 of 100, Chapter 1", or warns of a copy or rewritten tag. Rewriting or copying a tag gains nothing. | Owner decision 2026-10-16 (`/d/<code>` + NTAG 424 DNA). **Not built.** PROPOSED: U1 |
| A2 | **Context modes** | One card, one active mode, switched by the owner and validated on the server. A mode never shows another mode's data: BQ-1 proves Business never leaks while Info is live, including after the kill switch. | **BUILT-LOCAL:** Business + Info (034, 035, `/api/modes`, contract v0.9). Info OFF in the catalogue |
| A3 | **Guardian layer** | Emergency Profile and Return-to-Owner live on the card people already carry. A finder reaches the owner without seeing a number. "Delivered" is claimed only with a signed provider receipt. | **BUILT-LOCAL:** 029 + 031, host switches off. Blocked by MSG91 + DLT, counsel, supervised trial |
| A4 | **Consent-ledger Connect** | Contacts are exchanged only by mutual consent. The append-only ledger records who shared what and when. Withdrawal and block really remove access. | **BUILT-LOCAL:** 032 + `CONNECT_PUBLIC` off (B-10). Counsel review (DEC-2026-017) |
| A5 | **Edition provenance** | Ten editions, chapters of 100, material cards with no printed QR. A1 makes each tap the edition's certificate, with no blockchain. | Design system done (artifact `PDDgqUPUVtd2SShFBXfUXz`). PROPOSED: U4 |
| A6 | **No lock-in pledge** | The owner can export everything (vCard + JSON) at any time. No paywall on viewing one's own contacts, no per-scan credits. A continuity plan keeps `/d/<code>` answering with the owner's static card if the service ever ends. | PROPOSED: U3. Needs the owner's and counsel's approval (a public promise with cost) |
| A7 | **Privacy by architecture** | Every AAROH table is closed to client roles; the browser reaches data only through server functions. Visitor counting uses a salted daily hash, with no ad trackers. | **BUILT-LOCAL:** RLS matrix 1565 checks, privacy canaries, 025 analytics |
| A8 | **Privé** | Hospitality concierge from the same card | **DEMO-ONLY:** 033 (DEC-2026-040). Real partners are a later decision |

## 5. Roadmap (local first; every phase ends at a gate)

| Phase | Scope | Gate before it starts | Done when |
|---|---|---|---|
| U0 | This plan and the claims register (§6) | — | committed (this file) |
| U1 | **Verified Tap backend on the local stack:** per-card SUN key records (never in the browser; derived from a master key the server holds), CMAC verification with NXP's published test vectors, read-counter replay refusal, a `/d/<code>` resolver contract, and tests (fresh tap, replayed tap, copied URL, rewritten tag, wrong key). Session B: the genuine / warning badge. | DEC-2026-043 drafted (key custody, the iOS caveat, what the page may say); migration 036 | local tests green; contract v0.10 |
| U2 | **Guardian and Lost as modes** on the A2 model, reusing 029 and 031 data, with no new public fields | owner choice of the mode list; BQ-style leak tests for each mode | every mode isolates its data (golden + canaries) |
| U3 | **Export and pledge:** the export endpoint, deletion parity and the continuity design | the owner's and counsel's approval of the wording and cost | export round-trip test; pledge text approved |
| U4 | **Edition provenance page**, driven by A1: number, chapter, material, the tap as the certificate | U1 done; edition numbering confirmed (chapters of 100) | e2e on the local stack |
| U5 | Hosted preview and the release track | AP-1–AP-6, P1, hosted P2, the V6-106 fresh capture | the existing release gates |

## 6. Claims register: never say these publicly until verified

| Claim | Status | Say instead |
|---|---|---|
| "Unclonable" / "cannot be copied" | Not verified. Vendor claims; no independent audit found; SUN on iOS may need an app (NXP datasheet) | "Each tap is cryptographically checked" (after U1 tests) |
| "The first" / "the only" | Not verified: a limited search | Describe the combination without ranking |
| Medical or life-saving claims | AAROH is not a medical device | "Lets the people you choose be reached" |
| "Delivered" | Only with a signed provider receipt (DEC-2026-038) | "Sent" until the receipt arrives |
| "Free and unlimited" (Info) | Excluded by DEC-2026-041 | — |

## 7. What changes for the other sessions
- **Session B (frontend):**
  - the A1 genuine / warning badge (U1);
  - mode pages for Guardian and Lost (U2);
  - export UI (U3);
  - the edition page (U4).
  - Contract versions are announced as usual.
- **Every session:** no public "first / only / unclonable" wording (§6).

## 8. Sources (searched 2026-10-25; vendor claims unless noted)
- Wave Connect, comparison posts: [Best Popl alternative](https://wavecnct.com/blogs/best-popl-alternative), [Best Blinq alternative](https://wavecnct.com/blogs/best-blinq-alternative). A competitor's own comparison.
- [G2: HiHello vs Popl](https://www.g2.com/compare/hihello-vs-popl-digital-business-card-platform)
- India pricing: [IndiaMART NFC business cards](https://dir.indiamart.com/greater-noida/nfc-business-card.html), [Tagtual launch](https://www.voicendata.com/tagtual-launches-nfc-business-cards/), [mymetalbusinesscard.com comparison](https://mymetalbusinesscard.com/blog/top-7-nfc-business-card-companies-materials-features-pricing-compared)
- Emergency ID:
  - [KOPILOT.ID launch](https://www.bicycleretailer.com/new-products/2025/12/17/kopilotid-launches-nfc-enabled-emergency-id)
  - [UNIT 1 Safety ID](https://intercom.help/unit1gearcom/en-us/articles/15858107-what-is-safety-id)
  - [twICEme](https://na.pocsports.com/blogs/journal/the-tech-nfc-medical-id)
  - [Hero Link](https://www.barchart.com/story/news/35820174/hero-link-announces-life-saving-medical-wellness-id-devices)
  - [EIO](https://fabnhsstuff.net/fab-stuff/eio-a-medical-smart-card)
- Lost and found:
  - [ScanTaps (ASU EPICS)](https://epics.engineering.asu.edu/2025/09/scantaps/)
  - [Gear Trakr](https://apps.apple.com/us/app/-/id1625312631)
  - [NFCW on Tagnito](https://www.nfcw.com/?p=86196)
  - [US8537002B2](https://patents.google.com/patent/US8537002)
- NTAG 424 DNA / SUN:
  - [WakDev knowledge base](https://www.wakdev.com/en/knowledge-base/nfc-chips/nxp-ntag424-dna.html)
  - [NXP datasheet NT4H2421Gx](https://docs.ampnuts.ru/nxp.com.datasheet/NT4H2421Gx.pdf)
  - [ntag424 crate docs](https://docs.rs/ntag424)
  - [WIOT on TagTamper](https://wiot-group.com/think/en/products/nxp-semiconductors-ntag-424-dna-ntag-424-dna-tagtamper/)
- Authenticity:
  - [Dior limited-edition sneakers FAQ](https://dior.com/en_pl/fashion/mens-fashion/limited-edition-sneakers-faq)
  - [collectID](https://www.startupticker.ch/en/companies/collectid)
  - [Verisart](https://help.verisart.com/en/articles/5772715-about-our-secure-printed-products)
  - [RFID Journal on collectibles](https://www.rfidjournal.com/nfc-proves-authenticity-ratings-of-collectibles)
  - [AIPT on NiFe WARS](https://aiptcomics.com/2026/06/03/nife-wars-nfc-authenticated-blind-bags/)
- Security:
  - [SecurityBrief on Kaspersky's tampered-tag warning](https://securitybrief.asia/story/kaspersky-warns-of-increasing-threats-from-tampered-nfc-tags)
  - [Mobilo on NFC card safety](https://www.mobilocard.com/post/are-nfc-business-cards-safe)
  - [NFCW on Fraunhofer's NFC research](https://www.nfcw.com/technology/253c/)
- Lock-in: [MOO: NFC Business Cards discontinued](https://support.moo.com/hc/en-gb/articles/360036195632-NFC-Business-Cards-discontinued)
- Consent:
  - [HiHello on contact-capture disclaimers](https://www.hihello.com/blog/why-contact-capture-disclaimers-matter-for-digital-business-cards)
  - [Spreadly GDPR guide](https://spreadly.app/en/blog/gdpr-compliant-digital-business-cards)
- Concierge:
  - [Boubyan Bank special-edition card](https://boubyan.bankboubyan.com/media/filer_public/6a/af/6aaf241e-082b-4692-aee6-b5f76a004378/bb-15_years-special_edition_card-brochure-en-27_08_201.pdf)
  - [The Digital Key](https://betalist.com/startups/the-digital-key)
