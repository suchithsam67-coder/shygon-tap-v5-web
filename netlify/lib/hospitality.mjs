import { env } from './sms.mjs';

/**
 * The hotel boundary for SHYGON Privé (migration 033, DEC-2026-038 Q6 = demo).
 *
 * Every Privé operation goes through a HotelProvider. In this release the only
 * provider is 'demo': SHYGON-owned sample hotels whose "front desk" is a
 * simulator inside SHYGON's own database. It makes no network call, and nothing
 * it returns may be presented as having reached a real hotel.
 *
 * A future integration (a PMS, a booking engine, an access system) would be a
 * new provider implementing the same three methods. It needs its own decision,
 * contract, credentials and security review. Until then, configuring any other
 * provider fails closed.
 *
 *   interface HotelProvider {
 *     id: string
 *     listHotels(): Promise<Hotel[]>
 *     submitRequest({ userId, hotelSlug, service, idempotencyKey }): Promise<{ requestId, replayed }>
 *     requestStatus({ userId, requestId? }): Promise<Request[]>
 *   }
 */

export const DEMO_NOTICE = 'Demo: SHYGON Privé sample hotel. No real hotel received this request; nothing is booked and no door opens.';

export class UnsupportedProviderError extends Error {}

/** The configured provider; only 'demo' exists (HOTEL_PROVIDER unset or 'demo'). */
export function hotelProviderId() {
  const configured = (env('HOTEL_PROVIDER') ?? 'demo').toLowerCase();
  if (configured !== 'demo') throw new UnsupportedProviderError(`Hotel provider "${configured}" is not supported in this release.`);
  return 'demo';
}

/** The demo provider: every call is a database function of migration 033. */
export function demoProvider(rpc, cfg) {
  return {
    id: 'demo',
    listHotels: () => rpc(cfg, 'prive_demo_hotels_list'),
    submitRequest: ({ userId, hotelSlug, service, idempotencyKey }) =>
      rpc(cfg, 'prive_demo_request_create', { p_user: userId, p_hotel_slug: hotelSlug, p_service: service, p_idempotency_key: idempotencyKey }),
    requestStatus: async ({ userId, requestId = null }) => {
      await rpc(cfg, 'prive_demo_advance_due');
      return rpc(cfg, 'prive_demo_requests_for', { p_user: userId, p_request: requestId });
    },
    cancelRequest: ({ userId, requestId }) => rpc(cfg, 'prive_demo_request_cancel', { p_user: userId, p_request: requestId }),
  };
}
