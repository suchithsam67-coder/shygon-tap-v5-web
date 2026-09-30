// Outbound-network guard for test runs (M0.1; see docs/DECISIONS.md IMP-003).
//
//   node --import ./scripts/ci/deny-network.mjs <test file>
//
// Any fetch() to a host other than loopback throws the same TypeError a dead
// network would. A test therefore cannot reach the live Supabase project,
// Razorpay, an SMS provider or the PIN-code directories, whatever `.env` or the
// environment contains. The server functions reach the network only through
// fetch (netlify/ and api/ import no http, https, net, tls or dns module), so
// guarding fetch covers them.
//
// A test that installs its own fake fetch replaces this one while it runs.
//
// On exit the guard lists the hosts it refused. It never prints full URLs,
// because those can carry tokens. The log shows what the code tried to reach
// without anything having left the machine.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const refused = new Map();
const realFetch = globalThis.fetch;

globalThis.fetch = async function denyNetworkFetch(input, init) {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (LOOPBACK.has(url.hostname)) return realFetch(input, init);
  refused.set(url.hostname, (refused.get(url.hostname) ?? 0) + 1);
  throw new TypeError(`fetch failed: outbound network is denied in this test run (${url.hostname})`);
};

process.on('exit', () => {
  if (refused.size === 0) return;
  const hosts = [...refused].map(([host, count]) => `${host} x${count}`).join(', ');
  process.stderr.write(`network-guard: refused outbound fetch to ${hosts}\n`);
});
