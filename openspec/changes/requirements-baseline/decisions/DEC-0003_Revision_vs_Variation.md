# DEC-0003 — Revision edits; regeneration is a separate, deliberate act

| Field | Value |
|---|---|
| **ID** | `DEC-0003` |
| **Title** | Revisions are chained edits; free-text feedback must not cause a re-roll |
| **Owner** | Dharmesh Pratap Singh (operator) |
| **Status** | APPROVED |
| **Created** | 2026-10-14 |
| **Last modified** | 2026-10-14 |
| **Spec** | `spec.md` v1.0 |
| **Source classification** | REASONED INFERENCE |
| **Confidence** | MODERATE |
| **Supersedes** | — |
| **Superseded by** | — |
| **Dependencies** | `DEC-0002`, `ITER-001`, `ITER-002`, `ITER-003` |

## Problem

Iteration is where an image product is won or lost. If asking for "warmer light"
produces a different garment print, the user cannot converge on an acceptable
shot and will burn budget re-litigating the garment instead of the lighting.

## Options considered

1. **Always regenerate from the original brief.** Simple; each attempt is an
   independent roll.
2. **Always chain an edit onto the previous output.** Strong consistency; risks
   compounding artefacts across iterations.
3. **Chain for revisions, re-roll for variations, keep the two mutually
   exclusive.**
4. **Ask the user which behaviour they want each time.** _(stop — the cost is
   borne by the user on every turn)_

## Evidence

| Claim | Class | Basis |
|---|---|---|
| A revision currently supplies both the prior interaction id and the prior output image | `OBSERVED EVIDENCE` | `ITER-001` test |
| Variations currently chain onto nothing | `OBSERVED EVIDENCE` | `ITER-002` test |
| A prompt cannot request both an edit and an exploration | `OBSERVED EVIDENCE` | `ITER-003` test |
| Chaining preserves garment identity better than re-rolling | `REASONED INFERENCE` | Follows from the edit being conditioned on the prior output. **Not measured.** |

## Assumptions

- Users iterate on lighting, pose, and framing far more often than on the garment
  itself. Unvalidated.

## Arguments for option 3

- Matches user intent as expressed in the message: "change X" versus "show me
  something else".
- Chained edits make the review loop convergent rather than a lottery.
- Variations genuinely need to diverge, which chaining would prevent.

## Arguments against option 3

- Chaining can accumulate artefacts across many iterations.
- A user wanting a fresh interpretation of the same brief must learn the `go`
  escape hatch.

## Material dissent

Recorded: **chained edits can compound errors.** If a revision produces an
acceptable-but-not-ideal sleeve, the next revision must live with it. Mitigation
is the explicit `go`/`again`/`redo` regenerate path, which clears the chain; it
is not a complete answer, and iteration depth per item is capped (`COST-001`).

## Risks

- Artefact compounding on deep revision chains.
- Unrecognised free text is treated as revision feedback, which spends budget on a
  possibly-wrong interpretation (`CONV-009`). Mitigated by treating pleasantries
  as non-instructions (`CONV-010`) and by the per-item cap.

## Chosen decision

**Option 3.** `revisionNote` ⇒ chained edit with the prior output as a reference
and `previous_interaction_id` set. `variationNote` ⇒ independent re-shoot with
distinct guidance. The prompt builder treats them as mutually exclusive.

## Why this decision won

It makes the common case (adjust this one thing) cheap and convergent, while
keeping the less common case (try something else) explicitly available — instead
of forcing one behaviour onto every turn.

## Confidence

`MODERATE`. The mechanism is verified; the claim that it preserves garment
identity better is inference and is unmeasured (`F-002`).

## Reversibility

High. It is a branch in prompt construction and request assembly.

## Resources committed

One generation per revision. Bounded per item.

## Success metrics

Fixed before the result:

- A revision request provably differs from a fresh generation in the request it
  issues (`previousInteractionId` present, more references). **Holds.**
- A revision visibly preserves the garment print. **Unmeasured.**
- Mean generations per approved shot decreases versus always-regenerating.
  **Unmeasured; no baseline exists.**

## Review date

After the first real catalogue of ~10 SKUs, which would give a
generations-per-approved-shot baseline.
