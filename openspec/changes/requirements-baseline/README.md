# Change `requirements-baseline`

| Field | Value |
|---|---|
| **ID** | `SPEC-REQ-BASELINE` |
| **Title** | Requirement baseline and traceability convention |
| **Owner** | Dharmesh Pratap Singh (operator) |
| **Status** | APPROVED — amended 2026-10-14, re-approval pending (§12 of `spec.md`) |
| **Created** | 2026-10-14 |
| **Last modified** | 2026-10-14 |
| **Spec** | [`spec.md`](spec.md) |
| **Source classification** | MIXED |
| **Confidence** | MODERATE |
| **Supersedes** | — |
| **Superseded by** | — |
| **Dependencies** | `requirements.md`, `PROBLEMS.md`, `decisions/`, `findings/` |

**Type:** specification, gate, test suite, and the implementation the suite
exercises. This change does contain source code — see "What this change
contains" below.

## What this is

A written baseline of what the system is supposed to do, plus the mechanism that
keeps future changes honest against it. The repository's requirement process
produces a specification *before* implementation for each change; this change
supplies what that process needs and that did not previously exist:

1. a **baseline** describing behaviour that already exists, so a new spec can
   state what it must not break;
2. a stable **requirement id scheme**, so a review comment, a test, and a spec
   line can all refer to the same thing; and
3. a **gate** that fails when the catalogue, the citations, or the code drift
   apart — with a falsification test proving each of its rules fails when
   violated.

Read [`spec.md`](spec.md) first. It is the reviewable document.

## Contents

| File | Purpose |
|---|---|
| [`spec.md`](spec.md) | **The specification.** Goal, user stories, acceptance criteria, known gaps, open questions. |
| [`requirements.md`](requirements.md) | The normative requirement catalogue — 158 requirements across 18 areas. |
| [`traceability.yaml`](traceability.yaml) | Machine-readable index: one line per requirement, with its state, verification, gaps and citing tests. |
| [`PROBLEMS.md`](PROBLEMS.md) | Consolidated problems and known deviations, including the unverified requirements, in recommended resolution order. |
| [`decisions/`](decisions/) | Six decision records, each with options, dissent, reversibility and success metrics fixed in advance. |
| [`findings/`](findings/) | The three original findings, from which `PROBLEMS.md` is distilled. |
| [`templates/METADATA_BLOCK.md`](templates/METADATA_BLOCK.md) | The metadata block and claim classes used by every artifact here. |
| [`../../../scripts/verify-spec.ts`](../../../scripts/verify-spec.ts) | The gate itself. |
| [`../../../scripts/spec-status.ts`](../../../scripts/spec-status.ts) | CLI report; exits 1 on any violation. |
| [`../../../tests/spec-gate.test.ts`](../../../tests/spec-gate.test.ts) | 39 tests, one falsifying each gate rule. |

## Requirement ids

`<AREA>-<NNN>`, permanent, never renumbered or reused.
`CONV` conversation · `UX` copy and flows · `BATCH` batching · `BRIEF` brief
parsing · `GEN` generation · `ITER` revision and variation · `MED` media
validation · `WA` WhatsApp · `SIM` simulator · `PERSIST` storage · `CATALOG`
products · `CFG` configuration · `OBS` observability · `SEAM` architecture seams ·
`SEC` security · `CONTENT` content policy · `COST` cost control · `TOOL` the
metadata rule and runtime selection this change enforces.

## Coverage at a glance

**158 requirements:** 154 `implemented`, 1 `partial`, 2 `deferred`,
1 `not_implemented`. **151 are verified** by a test that fails when the behaviour
breaks. **4 are `unverified`** — implemented, cited by a test, but the test
exercises a substitute rather than the code the requirement names:
`GEN-001`, `GEN-008`, `GEN-009`, `SIM-008`. **3 are `n/a`** — they describe
behaviour that does not exist: `WA-009`, `CONV-008`, `SEC-006`.

All seven deviations are recorded in [`PROBLEMS.md`](PROBLEMS.md) rather than
claimed. These figures are read from `./run.sh pnpm spec:status`, which is the
authority; the prose here is kept in step by hand.

The two claims that bound everything else:

- **No real image has ever been generated** (`P-2`). The product's central claim
  is unverified.
- **The image model is a general image model, not a purpose-built try-on model**
  (`DEC-0002`), with the dissent recorded.

## What this change contains

The baseline, the gate, the suite, and the product implementation the suite
exercises:

| Area | What lands |
|---|---|
| `openspec/changes/requirements-baseline/` | The baseline: spec, catalogue, traceability index, problems, decisions, findings, template. |
| `scripts/verify-spec.ts`, `spec-status.ts`, `sync-traceability.ts`, `lib/yaml.ts` | The gate, its report CLI, the citation-count sync, and the YAML reader the gate needs. The metadata check scans every artifact (`TOOL-001`). |
| `scripts/lib/tooling.ts`, `scripts/run-tool.mjs` | Runtime selection for `run.sh`, in a module a test can execute (`TOOL-002`). |
| `tests/` | The suite: 242 tests in 14 files, including `tests/spec-gate.test.ts`, `tests/tooling.test.ts`, and the outbound WhatsApp Cloud API path. |
| `src/` | The product implementation the suite measures. It introduces no behaviour the baseline does not describe. |
| `Dockerfile`, `fly.toml`, `.env.example`, `run.sh`, `test.sh` | Minimum infrastructure so the suite and gate run in a clean checkout — a claim `run.sh` did not meet until it stopped deriving its runtime from one machine's path (`TOOL-002`). |

The implementation is here because the gate requires every `implemented`
requirement to be cited by a test **in the same tree** that is not skipped and
asserts something. A citation pointing at another branch is a pointer, not
evidence. Two of the three changes originally proposed as follow-ons
(`traceability-gate`, `expand-test-coverage`) are therefore absorbed into this
one; only `wire-unwired-capabilities` remains separate (`spec.md` §9).

## Known limitations

1. **`GEN-001`, `GEN-008`, `GEN-009`, `SIM-008` are unverified.** Each needs an
   injectable SDK client — product code, and part of `wire-unwired-capabilities`.
2. **The gate cannot tell whether a citation supports its claim.** It proves a
   non-skipped, asserting test cites the id, never that the citation is evidence
   for *that* claim. That is exactly how `GEN-001` passed as `verified`.
3. **No CI job runs the suite or the gate.** `.github/workflows/agent-policy.yml`
   only checks that a PR body references a spec path. `pnpm test` must be run by
   hand.
4. **The amended specification awaits re-approval.** `spec.md` §12 records it.

## How to review this change

1. Read `spec.md` — especially §1.3 (scope), §5 (what is verified) and §7 (known
   gaps).
2. Run `./run.sh pnpm test` and `./run.sh pnpm spec:status`; compare the counts
   against §5 and the section above.
3. Spot-check three requirements in `requirements.md` against the code they
   describe, and spot-check that the four `unverified` entries are genuinely
   unproven.
4. Decide the open questions in §11: the baseline's granularity, where the
   catalogue should live permanently, who accepts the four unverified
   requirements, whether the SynthID watermark is acceptable, and whether the
   gate should be able to detect an unsupporting citation.
5. Confirm the amended revision (§12) and reply `/approve` or
   `/change <instruction>`.
