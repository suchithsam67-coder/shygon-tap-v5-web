# Download your data (V01 T-10): the strings, for the owner's gate

Session B (frontend), 2026-11-10. AAROH-API v0.12 §4a (DEC-2026-044). **All of it is a draft**: the owner approves the strings at this gate; counsel reviews the privacy-notice wording before release.

| Where | Text | Source |
|---|---|---|
| Button (Settings, Privacy, "Your data") | Download your data | existing |
| After the click | Your data is downloading: a JSON file with everything your account holds. | new |
| The contact card, its own button | Save your Business profile as a contact card (.vcf) | new |
| Heading over the server's list | What the file leaves out, and why | new |
| Each item | the server's own words, `what` in bold, then `why` (seven items today, from migration 038) | server |
| Long lists cut | Some long lists were cut to their newest 2,000 entries: (the list names) | new |
| Five a day (429) | You have downloaded your data several times today. You can download it again in about 3 hours. | new |
| Session lapsed (401) | Your session has expired. Sign in again. | existing |
| Any other failure | We could not prepare your data. Please try again. | new |

The file names: `shygon-account-<date>.json` and `shygon-tap-<date>.vcf`.

## Questions

- **Q-E1.** Approve the six new strings.
- **Q-E2.** The list names in "Some long lists were cut…" are the export's own keys (for example `notifications`). They are rare (2,000 rows), so they are shown as they are. Keep them, or turn them into plain names?
