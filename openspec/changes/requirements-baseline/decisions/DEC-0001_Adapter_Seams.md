# DEC-0001 — Channel and engine boundaries

| Field | Value |
|---|---|
| **ID** | `DEC-0001` |
| **Title** | The channel and the image engine are interfaces, not assumptions |
| **Owner** | Dharmesh Pratap Singh (operator) |
| **Status** | APPROVED |
| **Created** | 2026-10-14 |
| **Last modified** | 2026-10-14 |
| **Spec** | `spec.md` v1.0 |
| **Source classification** | OBSERVED |
| **Confidence** | HIGH |
| **Supersedes** | — |
| **Superseded by** | — |
| **Dependencies** | `spec.md` |

## Problem

The product must be developed and demonstrated without a Meta Business account,
and the image engine may need to change (fidelity, cost, watermark concerns). If
the conversation logic knows about WhatsApp payloads or the Gemini SDK, both
become blocking and both become expensive to change.

## Options considered

1. **Write directly against the WhatsApp Cloud API**, then add a local test
   harness as a separate mock. _(stop)_
2. **Two implementations of the conversation** — one for WhatsApp, one for local
   testing. _(stop)_
3. **Abstract the channel behind an interface**, with a local adapter that drives
   the real pipeline.
4. **Defer the decision** until real channel integration is needed. _(defer)_

## Evidence

| Claim | Class | Basis |
|---|---|---|
| WhatsApp onboarding requires an external account and verification | `EXTERNAL-VERIFIED` | Meta documentation; `docs/meta-setup.md` |
| The pipeline currently runs against both a simulator and a fake adapter unchanged | `OBSERVED EVIDENCE` | `SEAM-001`, `SEAM-005` tests; `scripts/verify-e2e.ts` |
| Only one module imports the Gemini SDK | `OBSERVED EVIDENCE` | `src/imaging/gemini.ts` is the sole importer |

## Assumptions

- A second channel (or engine) is plausible within the product's life.
- The abstraction cost is small because the number of channel operations is
  small: send text, send image, download media, mark read.

## Arguments for option 3

- Development is unblocked from an external account that takes days to verify.
- The simulator exercises the **real** pipeline, so it cannot drift from
  production behaviour — the failure mode of a separate mock.
- A future try-on engine is a new file, not a refactor.

## Arguments against option 3

- It is indirection that must earn its keep; a small, self-crossing interface is
  worse than none.
- An over-general interface invites operations only one channel supports.

## Material dissent

None recorded. The counter-argument worth preserving is that four methods is
close to the threshold where abstraction stops paying for itself; if the
interface grows beyond roughly six operations, reconsider.

## Risks

- The interface leaks channel-specific concepts (e.g. media indirection) and
  becomes a lowest-common-denominator. **Evidence so far:** `downloadMedia`
  exists precisely because WhatsApp needs two-hop authenticated fetches.
- A leak-free abstraction is claimed but not proven for a third channel.

## Chosen decision

**Option 3.** `DeliveryAdapter` (`src/messaging/types.ts`) and `ImageProvider`
(`src/imaging/types.ts`) are the only external couplings. Concrete
implementations are selected in a single factory (`src/providers.ts`) so tests
can inject fakes.

## Reversibility

Moderate. Collapsing either interface back into the pipeline is a contained
refactor, but call sites would spread. Reversal cost grows with the number of
implementations.

## Success metrics

Fixed before the outcome was observed:

- The full conversation completes over HTTP with **no** Meta credentials.
- Swapping the image provider requires **no** change to `src/core/`.
- Swapping the channel requires **no** change to `src/core/`.

All three hold today (`SIM-001`, `SEAM-001`, `SEAM-002`).

## Review date

On adding a third channel or a second image engine, whichever comes first.
