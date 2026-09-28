import { COMPANY_NAME, CONTACT_EMAIL, SITE_DOMAIN } from '../lib/site';
import { WHATSAPP_NUMBER } from './shygonTapData';

/**
 * Business details and policy settings behind the legal pages.
 *
 * One place, so the Privacy Policy, Terms, Refund, Shipping and Cookie
 * pages, the footer and checkout can never disagree with each other.
 *
 * Only facts the business already publishes are filled in. A field left
 * `undefined` is simply not shown — nothing is invented. Before launch, fill
 * in the ones marked REQUIRED: Indian law expects them on a store's website
 * (Consumer Protection (E-Commerce) Rules, 2020, rule 4; IT Act rules on a
 * grievance officer; DPDP Act, 2023).
 */

export interface GrievanceOfficer {
  /** REQUIRED: a named person (E-Commerce Rules 2020, r. 4(4)). */
  name?: string;
  designation?: string;
  email: string;
  phone?: string;
}

export const LEGAL = {
  /** Date shown on every policy page. Change it whenever a policy changes. */
  lastUpdated: '27 September 2026',

  brand: 'SHYGON Tap',
  legalName: COMPANY_NAME,
  website: SITE_DOMAIN,
  email: CONTACT_EMAIL,
  phone: `+${WHATSAPP_NUMBER.slice(0, 2)} ${WHATSAPP_NUMBER.slice(2, 7)} ${WHATSAPP_NUMBER.slice(7)}`,
  whatsappUrl: `https://wa.me/${WHATSAPP_NUMBER}`,
  city: 'Bengaluru',
  state: 'Karnataka',
  country: 'India',

  /** REQUIRED: registered office address as on the certificate of incorporation. */
  registeredAddress: undefined as string | undefined,
  /** Corporate Identity Number, if you want it shown. */
  cin: undefined as string | undefined,
  /** GSTIN, if registered. Printed on invoices either way. */
  gstin: undefined as string | undefined,

  grievanceOfficer: {
    name: undefined,
    designation: 'Grievance Officer',
    email: CONTACT_EMAIL,
    phone: undefined,
  } as GrievanceOfficer,

  /** Courts named in the Terms. */
  jurisdiction: 'Bengaluru, Karnataka',

  /**
   * Refund and cancellation settings. These are the business's promises —
   * confirm each one before launch.
   */
  refunds: {
    /** Days after delivery to report a damaged, defective or wrong card. */
    reportDefectDays: 7,
    /** Business days to start an approved refund. */
    initiateRefundBusinessDays: 3,
    /** What banks usually take after that (Razorpay's published range). */
    bankCreditBusinessDays: '5–7',
  },

  /** Matches the estimate checkout shows when no courier quote is available (check-delivery). */
  shipping: {
    estimateBusinessDays: '4–7',
  },
} as const;

/** Postal-style one-line location for footers and contact blocks. */
export const LEGAL_LOCATION = `${LEGAL.city}, ${LEGAL.state}, ${LEGAL.country}`;

// ----------------------------------------------------------- data inventory ---

/**
 * What personal data the product collects, why, and who else sees it. Written
 * from the database schema and the server functions — keep it in step with
 * both. Rendered on the Privacy Policy ("What data we collect").
 */
export interface DataCategory {
  what: string;
  examples: string;
  why: string;
  sharedWith: string;
}

export const DATA_WE_COLLECT: DataCategory[] = [
  {
    what: 'Account',
    examples: 'Name, email address, password (stored only as a one-way hash), sign-in times.',
    why: 'To create your account, sign you in and keep it secure.',
    sharedWith: 'Supabase (database and sign-in provider).',
  },
  {
    what: 'Profile and contact details',
    examples:
      'Phone, WhatsApp number, company, job title, location, bio, website, social links, profile photo, notification preferences.',
    why: 'To build your digital profile and contact you about your orders.',
    sharedWith: 'Supabase (database and file storage).',
  },
  {
    what: 'Your public Tap',
    examples:
      'Whatever you choose to publish on your Tap: name, headline, photo, contact details, links and theme.',
    why: 'To show your profile to people who tap your card or scan your QR code. Anyone with the link can see what you publish.',
    sharedWith: 'Public, by your choice. You control each field and can unpublish at any time.',
  },
  {
    what: 'Orders and delivery',
    examples: 'Items, prices, recipient name, phone, delivery address, city, state, PIN code, order and tracking status.',
    why: 'To make, ship and support your order, and to keep the records tax law requires.',
    sharedWith: 'Courier and logistics partners (name, phone and address, to deliver); Shiprocket when used to find a courier.',
  },
  {
    what: 'Payments',
    examples:
      'Payment status, amount, and Razorpay order and payment references. We never see or store your card number, UPI PIN or bank password.',
    why: 'To take payment, confirm it and handle refunds.',
    sharedWith: 'Razorpay (payment processor), which handles your payment details under its own policy.',
  },
  {
    what: 'NFC cards',
    examples:
      'Card identifiers, activation codes and activation status. When you activate or deactivate a card: a one-time code (kept only as a one-way hash, for 10 minutes), the last 4 digits of the number it was sent to, and the time.',
    why: 'To link your physical card to your Tap, and to confirm that a change to your card really comes from you.',
    sharedWith: 'Supabase; our SMS provider receives your mobile number and the code, only to deliver it.',
  },
  {
    what: 'Support',
    examples: 'Tickets and messages you send us, and our replies.',
    why: 'To answer you and resolve problems.',
    sharedWith: 'Supabase. If you message us on WhatsApp, WhatsApp (Meta) also processes it.',
  },
  {
    what: 'Tap visit statistics',
    examples:
      'When your Tap is opened: the type of visit (tap, QR, link), which link was clicked, the time, the referring website’s domain, and a one-way daily visitor code made from the visitor’s browser and IP address (the IP address itself is not stored).',
    why: 'To show you how your Tap is used, without identifying visitors.',
    sharedWith: 'Supabase.',
  },
  {
    what: 'Device storage (no cookies)',
    examples:
      'Your sign-in session, your cart and last card configuration, and your privacy-notice choice, kept in your browser’s local storage.',
    why: 'To keep you signed in and remember your cart. See the Cookie Policy.',
    sharedWith: 'Nobody. It stays in your browser.',
  },
  {
    what: 'Technical logs',
    examples: 'IP address, browser type and request times in our hosting providers’ standard server logs.',
    why: 'To keep the service secure and working, and to investigate abuse.',
    sharedWith: 'Netlify (website hosting) and Supabase.',
  },
];

/** Service providers that process personal data for us. */
export const PROCESSORS: Array<{ name: string; role: string; where: string }> = [
  { name: 'Supabase', role: 'Database, sign-in, file storage and live updates', where: 'Mumbai, India (AWS ap-south-1)' },
  { name: 'Netlify', role: 'Website hosting and server functions', where: 'Global content delivery network' },
  { name: 'Razorpay', role: 'Payments and refunds', where: 'India' },
  { name: 'SMS provider (MSG91 or Twilio)', role: 'Sending one-time codes to your registered mobile number', where: 'India / global' },
  { name: 'Couriers / Shiprocket', role: 'Delivery of physical cards', where: 'India' },
  { name: 'India Post PIN lookups (postalpincode.in, pincodeapi.in)', role: 'Checking a PIN code at checkout (the PIN code only)', where: 'India' },
];
