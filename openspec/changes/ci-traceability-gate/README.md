# Change `ci-traceability-gate`

| Field | Value |
|---|---|
| **ID** | `SPEC-CI-TRACEABILITY-GATE` |
| **Title** | Enforce the traceability gate and the suite in CI from a clean checkout |
| **Owner** | Dharmesh Pratap Singh (operator) |
| **Status** | APPROVED |
| **Approved** | 2026-10-14 |
| **Created** | 2026-10-14 |
| **Last modified** | 2026-10-14 |
| **Spec** | [`spec.md`](spec.md) |
| **Source classification** | OBSERVED |
| **Confidence** | HIGH |
| **Supersedes** | `requirements-baseline/README.md` limitation 3, and the "no CI" position in `requirements-baseline/spec.md` §9/§10 — see §6 of [`spec.md`](spec.md). |
| **Superseded by** | — |
| **Dependencies** | `agent/requirements-baseline-findings` (PR #6) for the clean-checkout toolchain. |

**Type:** CI workflow and the tests that hold it to its contract. No product code,
no change to the traceability gate's rules, no change to any requirement's
verification class.

## What lands

| Area | What it does |
|---|---|
| [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml) | Runs on `pull_request`, on `push` to `main`, and on `workflow_dispatch`. Four independent jobs — `typecheck`, `build`, `test`, `e2e` — each installing with the package manager `package.json` pins, on Node `24.x`. `test` runs `pnpm test`, which is vitest **and** the `spec:status` gate; `e2e` runs `pnpm verify:e2e`, the citation source for `SIM-003`. |
| [`tests/ci-workflow.test.ts`](../../../tests/ci-workflow.test.ts) | Asserts the triggers, the four checks and their jobs, the Node floor, the single package-manager pin, the read-only/no-secret posture, and that no citation source outside the suite carries evidence no CI step executes. Each rule has a falsification case that mutates the real workflow. |
| `requirements-baseline/README.md`, `requirements-baseline/spec.md`, root `README.md` | Record the supersession, so the baseline stops claiming a limitation this change removes. |
| `requirements-baseline/requirements.md`, `traceability.yaml`, count prose | Gain `TOOL-003` — the CI behaviour the new tests cite. The baseline's gate rejects a test that cites no requirement, so the requirement had to be added; counts move 158/151 → 159/152 in step. See §4 D6 and §6 of [`spec.md`](spec.md). |

## Why it is stacked on PR #6

`run.sh` at `main` still derives its runtime from a hardcoded developer path until
[PR #6](https://github.com/dharmeshprataps/cataloging/pull/6) lands, so a workflow
based on `main` alone would be red for a reason that is not this change's subject.
This branch is based on PR #6's head and its pull request targets that branch.
**It must not merge before #6.** The reasoning and its consequences are in §5 of
[`spec.md`](spec.md).

## How to review this change

1. Read [`spec.md`](spec.md) §3 (acceptance criteria) and §4 (design decisions),
   including D5 — the one place this change departs from the approved discovery
   recommendation, argued in full.
2. Read `.github/workflows/ci.yml` and check it against the four required checks.
3. Run `./run.sh pnpm test`; `tests/ci-workflow.test.ts` should be the only new
   file in the results.
4. Check the evidence in §7. **The workflow's own runs are blocked**: GitHub cannot
   start a job on this account ("locked due to a billing issue"), which also
   affects the pre-existing `agent-policy.yml`. §7 records that limitation, the
   local verification, and the locally-run falsification.
5. Check §6 against the baseline's own text: limitation 3 and §9/§10 should read
   as superseded, and §10's "prose counts match the index" row must still be
   declared manual.
