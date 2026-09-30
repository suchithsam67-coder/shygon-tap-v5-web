// Vercel entry for /api/payment-mode. The handler itself lives in netlify/functions and
// is shared by both hosts: it takes a web Request and returns a Response.
import handler from '../netlify/functions/payment-mode.mjs';

export const GET = (request) => handler(request);
