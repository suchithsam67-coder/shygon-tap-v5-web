# B-10: An off-by-default host switch for SHYGON Connect

| Field | Value |
|---|---|
| Requested by | Session B, 2026-10-20 (B-10) |
| Owner's direction, 2026-10-20 | "Authorise design and a code-path audit, not immediate implementation. Confirm the existing emergency-alert and Return-to-Owner switches, their server-side enforcement and their tests. Then propose an off-by-default Connect switch that follows the same established pattern. Do not expose Connect merely by hiding its UI; enforce availability server-side too." |
| Status | **Audit done. Design PROPOSED. Nothing changed.** |
| Backlog | V6-125 |
| Decision record | It changes behaviour approved "as built" in DEC-2026-039, so it needs the owner's approval as an amendment to DEC-2026-039 (Q8) |

Labels: **OBSERVED** (verified in this repository), **INFERRED**, **PROPOSED**.

## 1. Audit: the two existing switches [OBSERVED]

| | Visitor emergency alerts | Return-to-Owner relay |
|---|---|---|
| Switch | `EMERGENCY_PUBLIC_ALERTS=on` (`netlify/functions/emergency.mjs:248`) | `RESCUE_RELAY=on` (`netlify/functions/rescue.mjs:72`) |
| Default | Off (unset); DEC-2026-038 Q2 | Off (unset); DEC-2026-038 Q12 |
| Status answer when off | `public.status` → `{ available: false }` (`:252`) | `public.status` → `{ available: false, hint: null }` (`:95`) |
| Action when off | `public.alert` → 404 `unavailable` (`:264`) | `public.start` → 404 `unavailable` (`:101`); `finder.view` / `finder.post` → `unavailable` (`:201–202`) |
| Owner operations when off | Work (the owner can still manage contacts and settings) | Work. `settings.get` / `settings.set` report `relayAllowed` (`:150, :157`), so the owner page can say SHYGON has not switched it on |
| Where enforced | The server function, before any database call. The interface shows the card only when the server says it is available. | Same |
| Tests | `test:emergency` (`supabase/tests/emergency.mjs:721`): "host switch: without EMERGENCY_PUBLIC_ALERTS=on, visitor alerts are unavailable even when the owner turned them on" | `test:rescue` (`supabase/tests/rescue.mjs:85–93`): "host switch off: finders get nothing, even after the owner turns the relay on". Also `:277–287`: relay off is indistinguishable from paused or suspended |
| Local stack | Both are passed through `stack.mjs:89` and listed in `SWITCHES` (`:144`). `POST /__sim/switches` accepts exactly these two names (`app-host.mjs:237`), from loopback callers only. `test:emergency:881–883` asserts that "only the two named switches exist". | — |

**A difference between the two:** the emergency function does not report its host switch to the owner, whereas rescue reports `relayAllowed`.
- So an owner who turns visitor alerts on cannot see that SHYGON has not.
- [PROPOSED, optional] Add `publicAlertsAllowed` to the emergency owner settings, for symmetry.

## 2. Connect today [OBSERVED]

- `public.status` (`netlify/functions/connect.mjs:141–144`) answers `available: true` whenever `connect_public_target` finds a target: the owner has Connect on, and the Tap is active, published and not suspended (032).
- `requests.create` (`:84–98`) creates a request for any valid slug with no host check.
- **No host switch exists.** On any host where 032 is applied, an owner who switches Connect on exposes it to signed-in visitors at once.
  - That contradicts the "Coming soon" status Session B reports the owner set for Connect (relayed; not received in Session A's session).

## 3. Proposed design

**Switch:** `CONNECT_PUBLIC=on`. Unset means off, in every environment by default.

| Operation | Switch off | Switch on |
|---|---|---|
| `public.status` | `{ available: false }`, before any database call | As today |
| `requests.create` | 404 `unavailable`, before any database call; indistinguishable from other unavailable answers | As today |
| `requests.accept` (the target accepts and shares back) | 404 `unavailable`. No new sharing while Connect is not public. | As today |
| `connections.share` (change what I share; a new grant version) | 404 `unavailable`. To stop sharing, use `connections.remove`. Alternative for the owner: allow changes that only remove fields. | As today |
| `requests.decline`, `requests.block` | **Always work** | As today |
| `connections.remove` (end it, or withdraw a request; revokes every grant) | **Always works.** Withdrawal is never blocked. | As today |
| `connections.list`, `consents.list` | Always work, so people can see what exists | As today |
| `settings.get` / `settings.set` | Work, and report `publicAllowed: false` | Report `publicAllowed: true` |

**Why a switch in the function is enough** [OBSERVED]:
- every `connect_*` function and every Connect table is closed to `anon` and `authenticated` and reachable only by `service_role` (032; `test:connect` asserts it);
- so `/api/connect` is the only path, and no migration is needed.

Session B confirmed this independently on 2026-10-20 (read-only).

**Why each choice:**
- The visitor's status answer and the request are locked on the server, as with the two existing switches. Hiding the interface alone would not be enough (owner's direction).
- Sharing more is locked, but withdrawing is never blocked: a person can always revoke consent, which follows the consent-ledger principle in DEC-2026-039.
- The owner can see why Connect does not appear.

**Local stack:**
- add `CONNECT_PUBLIC` to `stack.mjs` (passthrough and `SWITCHES`) and to the `/__sim/switches` allowlist;
- update `test:emergency:881–883` from "two" to "three" named switches.

**Tests (`test:connect`):**
- off with the owner on → `public.status` false;
- `requests.create`, `requests.accept` and `connections.share` 404;
- `requests.decline`, `requests.block`, `connections.remove`, `connections.list` and `consents.list` still work;
- `publicAllowed` is reported;
- the 16 existing checks run with the switch on.

**Contract:** a versioned change note (AAROH-API v0.8 or a point release).
- Frontend impact (Session B, 2026-10-20):
  - the public Connect card already appears only when `public.status` is true;
  - `?mode=connect` never opens a view;
  - the signed-in `/shygontap/connect/:slug` page does not check `public.status` first. With the switch off it would show the 404 as a refusal, never as success. Session B would add a status check so the form is not offered;
  - show "not yet available" when `publicAllowed` is false.

**Release:** `CONNECT_PUBLIC` stays unset on production until the owner's verification of the connection and consent workflows. Add it to the deployment environment list.

## 4. Questions for the owner

1. Approve the design as an amendment to DEC-2026-039 (Q8), including "no new sharing while off (create, accept, share), while decline, block, remove and the lists always work"? Or allow `connections.share` changes that only remove fields?
2. Add `publicAlertsAllowed` to the emergency owner settings, for symmetry? (Optional.)
3. After approval, implement locally with the tests above?
