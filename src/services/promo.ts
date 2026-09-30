import { supabase } from '../lib/supabase';

/**
 * Promo codes (migration 020): a percentage off the cart value, before
 * delivery. This only asks the database whether a code applies and what it
 * would take off, so checkout can show it. The discount a customer is charged
 * is decided again by /api/create-order, which reserves the code against the
 * order — nothing computed here is trusted as money.
 */

export interface PromoResult {
  ok: boolean;
  code?: string;
  percent?: number;
  discountInPaise?: number;
  message: string;
}

export async function checkPromoCode(
  code: string,
  subtotalInPaise: number,
  orderType: string,
): Promise<PromoResult> {
  const { data, error } = await supabase.rpc('check_promo_code', {
    p_code: code,
    p_subtotal_in_paise: subtotalInPaise,
    p_order_type: orderType,
  });
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') {
      return { ok: false, message: 'Promo codes are not available yet.' };
    }
    throw error;
  }
  const result = (data ?? {}) as Partial<PromoResult>;
  return {
    ok: Boolean(result.ok),
    code: result.code,
    percent: typeof result.percent === 'number' ? result.percent : undefined,
    discountInPaise: typeof result.discountInPaise === 'number' ? result.discountInPaise : undefined,
    message: result.message ?? (result.ok ? 'Promo code applied.' : 'This promo code is not valid.'),
  };
}
