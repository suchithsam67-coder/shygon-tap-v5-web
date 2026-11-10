// Vercel entry for /api/cards. The handler itself lives in netlify/functions and
// is shared by both hosts: it takes a web Request and returns a Response.
import handler from '../netlify/functions/cards.mjs';

export const GET = (request) => handler(request);
export const POST = (request) => handler(request);
