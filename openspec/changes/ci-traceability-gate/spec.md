# Specification — Enforce the traceability gate and the suite in CI from a clean checkout

| Field | Value |
|---|---|
| **ID** | `SPEC-CI-TRACEABILITY-GATE` |
| **Title** | Enforce the traceability gate and the suite in CI from a clean checkout |
| **Change** | `ci-traceability-gate` |
| **Owner** | Dharmesh Pratap Singh (operator) |
| **Status** | APPROVED |
| **Approved** | 2026-10-14 |
| **Created** | 2026-10-14 |
| **Last modified** | 2026-10-14 |
| **Source classification** | OBSERVED |
| **Confidence** | HIGH |
| **Supersedes** | The limitation recorded in `requirements-baseline/README.md` limitation 3 and `requirements-baseline/spec.md` §9/§10 — see §6. |
| **Superseded by** | — |
| **Dependencies** | `agent/requirements-baseline-findings` (PR #6) for the clean-checkout toolchain — see §5. |

| Field | Value |
|---|---|
| **Spec** | `openspec/changes/ci-traceability-gate/spec.md` |
| **Author** | DSH implementation agent (session on `dharmeshprats/cataloging`) |
| **Approved by** | Dharmesh Pratap Singh (operator) |
| **Approval record** | `/approve` on https://github.com/dharmeshprataps/cataloging/issues/4#issuecomment-6174542684 (2026-10-14T17:41:36Z), answering the discovery questions at [#issuecomment-6174492546](https://github.com/dharmeshprataps/cataloging/issues/4#issuecomment-6174492546). The operator later confirmed, in session, (a) that this specification may be authored and its `Status: APPROVED` recorded from that `/approve`, and (b) that the change is stacked on PR #6 rather than absorbing it. |
| **Issue** | https://github.com/dharmeshprataps/cataloging/issues/4 |
| **Branch** | `agent/ci-traceability-gate`, based on `agent/requirements-baseline-findings` (`ca7c528`) |
| **Revised** | 2026-10-14 — §2, §3 (AC-5 plus the status note), §4 (D6), §6, §7 and §9 amended during implementation: CI enforcement became baseline requirement `TOOL-003` after the traceability gate rejected the new test file for citing no requirement, and the baseline's counts moved with it. **Then revised again in review remediation**, after independent review at `1077aeca` found the evidence section contradicting CI reality: §3's status note, §4 (D2 and D5), §7 and §8 are rewritten against run [38610453270](https://github.com/dharmeshprataps/cataloging/actions/runs/38610453270), which executed all four jobs green at the reviewed head SHA — and against the probe run [38613491202](https://github.com/dharmeshprataps/cataloging/actions/runs/38613491202), which is AC-3's failing run. AC-3's falsification probe was pushed and reverted, the citation guard was made to honour a job's or step's effective `if`, the Node pin was changed from `24.x` to `24`, and `TOOL-003`'s declaration in `traceability.yaml` moved from 14 citations to 17 as the three new falsification cases were added. The earlier claim that no workflow in this repository has ever executed was true only until 18:07:03Z on 2026-10-14 and is deleted rather than left to age. §1 and §5 are unchanged. The revision is recorded rather than silent because it changes the change's outputs and its evidence, not its acceptance criteria. |

> **This change adds a workflow and the tests that hold it in place. It changes no
> product code, no gate rule, and no requirement's verification class.** Its whole
> subject is that the checks the repository already had were never run by anything
> but a human, and the tooling could not run where automation lives.

---

## 1. Problem

This is the merged baseline's own declared gap, not a new idea. Observed at
`712a12f` (merge of PR #3):

1. **No job ran the suite or the gate.** `.github/workflows/agent-policy.yml` was
   the only workflow. It triggers on `pull_request` and greps the PR body for a
   spec path; it installs nothing and runs no test. The baseline recorded this in
   `openspec/changes/requirements-baseline/README.md` limitation 3 — *"No CI job
   runs the suite or the gate… `pnpm test` must be run by hand"* — and in PR #3's
   body as known limitation 2.
2. **The tooling could not run in a clean checkout.** `run.sh` derived both `node`
   and `pnpm` from one hardcoded developer path, so `./test.sh` and
   `./run.sh pnpm spec:status` failed on any host without it. That was independent
   review finding B2 on PR #3, and `spec.md` §9 justified shipping the file as
   *"minimum infrastructure so the suite and the gate can run in a clean checkout"*.
3. **Evidence the gate accepts by comment alone was never executed.** `SIM-003` is
   `verification: verified` on a single citation: the `// SIM-003` comment in
   `scripts/verify-e2e.ts`. No CI ran `pnpm verify:e2e`, so replacing that script
   with a no-op that kept the comment left `spec:status` green.

The net effect: every merge after the baseline relied on the operator trusting a
local run, and a gate whose value is realised only when it runs on every pull
request did not run at all.

**Why no test could have caught this.** Limitation 3 is a statement about pull
requests, and the baseline's own gate is a local command. The property had to be
made checkable, which is why §3 below is enforced by tests and not only by prose.

---

## 2. Scope

**In scope**

- `.github/workflows/ci.yml`: a workflow that, on `pull_request`, on `push` to
  `main`, and on `workflow_dispatch`, installs with the pinned package manager on
  Node ≥ 24 and runs `pnpm typecheck`, `pnpm build`, `pnpm test` (vitest **and**
  the `spec:status` gate) and `pnpm verify:e2e`.
- `tests/ci-workflow.test.ts`: the tests that hold the workflow to that contract,
  each with a falsification case.
- Baseline requirement `TOOL-003` — the CI behaviour the gate requires the new
  tests to cite — plus the count reconciliation it forces in `spec.md` §5, the
  change README, `requirements.md`, the root README and `F-003` (D6).
- Honest bookkeeping in the baseline's own artifacts (§6), so the baseline stops
  claiming a limitation this change removes.

**Out of scope** (unchanged from the issue's scope notes)

- Changing the gate's rules (`scripts/verify-spec.ts` rule set, `DEC-0006`).
- Widening the verified set, or making `GEN-001`, `GEN-008`, `GEN-009`, `SIM-008`
  genuinely verified — that is the separate `wire-unwired-capabilities` change
  (`requirements-baseline/spec.md` §9).
- The metadata-block enforcement gap and the residual duplicate-SKU race noted in
  independent review of PR #3.
- Any product code under `src/`.

---

## 3. Acceptance criteria

Each row is traceable to issue #4, and each names how it is demonstrated rather
than asserted.

| # | Criterion | Demonstrated by |
|---|---|---|
| AC-1 | **Clean-checkout runnability.** On a host with only Node ≥ 24 and pnpm on `PATH`, the suite and the gate run and pass; `run.sh`/`test.sh` contain no absolute machine path (asserted, not reviewed); `NODE_BIN`/`PNPM_BIN` still select a runtime when set. | Delivered by PR #6 (`scripts/lib/tooling.ts`, `TOOL-002`), which this branch is based on. The CI run is the strongest available form of the claim: a GitHub runner has no `DSH_RUNTIME_ROOT` and no developer directory, and the `test` job runs the suite **through `./test.sh`** there. |
| AC-2 | **CI enforcement.** `.github/workflows/` gains a job triggered on `pull_request` and `push` to `main` that installs with the pinned pnpm and Node ≥ 24 and runs typecheck, build, `pnpm test` and `pnpm verify:e2e`; the adding PR shows a green run at its own head SHA. | `.github/workflows/ci.yml`; `tests/ci-workflow.test.ts` asserts the triggers, the four commands, the Node floor and the package-manager pin. Green run URL in §7. |
| AC-3 | **Falsification.** A probe that breaks a citation turns the CI job red; the broken commit and the failing run URL are recorded in the PR body, then reverted. | §7 records the probe commit, the failing run URL, the exact violation, and the revert commit. |
| AC-4 | **No unexecuted sole evidence.** `SIM-003`'s only citation is executed by the workflow. | The `e2e` job runs `scripts/verify-e2e.ts`, the gate's `citationSources` entry that carries the `// SIM-003` comment. `tests/ci-workflow.test.ts` mechanises the rule: any citation source outside the suite that carries a `// ID` comment and is reached by no executing step fails the suite. A step is executing only when its job and the step itself are not disabled by a statically false `if:`; `if: ${{ false }}` on the step and `if: false` on the job are both refused (§7.3). |
| AC-5 | **Honest bookkeeping.** The change records which baseline statements it supersedes, and leaves §10's "prose counts match the index" declared manual. | §6; `requirements-baseline/README.md` limitation 3 and `requirements-baseline/spec.md` §9/§10 edited. §10's prose-counts row is untouched. The counts this change moves are reconciled through `TOOL-003` (D6). |
| AC-6 | **Reproducible results.** The PR body cites the workflow run URL for the same head SHA it claims, not only local output. | PR body; §7. |

**Status at this revision.** Every criterion is demonstrated, and the run-sourced
half is recorded in §7 against actual runs rather than local output. AC-1, AC-2,
AC-4 and AC-5 are demonstrated as described. AC-3 is demonstrated by a probe commit
that turned the `test` job red on a real run (§7.3) and was then reverted; the
red-to-green pair on the same workflow is the strongest form the criterion can
take. AC-6 is satisfied by the pull request body, which cites the green run URL and
the SHA it belongs to.

This reverses the previous revision's position, and the reversal is the point. At
`14ad34b` GitHub Actions could not start a job on this account — the annotation was
*"The job was not started because your account is locked due to a billing issue."*
That is why the first revision recorded AC-2, AC-3 and AC-6 as not demonstrated.
The lock was cleared by the operator before the reviewed head commit ran, so run
[38610453270](https://github.com/dharmeshprataps/cataloging/actions/runs/38610453270)
executed all four jobs to completion at `1077aeca`. The blocker is history; the
record now says so.

---

## 4. Design decisions

**D1 — Four independent jobs, not one sequential job.** A single job running
typecheck → build → test → e2e stops at the first failure, so a red gate can hide
a red end-to-end run. One job per check means each result is visible on its own,
which is what AC-3 needs to be legible. Cost: four dependency installs, mitigated
by caching the pnpm store against `pnpm-lock.yaml`.

**D2 — Node `24`, the declared floor, not the development runtime.** The host runs
Node 26; `package.json` declares `engines.node >= 24` and `@types/node` is 26.
Pinning the floor in CI means a break on the oldest supported runtime is caught
rather than discovered by whoever installs Node 24 next. `@types/node` being newer
is a compile-time-only difference here: `tsc` reads `node_modules`, not the
runtime.

The pin names the major alone — `node-version: '24'`, not `'24.x'` — because
`'24.x'` re-resolves on every run and would jump the moment the `ubuntu-latest`
label migrates to a new Ubuntu release, adding variance to the very job this change
is judged by. The major is the least specific value that cannot drift *within* a
major: `setup-node` resolves it from the runner's tool cache, and a Node 24 patch
release is not a supported-version change. `runtimeProblems` asserts every job
names the same major, at or above `engines.node`, so the hold is checked rather
than remembered.

**D3 — `corepack enable` rather than a package-manager action.** `package.json`
already pins `packageManager: pnpm@11.7.0`. corepack reads that field, so the
workflow names no pnpm version and cannot drift from the pin. A second version
literal in the workflow is a second source of truth, which is precisely how the
lockfile and the runner drift apart. `COREPACK_ENABLE_DOWNLOAD_PROMPT=0` stops
corepack blocking on an interactive prompt.

**D4 — `permissions: contents: read`, and no secrets.** The gate needs no write
access, and enforcing it needs none. No secret is referenced and no developer
`.env` is read: `tests/setup-env.ts` blanks `GEMINI_API_KEY` and
`scripts/verify-e2e.ts` fakes both external boundaries, so no live Gemini or
WhatsApp spend is possible in CI. `tests/ci-workflow.test.ts` asserts both
properties, so a later edit cannot quietly add either one.

**D5 — `SIM-003` is satisfied by executing its citation, not by re-homing it.**
Discovery question 2 recommended moving the SSE probe into a vitest test and
re-citing `SIM-003` to it. This change does **not** do that, and the divergence is
deliberate:

- AC-2 already requires the workflow to run `pnpm verify:e2e`, so the citation is
  executed by automation as a direct consequence. AC-4's requirement — that no
  requirement's sole evidence is a check no automation runs — is met.
- Re-homing the probe would force edits to `tests/spec-gate.test.ts`, whose
  falsification test for "a requirement claimed as verified without a citing test"
  removes exactly that `// SIM-003` comment from its fixture and asserts the
  fixture still contained it. Moving or deleting the comment breaks that test, so
  the change would have to modify the gate's own falsification evidence — inside
  the area the issue puts out of scope.
- Re-homing changes the requirement's citation source and therefore its declared
  test count in `traceability.yaml`, disturbing counts that PR #6 is already
  moving for `TOOL-001`/`TOOL-002`.
- The rule is mechanised instead: if the `e2e` job, or the step that runs
  `pnpm verify:e2e`, is ever removed **or disabled by an `if:` that is statically
  false**, `tests/ci-workflow.test.ts` fails. That is a stronger guarantee than a
  one-off relocation, because it holds for every future citation source, not just
  this one. Review remediation tightened the rule to the second half of that
  sentence: it originally matched `run:` text alone, so a disabled step still
  counted as executed (§7.3).

This is the one place this specification departs from the discovery
recommendation. It is recorded here rather than silently chosen, and a reviewer
may overturn it.

**D6 — CI enforcement becomes `TOOL-003` in the baseline catalogue.** The first
version of this change asserted its behaviour only in `tests/ci-workflow.test.ts`,
and the gate rejected it: `every test cites at least one requirement` failed on all
fourteen tests, because a test that cites nothing is untraceable. The gate is
scoped to `CHANGE_ID = 'requirements-baseline'`, so the requirement it demands has
to live there — and that is this repository's own precedent, since `TOOL-001` and
`TOOL-002` were added the same way by the change whose first implementation failed
the gate. So the baseline gains `TOOL-003`, cited by every test in the new file,
and the counts move 158/151 → 159/152 in `spec.md` §5, the change README,
`requirements.md`, the root README and `F-003`'s reconciliation. The counts are
read from `pnpm spec:status`, not adjusted by hand.
This is a record-keeping addition forced by the gate, not a scope change: the
acceptance criteria in §3 are unchanged.

**D7 — Triggers.** `pull_request` (default types) and `push` to `main` are
required by AC-2. `workflow_dispatch` is added so a failed run can be retried
without a dummy commit. `concurrency` cancels superseded runs on a pull request
only; pushes to `main` are left to finish, because a merged SHA is a distinct
revision that has never run anything.

---

## 5. Dependency: this change is stacked on PR #6

`run.sh` at `main` still derives its runtime from a hardcoded developer path until
PR #6 (https://github.com/dharmeshprataps/cataloging/pull/6, head `ca7c528`) lands.
A CI job based on `main` alone would therefore be red for a reason that is not this
change's subject, and duplicating PR #6's `run.sh`, `scripts/lib/tooling.ts`,
`scripts/run-tool.mjs` and `tests/tooling.test.ts` here would put two copies of the
same fix in flight and conflict with it.

So this branch is based on `agent/requirements-baseline-findings` and its pull
request targets that branch, not `main`. Consequences, stated so the record is not
misleading:

- This pull request must not merge before PR #6.
- The green run cited in §7 is at a SHA whose parent is PR #6's head, not `main`.
- AC-1 is PR #6's delivery; this change *demonstrates* it on a clean runner rather
  than re-implementing it.

---

## 6. What this change supersedes in the baseline

The baseline is an approved artifact, so a statement it makes that stops being true
is corrected in place and named here, not silently contradicted.

| Superseded statement | Now reads |
|---|---|
| `requirements-baseline/README.md`, limitation 3 — *"No CI job runs the suite or the gate… `pnpm test` must be run by hand."* | Limitation 3 records that it was true at `712a12f`, and that `.github/workflows/ci.yml` (this change) now runs typecheck, build, the suite, the gate and the end-to-end checks on every pull request and every push to `main`. |
| `requirements-baseline/spec.md` §9 — the change is *"minimum infrastructure so the suite and the gate can run in a clean checkout"*, with no CI. | §9 names `ci-traceability-gate` as the change that enforces the suite and gate in CI, and records that the clean-checkout claim now has a runner behind it. |
| `requirements-baseline/spec.md` §10 test plan. | Gains a row for the CI check, naming `.github/workflows/ci.yml` and `tests/ci-workflow.test.ts`. **§10's "prose counts match the index" row stays declared manual**: the gate cannot read prose, and this change does not pretend otherwise. |
| `README.md` §8 (Testing). | Notes that the listed commands now run in CI on every pull request and push to `main`. |
| `requirements-baseline/requirements.md` and `traceability.yaml`. | Gain `TOOL-003` (D6), and the counts they declare move 158/151 → 159/152 in step with §5, the change README, the root README and `F-003`'s reconciliation. |

Limitation 2 (the runtime was unreachable) is corrected by PR #6, not here; this
change records the dependency rather than duplicating the fix.

---

## 7. Evidence

### 7.1 The green run: all four jobs at the reviewed head SHA

Run [38610453270](https://github.com/dharmeshprataps/cataloging/actions/runs/38610453270)
executed **all four jobs to completion** against head
`1077aeca8b50e4ad2359a30f5a0ba6ab1458a965`. The run was created at 17:53:10Z and
its jobs started at 18:07:03Z:

| Job | Result | Started | Completed |
|---|---|---|---|
| `test` | success | 18:07:03Z | 18:07:34Z |
| `typecheck` | success | 18:07:04Z | 18:07:19Z |
| `build` | success | 18:07:04Z | 18:07:18Z |
| `e2e` | success | 18:07:04Z | 18:07:22Z |

`gh pr checks 7` reports `build`, `e2e`, `test` and `typecheck` as `pass` for that
SHA, and the job API shows every step executed through "Complete job". This is
AC-2's green run at the adding pull request's own head SHA, and it is also AC-1's
strongest available demonstration: the runner has no `DSH_RUNTIME_ROOT` and no
developer directory, and the `test` job runs the suite through `./test.sh` there.

### 7.1a The billing lock, and why it is no longer a blocker

An earlier run at `14ad34b`
([38610193975](https://github.com/dharmeshprataps/cataloging/actions/runs/38610193975))
failed 17:51:19Z → 17:51:23Z with **no job started**, annotated *"The job was not
started because your account is locked due to a billing issue."* That is the run
the first revision of this section was written against, and it is why AC-2, AC-3
and AC-6 were recorded as not demonstrated.

The lock was cleared between that push and the head commit's run. The claim the
first revision drew from it — "no workflow in this repository has ever executed" —
was true only until 18:07:03Z on 2026-10-14 and is deleted. Clearing an account
lock is a human action; no agent attempted it, and the operator did not need to
act on this change's behalf for the head commit's run.

| Criterion | State at this revision |
|---|---|
| AC-2, green run at the adding PR's head SHA | **Satisfied** by run [38610453270](https://github.com/dharmeshprataps/cataloging/actions/runs/38610453270), green at `1077aeca` — all four jobs executed. |
| AC-3, failing workflow run URL for the probe | **Satisfied** by run [38613491202](https://github.com/dharmeshprataps/cataloging/actions/runs/38613491202) at `abc35e8`, reverted by `ce2ac30`; see §7.3. |
| AC-6, the PR body cites a run URL for its head SHA | **Satisfied** by the pull request body, which cites the green run at each revision — `1077aeca`, `abc35e8` and `93c06a0` — against the SHA each belongs to. |

### 7.2 Local verification at this revision

```
typecheck    tsc --noEmit -p tsconfig.check.json   clean
build        tsc -p tsconfig.json                  ok
test         vitest 15 files, 259 tests pass; gate RESULT: PASS
             (0 warning(s)) — 159 requirements, 152 verified,
             4 unverified, 3 n/a
verify:e2e   all checks pass (real HTTP, faked boundaries)
```

The test count rose from the 256 recorded at `14ad34b` to 259 because review
remediation adds three falsification cases to `tests/ci-workflow.test.ts` — a
citation reached only through a step disabled with `if: ${{ false }}`, a required
job disabled with `if: false`, and a computed condition that must be left alone.
`TOOL-003`'s declaration in `traceability.yaml` moves with them, 14 citations to
17, so the gate's "declared test citations match the tests that cite them" rule
stays satisfied. The requirement counts are unchanged: 159 requirements, 152
verified, 4 unverified, 3 n/a, read from `pnpm spec:status`.

### 7.3 Falsification (AC-3), as a pushed probe with a real red run

The criterion asks for a broken commit and a failing run URL, so the probe is
pushed rather than run locally. No `// SIM-003` citation, no `SIM-003` evidence, and
the index still claiming `verified` — the exact false-claim failure mode the gate
exists to catch. Removing the comment produces three gate violations, each naming
`SIM-003`:

```
[FAIL] every implemented requirement is covered by at least one test (1)
         - SIM-003 (implemented): no test cites it — add a test or mark it unverified
[FAIL] every requirement marked verified actually has a citing test (1)
         - SIM-003: verification is 'verified' but no test cites it
[FAIL] declared test citations match the tests that cite them (1)
         - SIM-003: traceability.yaml declares 1 test(s) but 0 test title(s) cite it
RESULT: FAIL — 3 error(s)
```

The `test` job runs `pnpm test`, which is `./test.sh run && tsx scripts/spec-status.ts`,
so the gate's failure fails that job: the probe turns the workflow red for the
citation reason, not an environmental one. The comment is restored immediately
afterwards, so the pair is a red-to-green sequence on the same workflow — the
strongest form AC-3 can take. This is also the concrete reason for D5: moving the
citation would have required editing the two `tests/spec-gate.test.ts` tests that use
it as their own falsification fixture.

| Step | Revision | CI run |
|---|---|---|
| Probe: `// SIM-003` removed from `scripts/verify-e2e.ts` | `abc35e8` | [38613491202](https://github.com/dharmeshprataps/cataloging/actions/runs/38613491202) — `test` **failure**; `typecheck`, `build` and `e2e` success |
| Revert of the probe | `ce2ac30` | Green with the review fixes in [38613975075](https://github.com/dharmeshprataps/cataloging/actions/runs/38613975075) |
| Green run at the reviewed head, before the probe | `1077aeca` | [38610453270](https://github.com/dharmeshprataps/cataloging/actions/runs/38610453270) — all four jobs green |
| Green run for the final revision | `93c06a0` | [38613975075](https://github.com/dharmeshprataps/cataloging/actions/runs/38613975075) — all four jobs green, §7.5 |

Run `38613491202`'s `test` job failed with exactly the three errors quoted above and
`pnpm spec:status` exited 1. The other three jobs stayed green, which is the point of
D1's one-job-per-check design: the failure is attributable to the citation and to
nothing else.

### 7.4 The citation guard, corrected

Independent review at `1077aeca` found that the guard named
`unexecutedCitationSources` did not test what its name claims. It string-matched
`run:` lines, so a step that is written down but never executes still counted as
executed — the same class of failure this change exists to close, one level up. The
reviewer's reproduction: with `if: ${{ false }}` on the `pnpm verify:e2e` step, and
again with `if: ${{ false }}` on the whole `e2e` job, the guard still returned no
problems.

The guard now reads each job's own `if:` and each step's own `if:` and treats a
citation source as executed only when it is reached by a step in a job whose
effective condition is not statically false. Both spellings of a literal are
recognised — `if: false` and `if: ${{ false }}`. A condition the expression language
computes from context is deliberately left alone: a static reader cannot decide it,
and guessing would report a working workflow as broken. That residual gap is real
and is stated here rather than implied by the function's name; closing it properly
needs a condition evaluator, which is out of scope for this change (`scripts/verify-spec.ts`
rules are explicitly out of scope in §2). What is closed is the case review
reproduced, and `missingChecks` now also reports a required job disabled by
`if: false` instead of silently accepting it.

### 7.5 The green run for the final revision

The probe, its revert, and the review fixes are validated by run
[38613975075](https://github.com/dharmeshprataps/cataloging/actions/runs/38613975075),
which is green at `93c06a0965afcb9dced2a02dbb2c1b1ded49f5eb` with all four jobs —
`typecheck`, `build`, `test` and `e2e` — concluding `success`. That revision
contains the revert of the probe and every review fix, so the red-to-green pair is
complete on the same workflow: `abc35e8` red on the citation (§7.3), `93c06a0`
green with it restored and the guard corrected.

---

## 8. Test plan

| Check | Method |
|---|---|
| The workflow exists and runs all four required checks, each in its own job | `tests/ci-workflow.test.ts` — `missingChecks`, and the job-id assertion. |
| It triggers on `pull_request`, on `push` to `main`, and can be re-dispatched | `tests/ci-workflow.test.ts` — `triggerProblems`. |
| It uses the Node floor and the package-manager pin `package.json` already declares, with no second version literal | `tests/ci-workflow.test.ts` — `runtimeProblems`. |
| It is read-only and references no secret or developer `.env` | `tests/ci-workflow.test.ts` — `permissionProblems`. |
| No citation source outside the suite carries evidence no CI step executes | `tests/ci-workflow.test.ts` — `unexecutedCitationSources`, over the gate's own `citationSources`. |
| A citation reached only by a statically disabled step or job is not counted as executed | `tests/ci-workflow.test.ts` — the `if: ${{ false }}` step and `if: false` job cases; both were confirmed red before the fix, and are reproduced in §7.4. |
| Each of those rules fails when violated | `tests/ci-workflow.test.ts` — one falsification case per rule, mutating the real workflow text. |
| A broken citation turns CI red | Run [38613491202](https://github.com/dharmeshprataps/cataloging/actions/runs/38613491202), §7.3, then reverted. |
| The suite and the gate still pass, and the baseline counts still reconcile | `pnpm test` locally and in CI; `pnpm spec:status` remains the authority for the counts. |

---

## 9. Open questions

None block implementation. Two are recorded for the reviewer:

1. **Is D5 the right call?** It departs from the approved discovery recommendation
   for `SIM-003` and is argued in full above. If the reviewer prefers the probe
   re-homed into vitest, that is a change to `tests/spec-gate.test.ts` and to
   `SIM-003`'s citation, and it should be its own decision.
2. **Was making CI enforcement a numbered requirement (`TOOL-003`) the right call?**
   It was forced, not chosen: the gate's `every test cites at least one
   requirement` rule rejected the new test file, and the requirement has to live in
   the baseline change because that is what the gate reads (D6, §6). The visible
   consequence is that this change moves the baseline's counts across five
   documents in step with PR #6. If the reviewer prefers the file to be excluded
   from citation checks instead, that is a change to `excludeTestFiles` in
   `scripts/verify-spec.ts` and should be its own decision, because that list
   excludes a file from *every* citation check.

---

## 10. Decision request

Reply `/approve` to authorize implementation, or `/change <instruction>` to revise
this specification.

Status: APPROVED — approved by Dharmesh Pratap Singh on 2026-10-14
(`/approve` on https://github.com/dharmeshprataps/cataloging/issues/4#issuecomment-6174542684,
answering the discovery questions on issue #4). The `Status: APPROVED` row was
recorded by the implementation agent on the operator's explicit in-session
instruction to author this specification and record the approval from that
comment, in the same form the baseline specification used for its own approval.
