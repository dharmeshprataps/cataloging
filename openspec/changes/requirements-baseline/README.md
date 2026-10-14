# Change `requirements-baseline`

**Status:** APPROVED — approved by Dharmesh Pratap Singh on 2026-10-14
**Type:** baseline documentation plus the traceability gate it authorises (§9)

## What this is

A written baseline of what the system is supposed to do, so that future changes
have something to be reviewed against. The repository's requirement process
produces a specification *before* implementation for each change; this change
supplies the two things that process needs and that do not yet exist:

1. a **baseline** describing behaviour that already exists, so a new spec can
   state what it must not break; and
2. a stable **requirement id scheme**, so a review comment, a test, and a spec
   line can all refer to the same thing.

Read [`spec.md`](spec.md) first. It is the reviewable document.

## Contents

| File | Purpose |
|---|---|
| [`spec.md`](spec.md) | **The specification.** Goal, user stories, acceptance criteria, known gaps, open questions. |
| [`requirements.md`](requirements.md) | The normative requirement catalogue — 156 requirements across 17 areas. |
| [`PROBLEMS.md`](PROBLEMS.md) | Consolidated problems and known deviations, in recommended resolution order. |
| [`decisions/`](decisions/) | Six decision records, each with options, dissent, reversibility and success metrics fixed in advance. |
| [`findings/`](findings/) | The three original findings, from which `PROBLEMS.md` is distilled. |
| [`templates/METADATA_BLOCK.md`](templates/METADATA_BLOCK.md) | The metadata block and claim classes used by every artifact here. |

## Requirement ids

`<AREA>-<NNN>`, permanent, never renumbered or reused.
`CONV` conversation · `UX` copy and flows · `BATCH` batching · `BRIEF` brief
parsing · `GEN` generation · `ITER` revision and variation · `MED` media
validation · `WA` WhatsApp · `SIM` simulator · `PERSIST` storage · `CATALOG`
products · `CFG` configuration · `OBS` observability · `SEAM` architecture seams ·
`SEC` security · `CONTENT` content policy · `COST` cost control.

## Coverage at a glance

**156 requirements:** 152 `implemented`, 1 `partial`, 2 `deferred`,
1 `not_implemented`. **Verified in this tree: 0.** The suite that demonstrates
them arrives with the `expand-test-coverage` change, so `traceability.yaml` here
marks every implemented entry `unverified` with a `gap` naming that change rather
than claiming proof this tree cannot show. `GEN-008`, `GEN-009` and `SIM-008` are
unverified for the stronger reason that no test anywhere exercises them.

The two claims that bound everything else:

- **No real image has ever been generated** (`P-2`). The product's central claim
  is unverified.
- **The image model is a general image model, not a purpose-built try-on model**
  (`DEC-0002`), with the dissent recorded.

## What this change deliberately does not contain

No product source and no product tests. The gate and its falsification tests land
here; the suite that demonstrates the 156 requirements lands with
`expand-test-coverage`, so this change can be reviewed against the baseline
without also accepting the implementation.

## Proposed follow-on changes

Proposed separately to keep each pull request focused on one approved
specification, per `AGENTS.md`.

| Proposed change id | Scope | Depends on |
|---|---|---|
| `traceability-gate` | The citation convention, the checker that fails on spec/code drift, and its falsification tests. | this change — **landed together with the baseline** |
| `expand-test-coverage` | Land the tests that demonstrate the 156 requirements, including the previously untested outbound WhatsApp Cloud API path. Until they land, `pnpm spec:status` fails on `every implemented requirement is covered by at least one test`. | this change |
| `wire-unwired-capabilities` | `P-1` (`WA-009`), `P-6`, `P-7`. | this change, and `P-2` for the quality items |

Work for the second and third already exists on the local branch
`local/spec-framework-wip`, which contains the rejected framework's implementation
(the test suites alone are worth keeping). It is deliberately **not** pushed.

## How to review this change

1. Read `spec.md` — especially §5 (what is verified) and §7 (known gaps). §5
   records the reviewed revision's coverage, which describes the suite delivered
   by `expand-test-coverage`; `traceability.yaml` in this tree states what is
   proven *here*, which is nothing yet.
2. Spot-check three requirements in `requirements.md` against the code they
   describe.
3. Decide the open questions in §11: the baseline's granularity, where the
   catalogue should live permanently, who signs off the three unverified
   requirements, and whether the SynthID watermark is acceptable.
4. Run `pnpm spec:status` and read the report.
