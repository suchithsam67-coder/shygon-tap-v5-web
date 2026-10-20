// Vercel entry for /api/emergency. The handler itself lives in netlify/functions and
// is shared by both hosts: it takes a web Request and returns a Response.
import handler from '../netlify/functions/emergency.mjs';

export const GET = (request) => handler(request);
export const POST = (request) => handler(request);
