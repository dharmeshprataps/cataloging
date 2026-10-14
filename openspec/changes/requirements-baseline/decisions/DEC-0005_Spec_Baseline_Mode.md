# DEC-0005 — Adopt the spec in baseline (charter) mode, not aspirational mode

| Field | Value |
|---|---|
| **ID** | `DEC-0005` |
| **Title** | The first specification documents existing behaviour and records its deviations |
| **Owner** | Dharmesh Pratap Singh (operator) |
| **Status** | APPROVED |
| **Created** | 2026-10-14 |
| **Last modified** | 2026-10-14 |
| **Spec** | `spec.md` v1.0 |
| **Source classification** | REASONED INFERENCE |
| **Confidence** | HIGH |
| **Supersedes** | — |
| **Superseded by** | — |
| **Dependencies** | `spec.md`, `F-001`, `F-002`, `F-003` |

## Problem

The project is adopting spec-driven development **after** a working
implementation exists (58 files, 83 passing tests). A philosophy that says "the
spec is the source of truth and code is derived" cannot be literally true of code
that already exists. Pretending otherwise would make the spec itself dishonest —
a `CONTRADICTED` claim — and would poison the traceability gate that is supposed
to keep it honest.

## Options considered

1. **Declare the spec authoritative and rewrite the code from it.** Philosophically
   pure; discards working, tested code and blocks all delivery during the gap.
   _(stop)_
2. **Write the spec as the target state and let tests go red until code is fixed.**
   Preserves purity; the project becomes unshippable while the gap exists, and the
   red tests stop carrying information.
3. **Baseline: the spec documents actual behaviour, with an explicit implementation
   status and verification status per requirement. Every deliberate divergence is
   recorded as an `F-` finding linked from the requirement.**

## Evidence

| Claim | Class | Basis |
|---|---|---|
| 83 tests pass against the current implementation | `OBSERVED EVIDENCE` | Test suite |
| The implementation predates this specification | `OBSERVED EVIDENCE` | Git history; `spec.md` created after the code |
| A spec claiming to have generated existing code would be false | `REASONED INFERENCE` | Definitional |
| Several capabilities exist but are unwired | `OBSERVED EVIDENCE` | `F-001` |

## Assumptions

- A spec that is honest about gaps is more useful than one that is aspirational
  and inaccurate. This is the whole bet.
- Recording a gap as a finding is better than omitting or mis-stating it.

## Arguments for option 3

- The gate can be green on day one **while still carrying information**: a
  requirement marked `implemented` must have a test, so it cannot hide.
- `unverified` requirements are visible as a work list rather than invisible as a
  gap. There are 32 of them, which is itself the most useful output of this
  exercise.
- The spec becomes a truthful description of the system, which is the precondition
  for using it to drive future change.

## Arguments against option 3

- **Risk of ossifying current bugs as "specified" behaviour.** A reviewer may read
  `implemented` as `desired`.
- Reverse-engineered specs can miss behaviour the author never noticed.
- It front-loads a large writing effort whose value is not immediately visible.

## Material dissent

Recorded: **baselining legitimises the status quo.** The rebuttal is that the
alternative — aspirational specs with red tests — removes the signal that makes
tests worth running. The mitigation is that deviations are first-class artifacts
(`F-001`–`F-003`) rather than tolerated silently, and that status
vocabulary distinguishes `implemented` from `verified`.

## Risks

- The spec drifts from code immediately after being written. Mitigated by
  `spec/verify.ts` failing on drift (`AGENTS.md` §5).
- Statuses get marked `verified` without real evidence. Mitigated by requiring a
  named test that exists and cites the requirement back.

## Chosen decision

**Option 3.** `requirements-baseline v1` is a baseline. Provenance is stated in the
artifact metadata (`Source classification: MIXED`) and in `spec.md`. Every
requirement carries both statuses. Findings `F-001`–`F-003` record the
deviations.

## Why this decision won

It is the only option under which the traceability gate is simultaneously green
and informative. Options 1 and 2 both trade away signal for appearance.

## Confidence

`HIGH`. The failure mode (dishonest spec) is exactly what this decision avoids.

## Reversibility

High. Once the code and spec are reconciled, later revisions can legitimately be
written aspirational-first, and the specification as the primary artifact becomes literally true from
that point forward.

## Resources committed

Documentation effort. No runtime change.

## Success metrics

Fixed before the result:

- `pnpm spec:verify` passes on adoption. **Required.**
- Every `implemented` requirement has ≥1 test naming it. **Required.**
- The count of `unverified` requirements is published rather than hidden.
- No requirement claims behaviour that does not exist.

## Review date

When the `unverified` count reaches zero, or at the first opportunity to write a
requirement before its implementation — whichever comes first. From that point,
option 2 becomes available for new work.
