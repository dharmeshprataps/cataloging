# DEC-0002 — Image generation via Gemini `interactions`, and model selection

| Field | Value |
|---|---|
| **ID** | `DEC-0002` |
| **Title** | Use the Gemini `interactions` API with a configurable image model |
| **Owner** | Dharmesh Pratap Singh (operator) |
| **Status** | APPROVED |
| **Created** | 2026-10-14 |
| **Last modified** | 2026-10-14 |
| **Spec** | `spec.md` v1.0 |
| **Source classification** | EXTERNAL-VERIFIED |
| **Confidence** | HIGH |
| **Supersedes** | — |
| **Superseded by** | — |
| **Dependencies** | `GEN-001`, `GEN-003` |

## Problem

Producing a photograph of a garment worn by a model requires an image engine that
(a) accepts multiple reference images, (b) can perform targeted sequential edits
so a revision preserves the garment, and (c) is reachable without operating a GPU.

## Options considered

1. **A dedicated virtual try-on model** (fal.ai / Replicate IDM-VTON, FASHN).
   Best garment fidelity potential, but a second vendor and usually a second call
   for styling. _(defer)_
2. **Self-hosted open-source try-on.** No per-image cost and full data control,
   but requires GPU capacity this project does not have. _(stop)_
3. **Gemini `interactions` API** with multiple reference images and
   `previous_interaction_id` for sequential edits.
4. **No image generation** — deliver briefs only. _(stop)_

## Evidence

| Claim | Class | Basis |
|---|---|---|
| `@google/genai` 2.29.0 exposes `interactions.create` accepting an array of text and image content blocks | `OBSERVED EVIDENCE` | Type declarations in `node_modules/@google/genai/dist/genai.d.ts` |
| `previous_interaction_id` enables sequential edits | `OBSERVED EVIDENCE` | Same declarations; `CreateModelInteraction.previous_interaction_id` |
| `response_format` accepts `type: image`, `aspect_ratio`, `image_size` | `OBSERVED EVIDENCE` | `ImageResponseFormat_2` union |
| `gemini-2.5-flash-image` is documented as **legacy**, with migration recommended | `EXTERNAL-VERIFIED` | Google Gemini image-generation documentation |
| `gemini-nano-banana-2.1` is the current recommended workhorse | `EXTERNAL-VERIFIED` | Same documentation |
| All generated images carry a SynthID watermark that cannot be removed via API | `EXTERNAL-VERIFIED` | Google SynthID documentation |
| Output quality is sufficient to replace a photoshoot | `HYPOTHESIS` | **Never tested against a real garment — see `F-002`** |

## Assumptions

- Gemini's multi-reference consistency is adequate for garment fidelity. _This is
  the load-bearing assumption and it is untested._
- A single API call per shot is acceptable latency (tens of seconds).

## Arguments for option 3

- Two capabilities the product specifically needs are confirmed present:
  multiple references, and chained edits.
- One vendor, one credential, one call per shot.
- No infrastructure to operate.

## Arguments against option 3

- **Garment fidelity is the core value and this is a general image model, not a
  try-on model.** Dedicated try-on models preserve garment pixels more reliably.
- **SynthID watermarking is unavoidable** and may be unacceptable to some brands.
- Vendor lock-in at the fidelity layer, partially mitigated by `ImageProvider`.

## Material dissent

Recorded, not resolved: **a dedicated try-on model is likely to be more faithful
than a general image model, and fidelity is the product's central promise.** The
rebuttal is speed to a testable product and a single call per shot. This dissent
must be re-examined the moment real output is judged (`F-002`).

## Risks

- **Fidelity shortfall, untested.** Mitigated only by the revision loop, which
  defaults to editing rather than re-rolling (`DEC-0003`).
- **Model churn.** Google's image model line has moved quickly; the legacy status
  of `gemini-2.5-flash-image` within one release cycle is direct evidence.
- **Cost drift.** Per-image pricing is not contractual.

## Chosen decision

**Option 3.** `interactions.create` with the image model **configurable**
(`GEMINI_IMAGE_MODEL`, default `gemini-nano-banana-2.1`). The SDK version is
pinned exactly. Option 1 is deferred, not rejected, and remains reachable as a
second `ImageProvider` implementation.

## Why this decision won

It unblocks building and testing today with a single vendor, while the two
mechanisms this product uniquely depends on — multi-reference input and chained
edits — are verified present rather than assumed.

## Confidence

`HIGH` that the API works as implemented. `LOW` that output fidelity is
market-acceptable. Those are different claims and are not conflated.

## Reversibility

High. One file implements `ImageProvider`; a second implementation is additive.

## Resources committed

Gemini API credit, estimated per generation for logging (`COST-004`). No
infrastructure.

## Success metrics

Fixed before the result:

- A real generation completes and returns decodable image bytes.
- A revision preserves the garment's colour and print noticeably better than a
  fresh generation (`DEC-0003`).
- Unit cost per approved shot is acceptable to the operator.

**All three remain unmeasured.** No live generation has been run (`F-002`).

## Review date

Immediately upon the first real generation being judged by a human.
