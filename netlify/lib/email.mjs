/**
 * Customer email: sending, the templates, and the worker that drains
 * public.email_outbox (migration 021).
 *
 * The database decides WHAT to send — a trigger queues a row whenever an order
 * is paid, shipped, delivered, cancelled or refunded, or a card is activated,
 * deactivated, reported lost or replaced. This module decides only HOW: it
 * claims due rows, reads the order or card they are about, renders the email
 * and hands it to the configured provider.
 *
 * Providers (set in Netlify / Vercel environment variables, never VITE_):
 *   EMAIL_PROVIDER=resend   RESEND_API_KEY, EMAIL_FROM (a verified sender)
 *   EMAIL_PROVIDER=smtp     SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 *                           Gmail: smtp.gmail.com, 465, the Gmail address and
 *                           an App Password (Google Account > Security).
 * EMAIL_PROVIDER may be left out: RESEND_API_KEY or SMTP_HOST picks it.
 * Optional: EMAIL_FROM, EMAIL_REPLY_TO (default contact@shygontech.com).
 *
 * With no provider configured nothing is lost: rows stay queued and go out once
 * one is set (anything older than three days is then skipped, not sent late).
 *
 * Talks to Supabase over plain HTTP with the service-role key, like card-otp,
 * so every function can use it without the Supabase SDK.
 */

const SITE = (process.env.SITE_URL || process.env.VITE_SITE_URL || 'https://shygontech.com')
  .trim()
  .replace(/\/+$/, '');
const SITE_OK = /^https:\/\//.test(SITE) ? SITE : 'https://shygontech.com';
const DOMAIN = SITE_OK.replace(/^https?:\/\//, '');
const COMPANY = 'SHYGON Technologies Pvt. Ltd.';
const CONTACT = `contact@${DOMAIN}`;
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
/** Seconds to wait after the 1st, 2nd… failed attempt. */
const BACKOFF = [60, 300, 900, 3600, 21600];

function env(name) {
  const value = process.env[name];
  return value && String(value).trim() ? String(value).trim() : null;
}

// ------------------------------------------------------------------ provider

export function emailProvider() {
  const explicit = (env('EMAIL_PROVIDER') ?? '').toLowerCase();
  if (explicit === 'resend') return env('RESEND_API_KEY') ? 'resend' : null;
  if (explicit === 'smtp') return env('SMTP_HOST') && env('SMTP_USER') && env('SMTP_PASS') ? 'smtp' : null;
  if (explicit) return null;
  if (env('RESEND_API_KEY')) return 'resend';
  if (env('SMTP_HOST') && env('SMTP_USER') && env('SMTP_PASS')) return 'smtp';
  return null;
}

function fromAddress(provider) {
  const configured = env('EMAIL_FROM');
  if (configured) return configured;
  // Gmail rewrites any other From to the signed-in account anyway.
  if (provider === 'smtp') return `SHYGON Tap <${env('SMTP_USER')}>`;
  return `SHYGON Tap <orders@${DOMAIN}>`;
}

let smtpTransport = null;

/** Sends one email. Throws on failure; returns the provider's message id. */
export async function sendEmail({ to, subject, html, text }) {
  const provider = emailProvider();
  if (!provider) throw Object.assign(new Error('Email is not configured.'), { status: 503 });
  const replyTo = env('EMAIL_REPLY_TO') ?? CONTACT;

  if (provider === 'resend') {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env('RESEND_API_KEY')}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: fromAddress(provider), to: [to], subject, html, text, reply_to: replyTo }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Resend ${response.status}: ${result?.message ?? 'send failed'}`);
    }
    return result?.id ?? null;
  }

  if (!smtpTransport) {
    const { default: nodemailer } = await import('nodemailer');
    const port = Number(env('SMTP_PORT') ?? 465);
    smtpTransport = nodemailer.createTransport({
      host: env('SMTP_HOST'),
      port,
      secure: env('SMTP_SECURE') ? env('SMTP_SECURE') === 'true' : port === 465,
      auth: { user: env('SMTP_USER'), pass: env('SMTP_PASS') },
    });
  }
  const info = await smtpTransport.sendMail({ from: fromAddress(provider), to, replyTo, subject, html, text });
  return info?.messageId ?? null;
}

// ------------------------------------------------------------------ database

function supabaseConfig() {
  const url = env('SUPABASE_URL') ?? env('VITE_SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ''), key };
}

async function rest(cfg, path, { method = 'GET', body } = {}) {
  const response = await fetch(`${cfg.url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: cfg.key,
      authorization: `Bearer ${cfg.key}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const textBody = await response.text();
  const data = textBody ? JSON.parse(textBody) : null;
  if (!response.ok) {
    throw new Error(data?.message ?? `Database request failed (${response.status})`);
  }
  return data;
}

const complete = (cfg, id, outcome, extra = {}) =>
  rest(cfg, 'rpc/email_outbox_complete', {
    method: 'POST',
    body: {
      p_id: id,
      p_outcome: outcome,
      p_error: extra.error ?? null,
      p_to: extra.to ?? null,
      p_message_id: extra.messageId ?? null,
      p_retry_seconds: extra.retrySeconds ?? 300,
    },
  });

/**
 * Sends whatever is due, within a time budget, and reports what happened.
 * Never throws: callers run it after a payment or card change, and an email
 * problem must never turn that into an error for the customer.
 */
export async function drainEmailOutbox({ limit = 10, budgetMs = 8000 } = {}) {
  const summary = { configured: Boolean(emailProvider()), sent: 0, failed: 0, postponed: 0, skipped: 0 };
  const cfg = supabaseConfig();
  if (!summary.configured || !cfg) return summary;

  const started = Date.now();
  let rows = [];
  try {
    rows = (await rest(cfg, 'rpc/email_outbox_claim', { method: 'POST', body: { p_limit: limit } })) ?? [];
  } catch (error) {
    console.error('[email] claim failed', error.message);
    return summary;
  }

  for (const row of rows) {
    if (Date.now() - started > budgetMs) {
      await complete(cfg, row.id, 'postpone', { retrySeconds: 10 }).catch(() => undefined);
      summary.postponed++;
      continue;
    }
    try {
      if (Date.now() - Date.parse(row.created_at) > MAX_AGE_MS) {
        await complete(cfg, row.id, 'skip', { error: 'Too old to send' });
        summary.skipped++;
        continue;
      }
      const message = await render(cfg, row);
      if (message.skip) {
        await complete(cfg, row.id, 'skip', { error: message.skip });
        summary.skipped++;
        continue;
      }
      if (message.postpone) {
        await complete(cfg, row.id, 'postpone', { retrySeconds: message.postpone });
        summary.postponed++;
        continue;
      }
      const messageId = await sendEmail(message);
      await complete(cfg, row.id, 'sent', { to: message.to, messageId });
      summary.sent++;
    } catch (error) {
      console.error('[email] send failed', row.template, row.id, error.message);
      const wait = BACKOFF[Math.min(BACKOFF.length - 1, Math.max(0, (row.attempts ?? 1) - 1))];
      await complete(cfg, row.id, 'retry', { error: error.message, retrySeconds: wait }).catch(() => undefined);
      summary.failed++;
    }
  }
  return summary;
}

// ------------------------------------------------------------------ rendering

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const rupees = (paise) => {
  const value = Number(paise ?? 0) / 100;
  return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
};

const when = (iso) =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
  });

const formatCode = (code) => (code && code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code ?? '');

const MATERIAL = { pvc: 'PVC', metal: 'Metal', transparent: 'Transparent' };
function cardLabel(card) {
  const m = /^card-(.+)-(standard|premium)-(pvc|metal|transparent)$/.exec(card?.sku ?? '');
  const design = m ? m[1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'SHYGON Tap';
  const name = card?.nickname ? `“${card.nickname}”` : `${design}${m ? ` · ${MATERIAL[m[3]]}` : ''}`;
  return `${name} (Card ID ${formatCode(card?.card_code)})`;
}

/** The frame every email shares: brand bar, body, footer. */
function layout({ preheader, title, body }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f2ee;font-family:Inter,Segoe UI,Arial,sans-serif;color:#1c1a17;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e7e2d9;">
<tr><td style="background:#0b0b0c;padding:20px 28px;">
<span style="font-size:15px;font-weight:800;letter-spacing:.18em;color:#ffffff;">SHYGON <span style="color:#d4ab66;">TAP</span></span>
</td></tr>
<tr><td style="padding:28px 28px 8px;">
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#111;">${esc(title)}</h1>
${body}
</td></tr>
<tr><td style="padding:18px 28px 26px;border-top:1px solid #efebe4;font-size:12px;line-height:1.6;color:#7a7268;">
${esc(COMPANY)} · <a href="${SITE_OK}/shygontap" style="color:#7a7268;">${esc(DOMAIN)}</a> · <a href="mailto:${CONTACT}" style="color:#7a7268;">${esc(CONTACT)}</a><br>
You are receiving this because of activity on your SHYGON Tap account. Order-update emails can be turned off in Settings; receipts and card security emails are always sent.
</td></tr>
</table></td></tr></table></body></html>`;
}

const p = (html) => `<p style="margin:0 0 14px;font-size:14.5px;line-height:1.65;color:#3a352f;">${html}</p>`;
const button = (href, label) =>
  `<p style="margin:6px 0 20px;"><a href="${href}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:999px;">${esc(label)}</a></p>`;

function billTable(order, items) {
  const lines = (items.length ? items : [{ name: order.product_name ?? 'SHYGON Tap', quantity: 1, line_total_in_paise: order.amount_in_paise }])
    .map((item) => {
      const qty = item.quantity ?? 1;
      return `<tr><td style="padding:9px 0;border-bottom:1px solid #efebe4;font-size:13.5px;">${esc(item.name ?? item.sku)}${qty > 1 ? ` × ${qty}` : ''}</td><td style="padding:9px 0;border-bottom:1px solid #efebe4;font-size:13.5px;text-align:right;white-space:nowrap;">${rupees(item.line_total_in_paise)}</td></tr>`;
    })
    .join('');
  const discount = Number(order.discount_in_paise ?? 0);
  const subtotal = order.subtotal_in_paise;
  const extra = [
    typeof subtotal === 'number' && (discount > 0 || Number(order.delivery_fee_in_paise ?? 0) > 0)
      ? ['Cart value', rupees(subtotal)]
      : null,
    discount > 0 ? [`Promo ${esc(order.promo_code ?? '')}`, `−${rupees(discount)}`] : null,
    ...taxLines(order),
  ]
    .filter(Boolean)
    .map(([label, value]) => `<tr><td style="padding:7px 0;font-size:13px;color:#6d655b;">${label}</td><td style="padding:7px 0;font-size:13px;color:#6d655b;text-align:right;">${value}</td></tr>`)
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;">${lines}${extra}
<tr><td style="padding:12px 0 0;font-size:14px;font-weight:800;">Total paid</td><td style="padding:12px 0 0;font-size:16px;font-weight:800;text-align:right;">${rupees(order.amount_in_paise)}</td></tr></table>`;
}

/** GST recorded on the order at purchase time (migration 023). */
function taxLines(order) {
  const tax = Number(order.tax_in_paise ?? 0);
  if (tax <= 0) return [];
  const rate = Number(order.tax_rate_percent ?? 0);
  const note = order.tax_inclusive ? ' (included)' : '';
  if (order.tax_split === 'cgst_sgst') {
    const half = Math.floor(tax / 2);
    return [
      [`CGST ${rate / 2}%${note}`, rupees(half)],
      [`SGST ${rate / 2}%${note}`, rupees(tax - half)],
    ];
  }
  return [[`IGST ${rate}%${note}`, rupees(tax)]];
}

function ebill(order, items, profile, cards) {
  const shipTo = [order.shipping_address, order.shipping_address_line2, order.shipping_locality, order.shipping_city, order.shipping_state, order.shipping_pincode].filter(Boolean).join(', ');
  const billTo = order.billing_address
    ? [order.billing_address, order.billing_address_line2, order.billing_locality, order.billing_city, order.billing_state, order.billing_pincode].filter(Boolean).join(', ')
    : '';
  const edition = (sku) => {
    const card = cards.find((c) => c.sku === sku && c.edition_serial);
    if (!card) return '';
    const size = card.edition_chapter_size || 100;
    const chapter = Math.floor((card.edition_serial - 1) / size) + 1;
    const number = ((card.edition_serial - 1) % size) + 1;
    return ` — Limited edition, Chapter ${chapter} · Nº ${String(number).padStart(3, '0')} of ${size}`;
  };
  const withEditions = items.map((item) => ({ ...item, name: `${item.name ?? item.sku}${edition(item.sku)}` }));
  return `<div style="border:1px solid #e7e2d9;border-radius:14px;padding:18px 18px 4px;margin:4px 0 20px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-size:12px;letter-spacing:.14em;font-weight:800;color:#8a6d35;">E-BILL · PAYMENT RECEIPT</td>
<td style="font-size:12px;color:#6d655b;text-align:right;">${esc(when(order.created_at))}</td></tr></table>
<p style="margin:10px 0 2px;font-size:13px;color:#6d655b;">Receipt no. <strong style="color:#111;">${esc(order.order_id)}</strong> · Status <strong style="color:#1d7a46;">Paid</strong></p>
<p style="margin:0 0 12px;font-size:13px;color:#6d655b;">Billed to ${esc(order.billing_name || order.shipping_name || profile.full_name || 'Customer')}${order.billing_company ? ` · ${esc(order.billing_company)}` : ''} · ${esc(order.billing_email || profile.email)}${billTo && order.billing_same_as_shipping === false ? `<br>${esc(billTo)}` : ''}${order.customer_gstin ? `<br>GSTIN ${esc(order.customer_gstin)}` : ''}${shipTo ? `<br>Ship to ${esc(shipTo)}` : ''}</p>
${billTable(order, withEditions)}
<p style="margin:0 0 14px;font-size:12px;color:#7a7268;">Paid online via Razorpay · Payment reference ${esc(order.razorpay_payment_id ?? '—')}<br>Issued by ${esc(COMPANY)}</p>
</div>`;
}

async function loadProfile(cfg, userId) {
  const [profile] = (await rest(cfg, `profiles?id=eq.${userId}&select=full_name,email`)) ?? [];
  let email = profile?.email ?? null;
  if (!email) {
    const response = await fetch(`${cfg.url}/auth/v1/admin/users/${userId}`, {
      headers: { apikey: cfg.key, authorization: `Bearer ${cfg.key}` },
    });
    if (response.ok) email = (await response.json())?.email ?? null;
  }
  return { full_name: profile?.full_name ?? null, email };
}

const ORDER_FIELDS =
  'id,order_id,user_id,order_type,product_name,amount_in_paise,subtotal_in_paise,discount_in_paise,' +
  'delivery_fee_in_paise,promo_code,payment_status,order_status,fulfillment_status,razorpay_payment_id,' +
  'shipping_name,shipping_address,shipping_city,shipping_state,shipping_pincode,tracking_number,' +
  'shipping_carrier,cancellation_reason,refund_amount_in_paise,created_at';
const ORDER_TAX_FIELDS =
  ',tax_in_paise,tax_rate_percent,tax_inclusive,tax_split,customer_gstin,billing_same_as_shipping,billing_name,' +
  'billing_company,billing_email,billing_address,billing_address_line2,billing_locality,billing_city,billing_state,' +
  'billing_pincode,shipping_address_line2,shipping_locality';

/** Reads an order with its GST fields, or without them before migration 023. */
async function loadOrder(cfg, id) {
  try {
    const [order] = (await rest(cfg, `orders?id=eq.${id}&select=${ORDER_FIELDS}${ORDER_TAX_FIELDS}`)) ?? [];
    return order ?? null;
  } catch {
    const [order] = (await rest(cfg, `orders?id=eq.${id}&select=${ORDER_FIELDS}`)) ?? [];
    return order ?? null;
  }
}

async function render(cfg, row) {
  const profile = await loadProfile(cfg, row.user_id);
  if (!profile.email) return { skip: 'No email address on the account' };
  const first = (profile.full_name ?? '').split(' ')[0] || 'there';
  const hello = p(`Hi ${esc(first)},`);

  if (row.template.startsWith('order_') || row.template === 'payment_failed') {
    const order = await loadOrder(cfg, row.subject_id);
    if (!order) return { skip: 'Order not found' };
    const ordersLink = `${SITE_OK}/shygontap/orders`;
    const physical = !order.order_type || order.order_type === 'physical';

    // Razorpay lets a customer retry inside the same checkout, so a failure is
    // often followed by a success seconds later. Hold the email for ten
    // minutes and drop it if the order was paid in the meantime.
    if (row.template === 'payment_failed') {
      if (order.payment_status === 'paid') return { skip: 'Paid after the failure' };
      const waited = Date.now() - Date.parse(row.created_at);
      if (waited < 10 * 60 * 1000) return { postpone: Math.ceil((10 * 60 * 1000 - waited) / 1000) };
    }

    if (row.template === 'order_confirmed') {
      // The e-bill lists the card and the page it created, so wait (briefly)
      // for fulfilment to finish issuing them.
      if (order.fulfillment_status && order.fulfillment_status !== 'fulfilled'
          && Date.now() - Date.parse(order.created_at) < 20 * 60 * 1000) {
        return { postpone: 30 };
      }
      const items = (await rest(cfg, `order_items?order_id=eq.${order.id}&select=name,sku,product_type,quantity,unit_price_in_paise,line_total_in_paise&order=created_at`)) ?? [];
      const cards = (await rest(cfg, `cards?order_id=eq.${order.id}&select=card_code,sku,nickname,tap_profile_id,edition_serial,edition_chapter_size`)) ?? [];
      const tapIds = [...new Set(cards.map((c) => c.tap_profile_id).filter(Boolean))];
      const pages = tapIds.length
        ? (await rest(cfg, `tap_profiles?id=in.(${tapIds.join(',')})&select=id,slug,status`)) ?? []
        : [];
      const pageList = cards
        .map((card) => {
          const page = pages.find((pg) => pg.id === card.tap_profile_id);
          if (!page?.slug) return null;
          return `<li style="margin:0 0 6px;"><a href="${SITE_OK}/shygontap/${esc(page.slug)}" style="color:#111;font-weight:700;">${esc(DOMAIN)}/shygontap/${esc(page.slug)}</a> — ${esc(cardLabel(card))}</li>`;
        })
        .filter(Boolean)
        .join('');
      const custom = items.some((item) => /^card-custom-/.test(item.sku ?? ''));
      const body = [
        hello,
        p(`Thank you — your payment was received and order <strong>${esc(order.order_id)}</strong> is confirmed. Your e-bill is below.`),
        ebill(order, items, profile, cards),
        pageList
          ? p('Your Tap page is live. It updates the moment you edit it in your account:') +
            `<ul style="margin:0 0 16px;padding-left:18px;font-size:14px;line-height:1.6;">${pageList}</ul>`
          : '',
        custom
          ? p('<strong>Custom card:</strong> reply to this email with your artwork (PNG, PDF or SVG, at least 1011 × 638 px). We will send a proof before printing.')
          : '',
        physical ? p('We will email you when it ships, when it is out for delivery and when it arrives.') : '',
        button(ordersLink, physical ? 'Track your order' : 'View your order'),
      ].join('');
      return {
        to: profile.email,
        subject: `Order confirmed — ${order.order_id} · your SHYGON Tap e-bill`,
        html: layout({ preheader: `Payment received. E-bill for ${order.order_id}.`, title: 'Your order is confirmed', body }),
        text: `Hi ${first},\n\nPayment received — order ${order.order_id} is confirmed.\nTotal paid: ${rupees(order.amount_in_paise)}\n${items.map((i) => `- ${i.name}: ${rupees(i.line_total_in_paise)}`).join('\n')}${order.discount_in_paise ? `\nPromo ${order.promo_code}: -${rupees(order.discount_in_paise)}` : ''}\nPayment reference: ${order.razorpay_payment_id ?? '-'}\n\n${pages.map((pg) => `Your page: ${SITE_OK}/shygontap/${pg.slug}`).join('\n')}\n\nTrack your order: ${ordersLink}\n\n${COMPANY}`,
      };
    }

    const simple = {
      payment_failed: {
        subject: `Payment not completed — ${order.order_id}`,
        title: 'Your payment did not go through',
        lines: [
          'The payment for this order failed, so you have <strong>not been charged</strong>.',
          'Your selection is saved in your account — you can try again with another method whenever you like.',
        ],
        cta: ['Return to your account', `${SITE_OK}/shygontap/account`],
      },
      order_shipped: {
        subject: `Your SHYGON Tap has shipped — ${order.order_id}`,
        title: 'Your order has shipped',
        lines: [
          `Order <strong>${esc(order.order_id)}</strong> is on its way.`,
          order.tracking_number
            ? `${order.shipping_carrier ? `Carrier: <strong>${esc(order.shipping_carrier)}</strong> · ` : ''}Tracking number: <strong>${esc(order.tracking_number)}</strong>`
            : 'We will share tracking details as soon as the courier provides them.',
        ],
        cta: ['Track your order', ordersLink],
      },
      order_out_for_delivery: {
        subject: `Out for delivery — ${order.order_id}`,
        title: 'Arriving today',
        lines: [`Order <strong>${esc(order.order_id)}</strong> is out for delivery. Please keep your phone nearby for the courier.`],
        cta: ['Track your order', ordersLink],
      },
      order_delivered: {
        subject: `Delivered — ${order.order_id}`,
        title: 'Your SHYGON Tap has arrived',
        lines: [
          `Order <strong>${esc(order.order_id)}</strong> has been delivered.`,
          'Next: activate your card in <strong>My cards</strong> — it takes a one-time code — and it will open your page the moment someone taps it.',
        ],
        cta: ['Activate your card', `${SITE_OK}/shygontap/cards`],
      },
      order_cancelled: {
        subject: `Order cancelled — ${order.order_id}`,
        title: 'Your order was cancelled',
        lines: [
          `Order <strong>${esc(order.order_id)}</strong> has been cancelled.`,
          order.cancellation_reason ? `Reason: ${esc(order.cancellation_reason)}` : '',
          order.payment_status === 'paid'
            ? 'Your payment has not been refunded yet. We will email you when the refund is processed; reply to this email if you have questions.'
            : '',
        ].filter(Boolean),
        cta: ['View your orders', ordersLink],
      },
      order_refunded: {
        subject: `Refund processed — ${order.order_id}`,
        title: 'Your refund is on its way',
        lines: [
          `We have refunded <strong>${rupees(order.refund_amount_in_paise ?? order.amount_in_paise)}</strong> for order <strong>${esc(order.order_id)}</strong>.`,
          'It goes back to the payment method you used. Banks usually take 5–7 business days to show it.',
        ],
        cta: ['View your orders', ordersLink],
      },
    }[row.template];

    if (!simple) return { skip: `Unknown template ${row.template}` };
    return {
      to: profile.email,
      subject: simple.subject,
      html: layout({
        preheader: simple.title,
        title: simple.title,
        body: hello + simple.lines.map(p).join('') + button(simple.cta[1], simple.cta[0]),
      }),
      text: `Hi ${first},\n\n${simple.lines.map((line) => line.replace(/<[^>]+>/g, '')).join('\n\n')}\n\n${simple.cta[0]}: ${simple.cta[1]}\n\n${COMPANY}`,
    };
  }

  if (row.template.startsWith('card_')) {
    const [card] = (await rest(cfg, `cards?id=eq.${row.subject_id}&select=card_code,nickname,sku,tap_profile_id,status,activation_expires_at,lost_at`)) ?? [];
    if (!card) return { skip: 'Card not found' };
    const cardsLink = `${SITE_OK}/shygontap/cards`;
    const label = esc(cardLabel(card));
    const until = card.activation_expires_at ? ` It stays active until ${esc(when(card.activation_expires_at))}; renew it any time.` : '';
    const content = {
      card_activated: {
        subject: `Card activated — ${formatCode(card.card_code)}`,
        title: 'Your card is active',
        lines: [`Your ${label} is active and opens your page when tapped.${until}`, 'If you did not do this, deactivate the card from your account straight away.'],
      },
      card_deactivated: {
        subject: `Card deactivated — ${formatCode(card.card_code)}`,
        title: row.payload?.expired ? 'Your card activation expired' : 'Your card is deactivated',
        lines: [
          row.payload?.expired
            ? `Your ${label} was switched off because its activation period ended. Renew the activation to switch it back on.`
            : `Your ${label} is deactivated. Tapping it no longer opens your page.`,
          'You can activate it again from your account at any time.',
        ],
      },
      card_lost: {
        subject: `Card reported lost — ${formatCode(card.card_code)}`,
        title: 'Card reported lost',
        lines: [
          `Your ${label} has been switched off. Anyone who finds it cannot use it to open your page.`,
          'Order a replacement from My cards: the new card opens the same page, with the same address and analytics.',
        ],
      },
      card_replaced: {
        subject: `Card replaced — ${formatCode(card.card_code)}`,
        title: 'Your old card has been replaced',
        lines: [`Your ${label} is permanently switched off. Its replacement opens the same page.`],
      },
    }[row.template];
    if (!content) return { skip: `Unknown template ${row.template}` };
    return {
      to: profile.email,
      subject: content.subject,
      html: layout({
        preheader: content.title,
        title: content.title,
        body: hello + content.lines.map(p).join('') + button(cardsLink, 'Manage your cards'),
      }),
      text: `Hi ${first},\n\n${content.lines.map((line) => line.replace(/<[^>]+>/g, '')).join('\n\n')}\n\nManage your cards: ${cardsLink}\n\n${COMPANY}`,
    };
  }

  if (row.template === 'support_ticket_created' || row.template === 'support_reply') {
    const [ticket] = (await rest(cfg, `support_tickets?id=eq.${row.subject_id}&select=id,reference,subject,status`)) ?? [];
    if (!ticket) return { skip: 'Ticket not found' };
    const supportLink = `${SITE_OK}/shygontap/support`;
    let reply = '';
    if (row.template === 'support_reply' && row.payload?.message_id) {
      const [message] = (await rest(cfg, `support_messages?id=eq.${row.payload.message_id}&select=body`)) ?? [];
      reply = message?.body ?? '';
    }
    const created = row.template === 'support_ticket_created';
    const title = created ? 'We have your request' : 'SHYGON support replied';
    const lines = created
      ? [`Your request <strong>${esc(ticket.subject)}</strong> is logged as ${esc(ticket.reference)}. We usually reply within one working day.`]
      : [`New reply on ${esc(ticket.reference)} — ${esc(ticket.subject)}:`, esc(reply).replace(/\n/g, '<br>')];
    return {
      to: profile.email,
      subject: created ? `Request received — ${ticket.reference}` : `Reply on ${ticket.reference}`,
      html: layout({ preheader: title, title, body: hello + lines.map(p).join('') + button(supportLink, 'Open support') }),
      text: `Hi ${first},\n\n${lines.map((line) => line.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/g, ' ')).join('\n\n')}\n\nOpen support: ${supportLink}\n\n${COMPANY}`,
    };
  }

  return { skip: `Unknown template ${row.template}` };
}

/** A one-time code by email: the fallback when SMS is not set up. */
export async function sendOtpEmail({ to, code, action }) {
  const verb = action === 'activate' ? 'activate' : 'deactivate';
  const body =
    p(`Your code to ${verb} your SHYGON Tap card is:`) +
    `<p style="margin:0 0 18px;font-size:30px;font-weight:800;letter-spacing:.3em;color:#111;">${esc(code)}</p>` +
    p('It expires in 10 minutes. Never share it with anyone — SHYGON will never ask you for it.') +
    p('If you did not ask for this code, you can ignore this email; nothing changes without it.');
  return sendEmail({
    to,
    subject: `${code} is your SHYGON Tap card code`,
    html: layout({ preheader: `Your code to ${verb} your card`, title: `Confirm: ${verb} your card`, body }),
    text: `${code} is your SHYGON Tap code to ${verb} your card. It expires in 10 minutes. Do not share it with anyone.`,
  });
}
