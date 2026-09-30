/**
 * Runs follow-up work (sending the emails a change just queued) without making
 * the customer wait for it where the host allows that, and inline where it
 * does not.
 *
 * Netlify passes a context with waitUntil(); the Vercel entries in api/ call
 * the handler with the request only. Either way the work finishes — the
 * scheduled send-emails run is the backstop if it does not.
 */
export async function afterResponse(context, promise) {
  const guarded = Promise.resolve(promise).catch((error) => {
    console.error('[after-response]', error?.message ?? error);
  });
  if (context && typeof context.waitUntil === 'function') {
    context.waitUntil(guarded);
    return;
  }
  await guarded;
}
