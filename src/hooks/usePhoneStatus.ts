import { useAsync } from './useAsync';
import { getPhoneStatus, type PhoneStatus } from '../services/account';

/**
 * The account phone's verification (AAROH-API v0.13 §4b), read again whenever
 * the saved number changes.
 *
 * A status is returned only for the number it was read for: right after a new
 * number is saved, the old answer ("Verified") would otherwise stay on screen
 * until the new one arrives, or for good if that read fails. Until then this
 * is null, and a failed read is null too: the pages treat the phone as unknown
 * and the server still decides.
 */
export function usePhoneStatus(
  userId: string | undefined,
  savedPhone: string | null | undefined,
  enabled = true,
): PhoneStatus | null {
  const phone = savedPhone ?? null;
  const { data } = useAsync(() => getPhoneStatus().then((status) => ({ status, phone })), {
    enabled: Boolean(userId) && enabled,
    deps: [userId, phone],
  });
  return data && data.phone === phone ? data.status : null;
}
