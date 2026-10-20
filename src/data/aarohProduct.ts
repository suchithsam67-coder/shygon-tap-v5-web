import { siteContent, WHATSAPP_NUMBER } from './shygonTapData'
import { AAROH_BULK_MINIMUM, AAROH_EDITION_COUNT, AAROH_EDITIONS, AAROH_FINISHES } from './aaroh'

/**
 * What the store tells a customer about AAROH, before they spend anything.
 *
 * Every statement here was checked against the code on 2026-10-11 and again on
 * 2026-10-13 (DEC-2026-037; the store reports list the evidence). The rule: nothing is described as available
 * unless the release ships it. What depends on an experience or an add-on says
 * so; what arrives with the card release (activation, lost-card protection,
 * card numbering) or is not built at all is labelled that way, never implied.
 * Card prices come from the catalogue on the pages; the few sentences that
 * quote one use the display fallback in src/data/aaroh.ts.
 */

const listOf = (items: readonly string[]) => items.join(', ').replace(/, ([^,]*)$/, ' or $1')
const editionNames = listOf(AAROH_EDITIONS.map((e) => e.title))
const [STANDARD, PREMIUM] = AAROH_FINISHES
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

/**
 * Availability, in the words the owner-app plan uses: available; available
 * once you have set something up; on an eligible experience; a paid add-on;
 * arriving with the card release; or planned (on the SHYGON OS roadmap, not
 * built, no date, and never included with a card by implication).
 */
export type FeatureStatus = 'available' | 'setup' | 'package' | 'addon' | 'card-release' | 'future'

export const STATUS_LABEL: Record<FeatureStatus, string> = {
  available: 'Available',
  setup: 'Available after setup',
  package: 'Requires an eligible plan',
  addon: 'Paid add-on',
  'card-release': 'With the card release',
  future: 'Planned',
}

/** The four questions the store answers first. */
export const AT_A_GLANCE: readonly (readonly [question: string, answer: string])[] = [
  [
    'What is AAROH?',
    `SHYGON’s premium smart card: a physical card with an NFC chip, linked to your SHYGON digital profile. One product, in ${AAROH_EDITION_COUNT} editions and two finishes.`,
  ],
  [
    'How does the card work?',
    'Someone taps it with an NFC-enabled phone, and your profile opens in their browser. No app, no account.',
  ],
  [
    'What software comes with it?',
    'Your SHYGON profile: your details and contact buttons, your own link and QR code, a look you choose, and visitor analytics. How far you can customise it depends on your experience.',
  ],
  [
    'What do I receive?',
    'The card in the edition and finish you choose, linked to your profile. Cards are coming soon; the digital profile is available today.',
  ],
]

export const STEPS: readonly { title: string; body: string; note?: string }[] = [
  {
    title: 'Choose your card',
    body: `Pick an edition (${editionNames}) and a finish: ${STANDARD.title} or ${PREMIUM.title}. Then choose the digital experience you want with it.`,
    note: 'AAROH cards are not on sale yet.',
  },
  {
    title: 'Receive your card',
    body: 'Cards ship within India. Delivery estimates, tracking and what happens if a card arrives damaged are set out in our Shipping and Refund policies.',
    note: 'Dispatch details for AAROH are confirmed when card sales open.',
  },
  {
    title: 'Activate and personalise',
    body: 'Sign in to your SHYGON account, fill in your profile, choose how it looks, and publish it.',
    note: 'Linking a physical card to your account opens with the card release.',
  },
  {
    title: 'Tap',
    body: 'The person you meet taps the card with an NFC-enabled phone. Your profile opens in their browser: no app, no account, no fee. For a phone without NFC, share your link or show your profile’s QR code from your account.',
  },
]

export const SOFTWARE_FEATURES: readonly { title: string; body: string; status: FeatureStatus }[] = [
  {
    title: 'Your digital profile',
    body: 'Your name, headline, role, company, a short bio and a photo, on a page at your own link.',
    status: 'available',
  },
  {
    title: 'Call and email',
    body: 'Call and email buttons for the people you meet, each of which you can show or hide.',
    status: 'available',
  },
  {
    title: 'More ways to reach you',
    body: 'WhatsApp, Instagram, LinkedIn, Website and Location buttons, each bought once and shown only when you switch it on.',
    status: 'addon',
  },
  {
    title: 'Link, QR code and sharing',
    body: 'Your profile’s link and QR code, ready to copy or share. Visitors can share your profile from their phone.',
    status: 'available',
  },
  {
    title: 'Your look',
    body: 'Colour palettes, layouts, button styles, fonts and an opening animation. Essential has the basics; Business, Premium and GOAT unlock more. The Customization Pass unlocks every palette.',
    status: 'package',
  },
  {
    title: 'Analytics',
    body: 'Profile views, visitors, QR scans and your most-clicked buttons, over 7, 30 or 90 days.',
    status: 'available',
  },
  {
    title: 'Publish or pause',
    body: 'Publish your profile when it is ready, and pause it at any time.',
    status: 'available',
  },
  {
    title: 'Updates, support and your data',
    body: 'Payment and order updates in your account, support tickets you can follow, and a copy of your data whenever you ask.',
    status: 'available',
  },
  {
    title: 'Card activation and lost cards',
    body: 'Linking a card to your account, and switching a lost card off so it stops opening your profile.',
    status: 'card-release',
  },
]

export const ROLES = {
  cardholder: [
    'Buys the card and a digital experience',
    'Signs in to a SHYGON account and sets up the profile',
    'Chooses what visitors see, and how it looks',
    'Sees visits, scans and clicks in analytics',
  ],
  recipient: [
    'Taps the card with an NFC-enabled phone',
    'Sees your profile in their browser: no app, no account, no fee',
    'Calls, emails or messages you with the buttons you have switched on',
    'Can share your profile with someone else',
  ],
} as const

/**
 * What the one card is used for. AAROH is a product for individual customers;
 * an organisation can order the same card for its team (DEC-2026-037). None of
 * these is a separate product, plan or card category.
 */
export const USE_CASES: readonly { title: string; body: string; status: FeatureStatus }[] = [
  {
    title: 'Professional identity',
    body: 'Share who you are and how to reach you, in one tap, at every meeting.',
    status: 'available',
  },
  {
    title: 'Networking and events',
    body: 'Hand over your details at conferences and gatherings without paper. Event services such as tickets or check-in are not part of AAROH.',
    status: 'available',
  },
  {
    title: 'Employee ID cards',
    body: `An organisation can order the same AAROH card for its team: ${AAROH_BULK_MINIMUM} cards or more, through a bulk enquiry, priced by quotation. Each employee sets up their own SHYGON profile with their name, photo, role, company and the contact details they choose to show.`,
    status: 'available',
  },
  {
    title: 'Managing a team’s cards',
    body: 'Assigning cards to employees, and managing their profiles from one organisation account, are not available yet. Today each employee holds their own account.',
    status: 'future',
  },
]

/** The bulk-order enquiry: one AAROH card, ordered for a team (DEC-2026-037). */
export const BULK_ORDER = {
  title: 'Cards for your team',
  lede: `Ordering AAROH for ${AAROH_BULK_MINIMUM} or more people, for example as employee ID cards? Tell us what you need and we will reply with a quotation.`,
  points: [
    'The same AAROH card, in any edition and finish',
    'Priced by quotation; no subscription or per-employee fee',
    'Each employee’s card opens their own SHYGON profile, which they control',
  ],
  limits:
    'Not available yet: assigning cards to employees or managing their profiles from one organisation account. An AAROH card is an identity and contact card, not a building-access, attendance or authentication credential.',
} as const

/**
 * Answers to the store's questions. Unknowns say what is still to be
 * confirmed. `cardSales` is passed in (the page and the SEO build each know
 * it) so no AAROH price is shown before card sales open (owner, 2026-10-16).
 */
export const aarohFaqs = (cardSales: boolean): readonly (readonly [question: string, answer: string])[] => [
  [
    'What is an AAROH card?',
    `AAROH is SHYGON’s premium smart card: a physical card with an NFC chip, linked to your SHYGON digital profile. It comes in ${AAROH_EDITION_COUNT} editions (${editionNames}) and two finishes, and every one works the same way.`,
  ],
  [
    'How does NFC tapping work?',
    'The other person holds an unlocked phone, with NFC switched on, a few centimetres from the card. The phone reads the link on the card’s chip and opens your profile in its browser.',
  ],
  [
    'What if a phone does not support NFC?',
    'Share your profile’s link, or open your profile’s QR code in your account and let them scan it from your screen. It opens the same profile. The card itself carries no printed QR, so its back stays clean.',
  ],
  [
    'Is there a QR code on the card?',
    'Not by default. AAROH is tap-first: the back is kept clean, with the SHYGON logo, the card’s number and a quiet tap cue. Your profile’s QR code is always in your account, to share from your screen or print. If testing shows customers need one, a version with a QR on the back may be offered; it would open the card’s own permanent link, the same one a tap opens.',
  ],
  [
    'Does the recipient need to install an app?',
    'No. Your profile is a web page that opens in the phone’s browser. They don’t need an app or an account, and they never pay anything.',
  ],
  [
    'How do I activate my card?',
    'AAROH cards are not on sale yet. Linking a card to your account opens with the card release, and the steps will be published then. Your digital profile can be set up today: choose an experience, sign up and pay, then edit and publish your profile.',
  ],
  [
    'Can I update my digital profile later?',
    'Yes. You can change your profile once every 14 days (your first change is always allowed), and the Customization Pass, a one-time purchase, removes the limit. Showing or hiding your phone or email, and pausing or publishing your profile, don’t count as changes.',
  ],
  [
    'Can I choose a different physical design?',
    `Yes: ${editionNames}, each in ${STANDARD.title} (the artwork printed) or ${PREMIUM.title} (relief, metallic foil and a painted edge). Every option is the same AAROH card with the same features; only the surface differs. They are shown as concept renders while the final cards are validated with our manufacturer.`,
  ],
  [
    'How much does an AAROH card cost?',
    cardSales
      ? `${STANDARD.title} is ${inr(STANDARD.price)} and ${PREMIUM.title} is ${inr(PREMIUM.price)}, per card, paid once. Orders of ${AAROH_BULK_MINIMUM} cards or more are priced by quotation.`
      : `Pricing is announced when card sales open, and every edition shows its price before you pay. A card is paid once, with no subscription, and orders of ${AAROH_BULK_MINIMUM} cards or more are priced by quotation. Delivery and tax terms are published before card sales open.`,
  ],
  [
    'What is the difference between SHYGON TAP V5 and AAROH?',
    `Both are NFC cards that open the same SHYGON digital profile, with the same experiences and add-ons. SHYGON TAP V5 is the simpler card, in Business, Restaurant, Event, Google Review and Design Collection designs, in PVC, metal or transparent. AAROH is the premium family: ${AAROH_EDITION_COUNT} landscape editions, each numbered in chapters of 100, in a printed or a Premium Finish, with a clean back and no printed QR.`,
  ],
  [
    'Can my company order AAROH cards for employees?',
    `Yes. Send a bulk-order enquiry for ${AAROH_BULK_MINIMUM} cards or more and we reply with a quotation. Each employee’s card opens their own SHYGON profile, which they set up and control. Assigning cards and managing employee profiles from one organisation account are not available yet, and an AAROH card is not a building-access, attendance or authentication credential.`,
  ],
  [
    'Are all AAROH features included in the purchase?',
    'No. Every profile has the essentials. Business, Premium and GOAT unlock more looks and layouts, and some buttons (WhatsApp, Instagram, LinkedIn, Website and Location) are paid add-ons. Everything shows its price before you pay.',
  ],
  [
    'Does the card work on iPhone and Android?',
    'It is designed to. iPhone XS or newer and most NFC-enabled Android phones read NFC cards without an app; a phone without NFC opens your profile from its link or its QR code, shown from your account. Tested phone compatibility will be published before card sales open.',
  ],
  [
    'What happens if I lose my card?',
    'Contact us through Support. For now, switching a card off in your account does not yet stop it opening your profile; that protection, and replacement cards, come with the card release. Until then you can pause your profile at any time.',
  ],
  [
    'Can one account manage multiple cards?',
    'An account can hold several cards, and every one of them opens the same profile: each SHYGON account has one profile.',
  ],
  [
    'Will future SHYGON OS features be included with my card?',
    'Planned SHYGON OS features, such as Return to owner or Student Passport, are shown as a roadmap so you can see where the platform is heading. They are not available today, have no release dates, and buying a card does not include or guarantee them. If one launches, its price and terms are shown before you can use it.',
  ],
  [
    'How is my AAROH card numbered?',
    'Every AAROH card carries a printed serial number and is numbered in its edition’s chapters of 100. The serial is for reference only: it is not a password, and nobody can use it to open or change your profile.',
  ],
  [
    'Are subscriptions or renewals required?',
    'There is no subscription. Experiences, the Customization Pass and add-ons are one-time payments. How long a card’s activation lasts will be confirmed before card sales open.',
  ],
  [
    'What personal information is visible when someone taps my card?',
    'Only what is on your published profile: your name, headline, role, company, bio and photo, and the buttons you have switched on. Phone and email can be hidden, and add-on buttons show only when you turn them on. While your profile is paused, nobody sees it.',
  ],
  [
    'How do I get support?',
    `Open a ticket from Support in your account, message us on WhatsApp (+${WHATSAPP_NUMBER.replace(/^91/, '91 ')}), or email ${siteContent.contact.email}.`,
  ],
]

/** The icons the showcase can draw (lucide-react, mapped in FeatureShowcase). */
export type ShowcaseIcon =
  | 'profile'
  | 'contact'
  | 'buttons'
  | 'look'
  | 'share'
  | 'analytics'
  | 'visibility'
  | 'card'
  | 'return'
  | 'emergency'
  | 'student'
  | 'event'
  | 'place'
  | 'cloud'

/** One entry in the AAROH feature showcase. */
export interface ShowcaseFeature {
  /** Stable id: also the showcase's URL-free selection key. */
  id: string
  name: string
  /** One line: what it does for the cardholder. */
  benefit: string
  icon: ShowcaseIcon
  status: FeatureStatus
  /** A short, realistic example. */
  useCase: string
  /** What the cardholder controls, and where. */
  ownerControls: string
  /** What a visitor can and cannot see. */
  privacy: string
  /** Configurable in the cardholder's SHYGON account today. */
  configurable: boolean
  /** The experience or purchase it depends on, when the code says so. */
  requires?: string
  /** Overrides the status word for one feature, when the owner chose its words. */
  statusLabel?: string
  /**
   * Where a cardholder manages it today: a real page of the SHYGON account
   * (sign-in first). Only live features have one; planned ones never do.
   */
  action?: { label: string; to: string }
}

/**
 * The AAROH feature showcase (the cinematic store overview), 2026-10-14.
 *
 * The first group is what the SHYGON account and profile do today, from the
 * code (the same evidence as SOFTWARE_FEATURES above). The second group is the
 * SHYGON OS roadmap: candidate modules from the owner-app plan
 * (SHYGON_AAROH_Owner_App_and_SHYGON_OS_Experience_Plan, 2026-10), shown as
 * "Planned" on the owner's decision of 2026-10-16. None is built, none has a
 * release date, buying a card does not include or guarantee any of them, and
 * none has an action. Left out on purpose: SHYGON Privé (the owner decided not
 * to launch it), and access and credential modules (an AAROH card is not an
 * access, attendance or authentication credential, DEC-2026-037).
 */
export const AAROH_SHOWCASE: readonly ShowcaseFeature[] = [
  {
    id: 'profile',
    name: 'Digital profile',
    benefit: 'Who you are, at your own link.',
    icon: 'profile',
    status: 'setup',
    useCase: 'You hand over your card at a meeting. Your name, role, company, a short bio and a photo open on their phone.',
    ownerControls: 'You write it, choose a photo and publish it from your SHYGON account, and you can change it later.',
    privacy: 'Only what you publish is shown. Pause your profile and nobody sees it.',
    configurable: true,
    action: { label: 'Set up your profile', to: '/shygontap/tap' },
  },
  {
    id: 'contact',
    name: 'Call and email',
    benefit: 'One tap to reach you.',
    icon: 'contact',
    status: 'setup',
    useCase: 'Someone you met at a conference calls or emails you straight from your profile, without typing a thing.',
    ownerControls: 'Show or hide your phone number and email at any time. Doing so never counts as an edit.',
    privacy: 'A detail you hide is not on the page at all.',
    configurable: true,
    action: { label: 'Choose what you show', to: '/shygontap/tap' },
  },
  {
    id: 'buttons',
    name: 'More ways to reach you',
    benefit: 'WhatsApp, Instagram, LinkedIn, Website and Location.',
    icon: 'buttons',
    status: 'addon',
    useCase: 'A designer adds Instagram and a website, so a new client sees the work before the first call.',
    ownerControls: 'Each button is bought once and appears only when you switch it on.',
    privacy: 'A button you have not switched on is never shown.',
    configurable: true,
    action: { label: 'See the add-ons', to: '/shygontap/customizations' },
    requires: 'Bought once, per button',
  },
  {
    id: 'look',
    name: 'Your look',
    benefit: 'Palettes, layouts, button styles, fonts and an opening animation.',
    icon: 'look',
    status: 'package',
    useCase: 'A consultant picks a calm palette and layout to match the card in their pocket.',
    ownerControls: 'Essential has the basics. Business, Premium and GOAT unlock more, and the Customization Pass unlocks every palette.',
    privacy: 'How your profile looks changes nothing about what it shares.',
    configurable: true,
    action: { label: 'Choose your look', to: '/shygontap/customize' },
    requires: 'Business, Premium or GOAT, or the Customization Pass',
  },
  {
    id: 'share',
    name: 'Link, QR code and sharing',
    benefit: 'For every phone, with or without NFC.',
    icon: 'share',
    status: 'available',
    useCase: 'A phone without NFC scans your profile’s QR code from your screen, or opens your link, and lands on the same profile.',
    ownerControls: 'Copy or share your link and QR code from your account.',
    privacy: 'The link opens the same public profile a tap does, and nothing more.',
    configurable: true,
    action: { label: 'Open your QR code', to: '/shygontap/qr' },
  },
  {
    id: 'analytics',
    name: 'Analytics',
    benefit: 'See what your card does for you.',
    icon: 'analytics',
    status: 'setup',
    useCase: 'After an event, see how many people opened your profile and which buttons they used.',
    ownerControls: 'Profile views, visitors, QR scans and your most-clicked buttons, over 7, 30 or 90 days.',
    privacy: 'Totals and trends. Visitors never sign in to see your profile.',
    configurable: false,
    action: { label: 'Open analytics', to: '/shygontap/analytics' },
  },
  {
    id: 'visibility',
    name: 'What visitors see',
    benefit: 'Publish, pause, and choose each detail.',
    icon: 'visibility',
    status: 'available',
    useCase: 'Between jobs, you pause your profile. When you are ready, you publish it again: the same card keeps working.',
    ownerControls: 'Publish or pause, and switch each detail and button on or off, from your SHYGON account.',
    privacy: 'A tap shows your published profile only. While it is paused, nobody sees it.',
    configurable: true,
    action: { label: 'Manage what visitors see', to: '/shygontap/tap' },
  },
  {
    id: 'card',
    name: 'Card activation and lost cards',
    benefit: 'Link your card, and switch a lost one off.',
    icon: 'card',
    status: 'card-release',
    useCase: 'Your card arrives and you link it to your account. If it is ever lost, you switch it off so it stops opening your profile.',
    ownerControls: 'Linking and switching cards off arrive with the card release, in your SHYGON account.',
    privacy: 'Until then, pausing your profile is how you stop it being seen.',
    configurable: false,
  },
  {
    id: 'return-to-owner',
    name: 'Return to Owner',
    benefit: 'Lost something with SHYGON? Let the finder contact you through a privacy-conscious relay, without automatically exposing your personal contact details.',
    icon: 'return',
    status: 'future',
    statusLabel: 'Coming soon',
    useCase: 'A candidate SHYGON OS module: someone who finds a lost card could reach you without seeing your details.',
    ownerControls: 'Not available today, and not included with a card. No release date.',
    privacy: 'Its privacy rules would be decided and published before any launch.',
    configurable: false,
  },
  {
    id: 'emergency',
    name: 'Emergency Profile',
    benefit: 'Keep the emergency information you choose ready when it matters. You control what is stored and what may be shared.',
    icon: 'emergency',
    status: 'future',
    statusLabel: 'Coming soon',
    useCase: 'A candidate SHYGON OS module for emergency details that you approve, shown only in an emergency flow.',
    ownerControls: 'Not available today, and not included with a card. No release date.',
    privacy: 'Highly sensitive: nothing like it is shown or stored today.',
    configurable: false,
  },
  {
    id: 'student-passport',
    name: 'Student Passport',
    benefit: 'Achievements, shared with care.',
    icon: 'student',
    status: 'future',
    useCase: 'A candidate SHYGON OS module for students to share selected achievements.',
    ownerControls: 'Not available today, and not included with a card. No release date.',
    privacy: 'It would need a student privacy review and verified schools first.',
    configurable: false,
  },
  {
    id: 'event',
    name: 'Event mode',
    benefit: 'A profile for one event.',
    icon: 'event',
    status: 'future',
    useCase: 'A candidate SHYGON OS module for event-specific details. Ticketing and check-in are not part of AAROH.',
    ownerControls: 'Not available today, and not included with a card. No release date.',
    privacy: 'Its privacy rules would be decided and published before any launch.',
    configurable: false,
  },
  {
    id: 'places',
    name: 'Information for places and objects',
    benefit: 'Details attached to a place or a thing.',
    icon: 'place',
    status: 'future',
    useCase: 'A candidate SHYGON OS module for information attached to a card placed somewhere.',
    ownerControls: 'Not available today, and not included with a card. No release date.',
    privacy: 'Its privacy rules would be decided and published before any launch.',
    configurable: false,
  },
  {
    id: 'cloud',
    name: 'Cloud storage',
    benefit: 'Private files, shared by choice.',
    icon: 'cloud',
    status: 'future',
    useCase: 'A candidate SHYGON OS module for private contacts and files.',
    ownerControls: 'Not available today, and not included with a card. No release date.',
    privacy: 'Nothing is uploaded or stored today.',
    configurable: false,
  },
]

/** The features shown around the card in the welcome ("one card, many experiences"): what works today. */
export const AAROH_CONSTELLATION = AAROH_SHOWCASE.filter((feature) => feature.status !== 'future' && feature.status !== 'card-release').slice(0, 6)

/** From the store to everyday use. The edition is chosen here; the rest happens in the SHYGON account. */
export const OWNER_STEPS: readonly { title: string; body: string; status: FeatureStatus }[] = [
  { title: 'Choose your edition', body: 'The physical design and finish of the card in your hand, chosen here.', status: 'card-release' },
  { title: 'Activate your card', body: 'Link the card to your SHYGON account when it arrives.', status: 'card-release' },
  { title: 'Set up your profile', body: 'Your details, photo and buttons, published from your account.', status: 'setup' },
  {
    title: 'Choose your experience',
    body: 'Essential comes with a card. Business, Premium and GOAT are bought once, in your account.',
    status: 'package',
  },
  { title: 'Control what others see', body: 'Switch each detail on or off, or pause your profile, whenever you like.', status: 'available' },
]

/** “One tap does not mean unlimited access.” Each line is true of the code today. */
export const PRIVACY_POINTS: readonly string[] = [
  'A tap opens your published profile, and only that: the details and buttons you have switched on.',
  'Your phone number and email can be hidden, and add-on buttons appear only when you turn them on.',
  'Pause your profile and nobody sees it, until you publish it again.',
  'A tap never signs anyone in. Changing your profile needs your own signed-in SHYGON account.',
]
