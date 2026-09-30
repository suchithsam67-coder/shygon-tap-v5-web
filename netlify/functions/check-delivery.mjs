/**
 * POST /api/check-delivery  { pincode }
 *
 * Verifies an Indian PIN code and answers with a delivery estimate.
 *
 * The honesty rule this function exists to keep: a pincode-specific delivery
 * date is something only a courier can tell you. When Shiprocket credentials
 * are configured the response carries that courier's real serviceability and
 * ETA (`delivery.source === 'shiprocket'`). When they are not, the response
 * carries `fallbackDelivery` instead — a stated business-day range the UI
 * labels as an estimate. It never dresses one up as the other.
 *
 * Public by design (a shopper checks a PIN before signing in) and side-effect
 * free: it reads, it never writes.
 */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/** How long we will wait on a third party before falling back. */
const LOOKUP_TIMEOUT_MS = 4000;

/** Business days quoted when no courier integration is connected. */
const FALLBACK_DELIVERY = { minBusinessDays: 4, maxBusinessDays: 7 };

/**
 * The first two digits of an Indian PIN identify the postal circle. This is
 * fixed, published allocation — not a guess — so a PIN can still be validated
 * and its state named when both postal APIs are unreachable.
 */
const PIN_PREFIX_STATE = {
  11: 'Delhi',
  12: 'Haryana', 13: 'Haryana',
  14: 'Punjab', 15: 'Punjab', 16: 'Punjab',
  17: 'Himachal Pradesh',
  18: 'Jammu & Kashmir', 19: 'Jammu & Kashmir',
  20: 'Uttar Pradesh', 21: 'Uttar Pradesh', 22: 'Uttar Pradesh', 23: 'Uttar Pradesh',
  24: 'Uttar Pradesh', 25: 'Uttar Pradesh', 26: 'Uttar Pradesh', 27: 'Uttar Pradesh',
  28: 'Uttar Pradesh',
  30: 'Rajasthan', 31: 'Rajasthan', 32: 'Rajasthan', 33: 'Rajasthan', 34: 'Rajasthan',
  36: 'Gujarat', 37: 'Gujarat', 38: 'Gujarat', 39: 'Gujarat',
  40: 'Maharashtra', 41: 'Maharashtra', 42: 'Maharashtra', 43: 'Maharashtra', 44: 'Maharashtra',
  45: 'Madhya Pradesh', 46: 'Madhya Pradesh', 47: 'Madhya Pradesh', 48: 'Madhya Pradesh',
  49: 'Chhattisgarh',
  50: 'Telangana', 51: 'Andhra Pradesh', 52: 'Andhra Pradesh', 53: 'Andhra Pradesh',
  56: 'Karnataka', 57: 'Karnataka', 58: 'Karnataka', 59: 'Karnataka',
  60: 'Tamil Nadu', 61: 'Tamil Nadu', 62: 'Tamil Nadu', 63: 'Tamil Nadu', 64: 'Tamil Nadu',
  65: 'Tamil Nadu',
  67: 'Kerala', 68: 'Kerala', 69: 'Kerala',
  70: 'West Bengal', 71: 'West Bengal', 72: 'West Bengal', 73: 'West Bengal', 74: 'West Bengal',
  75: 'Odisha', 76: 'Odisha', 77: 'Odisha',
  78: 'Assam', 79: 'Arunachal Pradesh & North East',
  80: 'Bihar', 81: 'Bihar', 82: 'Bihar', 83: 'Jharkhand', 84: 'Bihar', 85: 'Jharkhand',
};

function env(name) {
  const value = process.env[name];
  return value && String(value).trim() ? String(value).trim() : null;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** India Post's own directory. */
async function postalPinLookup(pincode) {
  const payload = await fetchJson(`https://api.postalpincode.in/pincode/${pincode}`, {
    headers: { accept: 'application/json' },
  });
  const entry = Array.isArray(payload) ? payload[0] : null;
  if (!entry || entry.Status !== 'Success' || !entry.PostOffice?.length) return null;

  const office = entry.PostOffice[0];
  return {
    pincode,
    city: office.District || office.Block || office.Name || '',
    state: office.State || '',
    district: office.District || '',
    postOffice: office.Name || '',
    source: 'india-post',
  };
}

/** Secondary directory, tried only if the first is unreachable. */
async function secondaryPinLookup(pincode) {
  const payload = await fetchJson(`https://api.pincodeapi.in/api/v1/pincode/${pincode}`, {
    headers: { accept: 'application/json' },
  });
  const office = payload?.data?.post_offices?.[0];
  if (!payload?.success || !office) return null;

  return {
    pincode,
    city: office.district || office.city || '',
    state: office.state || '',
    district: office.district || '',
    postOffice: office.name || '',
    source: 'directory',
  };
}

/**
 * Neither directory answered. The PIN is still structurally valid and its
 * circle is known, so the order is not blocked — the customer's own city and
 * state entries stand, and the response says the lookup was unavailable rather
 * than inventing an address.
 */
function offlinePinFallback(pincode) {
  const state = PIN_PREFIX_STATE[Number(pincode.slice(0, 2))];
  if (!state) return null;
  return { pincode, city: '', state, district: '', postOffice: '', source: 'offline' };
}

async function shiprocketEstimate(pincode) {
  const email = env('SHIPROCKET_EMAIL');
  const password = env('SHIPROCKET_PASSWORD');
  const pickup = env('SHIPROCKET_PICKUP_POSTCODE');
  if (!email || !password || !pickup) return null;

  const auth = await fetchJson('https://apiv2.shiprocket.in/v1/external/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!auth?.token) return null;

  const payload = await fetchJson(
    'https://apiv2.shiprocket.in/v1/external/courier/serviceability/' +
      `?pickup_postcode=${encodeURIComponent(pickup)}` +
      `&delivery_postcode=${encodeURIComponent(pincode)}&cod=0&weight=0.5`,
    { headers: { Authorization: `Bearer ${auth.token}`, accept: 'application/json' } },
  );
  if (!payload) return null;

  return parseShiprocket(payload);
}

function parseShiprocket(payload) {
  const couriers = payload?.data?.available_courier_companies ?? payload?.data ?? [];
  if (!Array.isArray(couriers) || couriers.length === 0) return null;

  const days = couriers
    .map((courier) => String(courier.estimated_delivery_days ?? '').match(/\d+/)?.[0])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  const dates = couriers.map((courier) => courier.etd).filter(Boolean);
  if (days.length === 0 && dates.length === 0) return null;

  return {
    source: 'shiprocket',
    estimatedDays: days.length > 0 ? Math.min(...days) : null,
    etd: dates[0] ?? null,
    courierCount: couriers.length,
  };
}

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const body = await request.json().catch(() => ({}));
    const pincode = String(body?.pincode ?? '').replace(/\D/g, '');

    if (!/^[1-9]\d{5}$/.test(pincode)) {
      return json({ error: 'Enter a valid 6-digit PIN code.' }, 400);
    }

    const postal =
      (await postalPinLookup(pincode)) ??
      (await secondaryPinLookup(pincode)) ??
      offlinePinFallback(pincode);

    if (!postal) {
      return json({ serviceable: false, error: 'We could not verify this PIN code.' }, 200);
    }

    let delivery = null;
    try {
      delivery = await shiprocketEstimate(pincode);
    } catch {
      delivery = null;
    }

    // Directories sometimes pad names ("Bangalore "): trim before they reach the form.
    for (const key of ['city', 'state', 'district', 'postOffice']) {
      if (typeof postal[key] === 'string') postal[key] = postal[key].trim();
    }

    return json({
      serviceable: true,
      postal,
      // Present only when a courier actually answered.
      delivery,
      // Present only when one did not. Exactly one of the two is ever set, so
      // the UI cannot accidentally show an estimate as if it were live.
      fallbackDelivery: delivery ? null : FALLBACK_DELIVERY,
      verified: postal.source !== 'offline',
    });
  } catch {
    return json({ error: 'We could not check this PIN code right now.' }, 502);
  }
};
