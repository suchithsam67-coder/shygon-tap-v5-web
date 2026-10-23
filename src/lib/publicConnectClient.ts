/**
 * Whether a Tap's owner accepts SHYGON Connect requests (AAROH-API v0.7.1 §10b
 * `public.status`): false while SHYGON's host switch is off, whatever the owner
 * chose. Anonymous: that is the only Connect operation a visitor can call.
 * Sending a request needs a signed-in SHYGON account, so the public Tap only
 * links to the signed-in page that does it, and that page asks again before
 * offering its form. Plain fetch, like the other public clients; any failure
 * reads as "not available".
 */
export async function fetchConnectAvailable(slug: string): Promise<boolean> {
  try {
    const response = await fetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'public.status', slug }),
    });
    if (!response.ok) return false;
    const result = (await response.json()) as { available?: boolean };
    return result.available === true;
  } catch {
    return false;
  }
}
