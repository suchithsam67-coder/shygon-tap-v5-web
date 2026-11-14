/**
 * Accounts whose 18+ confirmation (v0.17 §4c) is known in this tab, so each
 * signed-in page does not ask the server again. Memory only: a new tab asks
 * once more, and the server's record is what counts.
 */
const confirmed = new Set<string>();

export const ageConfirmedHere = (userId: string) => confirmed.has(userId);
export const rememberAgeConfirmed = (userId: string) => void confirmed.add(userId);
/** For tests. */
export const forgetAgeConfirmations = () => confirmed.clear();
