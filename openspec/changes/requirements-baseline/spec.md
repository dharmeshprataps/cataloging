# Specification — Requirement baseline and traceability gate

| Field | Value |
|---|---|
| **ID** | `SPEC-REQ-BASELINE` |
| **Title** | Requirement baseline and traceability convention |
| **Change** | `requirements-baseline` |
| **Owner** | Dharmesh Pratap Singh (operator) |
| **Status** | APPROVED |
| **Approved** | 2026-10-14 |
| **Created** | 2026-10-14 |
| **Last modified** | 2026-10-14 |
| **Source classification** | MIXED |
| **Confidence** | MODERATE |
| **Supersedes** | — |
| **Superseded by** | — |
| **Dependencies** | `requirements.md`, `PROBLEMS.md`, `decisions/`, `findings/` |

| Field | Value |
|---|---|
| **Spec** | `openspec/changes/requirements-baseline/spec.md` |
| **Author** | DSH implementation agent (session on `dharmeshprats/cataloging`) |
| **Approved by** | Dharmesh Pratap Singh (operator) |
| **Approval record** | `/approve` on https://github.com/dharmeshprataps/cataloging/pull/2#issuecomment-6173700774 (2026-10-14T16:57:30Z) |
| **Revised** | 2026-10-14 — §1.3, §5, §9, §10, §11 and the header note amended on the operator's instruction to absorb `traceability-gate` and `expand-test-coverage` into this change and to own the implementation the suite exercises. Authorising instruction: *"amend the approved spec to drop that non-goal and own the implementation"*, replying to review https://github.com/dharmeshprataps/cataloging/pull/3#pullrequestreview-5521871745. §2, §3, §4, §6, §7 and §8 are unchanged. |

> **This change carries an implementation, not only documents.** It establishes
> the requirement baseline and the traceability convention, and it lands the
> gate, the test suite, and the product implementation the suite exercises. The
> product code introduces no behaviour the baseline does not already describe;
> the infrastructure files (`Dockerfile`, `fly.toml`, `.env.example`, `run.sh`,
> `test.sh`) exist so the suite and gate can run. See §1.3 and §9.

---

## 1. Goal and non-goals

### 1.1 Goal

Give this repository a **written, checkable baseline of what the system is
supposed to do**, so that every future change can be reviewed against a stated
requirement rather than against the author's intention.

The system under specification is the garment-photo catalogue bot described in
[`README.md`](../../../README.md). As of this change it has a working
implementation and a test suite, but **no specification at all** — every
requirement exists only in code, in test names, and in reviewers' heads.

### 1.2 Why now

The `.agents/skills/requirements-to-spec` role produces a spec *before*
implementation for each new change. That process needs two things this repository
does not yet have:

1. A **baseline** describing behaviour that already exists, so a new spec can
   state what it must not break.
2. A **stable naming scheme** for requirements, so a review comment, a test, and
   a spec line can all refer to the same thing.

Without these, "the reviewer must compare a pull request to that exact approved
specification" (`AGENTS.md`) has nothing to compare regressions against.

### 1.3 Goals and non-goals

This change does three things, and the third is why the first two can be trusted:

1. **It writes the baseline** — a stated requirement for behaviour that already
   exists, so a future spec can say what it must not break.
2. **It lands the gate that enforces the baseline** — an automated checker that
   fails when the catalogue, the citations, or the code drift apart, with a
   falsification test for every one of its rules.
3. **It lands the implementation and the suite the gate measures** — the product
   code, the tests that cite requirement ids, and the infrastructure needed to
   run them.

The third item is deliberate and was approved as part of the baseline. The gate
requires every `implemented` requirement to be cited by a test **in the same
tree** that is not skipped and contains an assertion; a citation that points at
another branch is a pointer, not evidence. That rule cannot be satisfied by a
gate-only diff, so the suite and the code it exercises ship with it.

The implementation is **not new product behaviour** relative to this baseline: it
is the system the baseline describes, written down. No requirement here is
satisfied by code that the baseline does not already state.

Non-goals:

- **Not a redesign.** This spec describes the system as it is. It does not
  propose new product behaviour, and it does not change behaviour to fit a
  document. Where the code and the catalogue disagree, the catalogue records the
  deviation as an open problem (§7) rather than the code being quietly adjusted.
- **Not an approval of current behaviour.** Where the implementation has gaps,
  they are recorded as open problems (§7) and unverified requirements
  (`PROBLEMS.md`) rather than written up as correct.
- **Not a fix for the unwired capabilities.** `WA-009`, the unused vision pass,
  the unread style guide, and the four `unverified` requirements listed in §5 all
  stay open; they are proposed for a follow-on change (§9), not resolved here.
- **Not a replacement for per-change specs.** This is the standing baseline;
  each feature change still gets its own `openspec/changes/<change-id>/spec.md`.

---

## 2. User stories

| # | As a… | I want… | So that… |
|---|---|---|---|
| US-1 | designer (end user) | to send garment photos on WhatsApp and get a model shot back | I can build a catalogue without hiring a photographer or model |
| US-2 | designer | to confirm my style brief before any image is generated | I do not pay for a shot I did not want |
| US-3 | designer | to say "make the light warmer" and have *only* that change | the garment in my catalogue stays consistent across SKUs |
| US-4 | designer | to be told when something failed | I am not left waiting on a silent bot |
| US-5 | developer | to run the whole product locally with no Meta account | I can develop and demo without an external onboarding delay |
| US-6 | reviewer | a stable requirement id to cite in review comments | approval and rejection are traceable to a stated requirement |
| US-7 | maintainer | a specification that states its own uncertainty | I can tell verified behaviour from aspiration |

---

## 3. Functional requirements

The normative requirements live in
[`requirements.md`](requirements.md), categorised as `CONV`, `BATCH`, `BRIEF`,
`GEN`, `ITER`, `MED`, `WA`, `SIM`, `PERSIST`, `CATALOG`, `CFG`, `OBS`, `SEAM`,
`SEC`, `CONTENT` and `COST`.

Requirement ids are `<AREA>-<NNN>` and are **permanent**: never renumbered, never
reused, never deleted. A withdrawn requirement is marked `superseded` rather than
removed, so that an existing citation never silently points at different
behaviour.

Requirement states are:

| State | Meaning |
|---|---|
| `implemented` | Behaviour exists in the code today. |
| `partial` | Exists but is incomplete or unreachable; the gap is named. |
| `deferred` | Deliberately postponed; a problem record explains why. |
| `not_implemented` | Does not exist. |

Verification states are `verified` (a test fails if the behaviour breaks),
`unverified` (implemented but unproven) and `n/a`.

---

## 4. Acceptance criteria

Checkable statements. Each is verifiable without reading the code.

| # | Criterion | Requirement refs |
|---|---|---|
| AC-1 | Every behaviour the system provides is described by at least one requirement with a stable id. | all |
| AC-2 | Every requirement states its implementation state, and `implemented` is never claimed without a named test that fails when the behaviour breaks. | all |
| AC-3 | Requirements that describe no existing behaviour are marked `deferred` or `not_implemented` **and** link a problem record. | `WA-009`, `CONV-008`, `SEC-006` |
| AC-4 | A requirement citing a source outside this repository states the claim class (`EXTERNAL-VERIFIED`) and what would falsify it. | `DEC-0002` |
| AC-5 | Every material document carries the metadata block defined in `templates/METADATA_BLOCK.md`. | all artifacts |
| AC-6 | A specification document can be written for a *new* change without contradicting any requirement here. | §9 |
| AC-7 | Known gaps are recorded in `PROBLEMS.md` with a recommended order, and none is presented as working behaviour. | §7 |
| AC-8 | The baseline states plainly which of its own claims are unverified, so a reader cannot mistake a description for a guarantee. | §5, §7 |

---

## 5. What is verified, and what is not

**Verified (149 of 156 requirements):** each has at least one automated test that
fails if the behaviour breaks, with the test citing the requirement id in its
title. The suite ships in this change (see §9), so the citations resolve to tests
that run in this tree. Coverage spans the conversation state machine, batching,
brief confirmation, generation and iteration, media validation, the inbound and
outbound WhatsApp Cloud API path, the simulator surface, persistence, catalogue
export, configuration, and the security controls around webhook signatures.

**Unverified (4 of 156), recorded as open problems rather than claims:** each is
implemented and cited by a test, but the citing test exercises a substitute
rather than the code the requirement names, so it would still pass if the
behaviour broke. Full detail in the "Unverified requirements" table in
[`PROBLEMS.md`](PROBLEMS.md).

| Requirement | Why the citing test does not prove it |
|---|---|
| `GEN-001` adapter calls `interactions.create` | No test constructs `GeminiImageProvider`; the citing test injects `FakeImageProvider` and asserts the pipeline↔provider contract (`GEN-002`). |
| `GEN-008` transient failure is retried | The retry loop lives only in `GeminiImageProvider`, which no test exercises. |
| `GEN-009` a policy refusal is never retried | `isContentPolicyError` is never executed by any test. |
| `SIM-008` a non-simulator channel does not serve the UI | The only citing test asserts the configured channel, which holds whether or not the 409 branch exists. |

**Not applicable (3 of 156), recorded as open problems rather than claims:**

| Requirement | State | Why it is not implemented |
|---|---|---|
| `WA-009` 24-hour service window | `not_implemented` | The configured window is read nowhere. Meta rejects out-of-window sends server-side. Highest real-world failure risk. |
| `CONV-008` review without an output | `deferred` | The guard exists but is unreachable in normal operation. |
| `SEC-006` unauthenticated media/catalogue endpoints | `deferred` | Unauthenticated by design for local use; must not be exposed publicly. |

The gate's structural rules cannot detect that a citation fails to support its
claim — they check that a non-skipped, asserting test cites the id, never that the
citation is evidence for *that* claim. The four requirements above are therefore
marked by hand, and this limitation is recorded rather than hidden.

Two further claims deserve their own emphasis because they bound everything else:

- **`F-002` — no real image has ever been generated.** Every generation test
  runs against a synthetic provider. The product's central claim (a phone photo
  becomes a publishable model shot) is **unverified**. The live smoke test exists
  and has never been run, for want of an API key.
- **`DEC-0002` — the model selected for generation is a general image model, not
  a purpose-built virtual try-on model.** Garment fidelity is the product's
  promise, and the alternative was deferred on the record, with dissent.

---

## 6. Edge cases and error handling

Requirements covering these are in the catalogue; this section states the
intended behaviour so reviewers can check it.

| Situation | Intended behaviour | Refs |
|---|---|---|
| Duplicate channel delivery | Discarded before any work; no second generation. | `CONV-004`, `SEC-005` |
| Several photos sent as separate events | Batched into one turn; one acknowledgement. | `BATCH-001`–`BATCH-005` |
| Photo with a caption in the same turn | Caption acted on only after every photo is attached. | `BATCH-004` |
| Unreadable / oversized / tiny upload | Rejected before any API call, with a message naming accepted formats. | `MED-005`–`MED-008` |
| Content-policy refusal by the model | Never retried; surfaced as a recoverable brief edit. | `CONTENT-005`, `GEN-009` |
| Timeout or transient upstream failure | Bounded, recorded, and recoverable without losing the brief. | `GEN-008`, `GEN-010`, `GEN-013` |
| Unexpected internal error | The user still receives a reply; silence is not permitted. | `UX-003` |
| Per-item generation budget exhausted | Refused with a way forward, not a silent failure. | `COST-001` |

---

## 7. Known gaps and uncertainty

Full detail in [`PROBLEMS.md`](PROBLEMS.md). Summary, in recommended resolution
order:

1. **P-1 / `WA-009`** — the 24-hour service window is unenforced. The most likely
   real-user failure, partially blocked on an externally approved message
   template.
2. **P-2** — output quality has never been observed. This blocks any rational
   quality roadmap and is **not resolvable by further development**, only by
   looking at real output.
3. **P-6** — the vision garment-description pass exists but is never called, so
   the image model receives a text summary of the garment rather than an
   observation of the photograph. Highest quality leverage; do it **after** P-2 so
   the effect can be judged against output rather than assumed.
4. **P-7** — the brand style-guide column is stored but never read, so catalogue
   consistency across SKUs is unimplemented.
5. **P-3, P-5** — an unreachable review guard, and read receipts implemented but
   never invoked. Both small: wire them or delete them.
6. **P-4** — media and catalogue endpoints are unauthenticated. No impact locally;
   a deployment blocker.
7. **P-8** — a competing specification framework was built and rejected as
   duplicative. Recorded because the reasoning matters more than the outcome.

---

## 8. Technical constraints and assumptions

- **Node ≥ 24** with the built-in `node:sqlite`; no native modules, no compiler
  in the container build.
- **SQLite plus local disk** limits the service to one instance (`DEC-0004`).
  This is a stated product constraint, not a temporary detail.
- **Two external couplings only** — a channel adapter and an image provider
  (`DEC-0001`). Changing either must not require changes to the conversation
  core.
- **Assumption, unverified:** designers will publish model shots produced this
  way. No user research has been conducted. Listed as an assumption in this section.
- **Assumption, unverified:** a ~3-second batching delay is acceptable; it is a
  single configuration value if it is not.
- **Constraint:** generated images carry a Google SynthID watermark with no API
  to remove it. Some brands may reject this.

---

## 9. Scope of this change, and what remains

Two of the three changes originally proposed here are **absorbed into this one**,
because the gate cannot be honest without them:

| Change ID | Status | Scope |
|---|---|---|
| `traceability-gate` | **In this change** | The `AREA-NNN` citation convention, the checker that fails on drift, and its falsification tests (`tests/spec-gate.test.ts`). |
| `expand-test-coverage` | **In this change** | The suite that demonstrates 149 of 156 requirements, including the previously untested outbound WhatsApp Cloud API path. A gate whose citations point at another branch is not evidence, so the suite lands here. |
| `wire-unwired-capabilities` | Still a follow-on | `WA-009`, `F-001` F3 and F5, and the injectable SDK client that would turn `GEN-001`, `GEN-008`, `GEN-009` and `SIM-008` from `unverified` into genuinely verified. |

One change remains genuinely separate. Absorbing it here would make this pull
request unauditable, and it has an external dependency (an approved Meta message
template) that this change does not.

This change does not introduce product behaviour the baseline does not describe.
The product implementation lands with the baseline because the baseline's own
rule requires a citing test in the same tree, and the tests require the code they
exercise. `Dockerfile`, `fly.toml`, `.env.example`, `run.sh` and `test.sh` are
included only so the suite and the gate can run in a clean checkout.

---

## 10. Test plan

This change carries the suite, the gate, and the code they measure. The gate
itself is covered twice: as `tests/spec-gate.test.ts`, where every rule has a
falsification test that makes it fail, and as the `spec:status` CLI, which exits
non-zero on any violation. Prose cannot be checked mechanically, so the
catalogue's counts are kept in step by hand and reconciled against the gate's own
report.

| Check | Method |
|---|---|
| Every requirement id is unique and well-formed | Automated: gate check `requirement ids are well formed`. |
| Every `implemented` requirement names a test | Automated: `every implemented requirement is covered by at least one test`. |
| Every `verified` requirement is falsifiable in principle | Automated in part: the gate proves a non-skipped asserting test cites it. That a citation actually *supports* its claim is a human judgement, and the four known failures are listed in §5. |
| Every `deferred`/`not_implemented` requirement links a problem | Automated: `a not_implemented or deferred requirement links a finding`. |
| Every rule in the gate fails when violated | `tests/spec-gate.test.ts` — one falsification test per rule. |
| Prose counts match the index | Manual: read `./run.sh pnpm spec:status` and compare against §5, `README.md` and `requirements.md`. Not mechanised. |
| No document claims behaviour that contradicts the code | Reviewer compares a sample against `src/`. |
| The specification does not contradict `AGENTS.md` or `openspec/README.md` | Read together. |

---

## 11. Open questions

These need a human decision; the agent has deliberately not assumed an answer.

1. **Is a 156-requirement baseline the right granularity?** It is thorough but
   large. An alternative is a shorter baseline covering only the flows a
   feature spec is likely to regress, with the remainder added as changes touch
   them. The trade-off is completeness now versus review burden now.
2. **Should `openspec/` hold the requirement catalogue, or a separate directory?**
   This spec places it under the change directory. A permanent home such as
   `openspec/baseline/` may be more natural once several changes exist, but that
   is a repository-structure decision, not the agent's to make.
3. **Who accepts the four unverified requirements as they stand?** `GEN-001`,
   `GEN-008`, `GEN-009` and `SIM-008` are implemented but unproven, and closing
   that gap needs an injectable SDK client (product code). Resolving `WA-009`
   additionally needs an approved Meta message template, which is an external
   dependency with lead time.
4. **Is the SynthID watermark acceptable** for published brand imagery? If not,
   it changes the image-provider decision (`DEC-0002`) rather than the bot.
5. **Should the gate be able to detect a citation that does not support its
   claim?** It currently cannot: it proves a non-skipped asserting test cites the
   id, which is what `GEN-001` slipped through. Detecting support mechanically
   would mean binding each requirement to an executable probe, which is a
   substantially larger mechanism than `DEC-0006` describes.

---

## 12. Decision request

Reply `/approve` to authorize implementation, or `/change <instruction>` to
revise this specification.

Status: APPROVED — approved by Dharmesh Pratap Singh on 2026-10-14
(`/approve` on https://github.com/dharmeshprataps/cataloging/pull/2#issuecomment-6173700774).

Revised 2026-10-14 on the operator's instruction to absorb `traceability-gate`
and `expand-test-coverage` into this change and to own the implementation the
suite exercises: §1.3, §5, §9, §10, §11 and the header note were amended. §2, §3,
§4, §6, §7 and §8 are unchanged from the approved revision. The authorising
instruction is quoted in the metadata block above.

**Re-approval note.** The amendments above are not yet re-approved. `AGENTS.md`
says implementation does not begin until a specification carries an explicit
`APPROVED` marker, so this change must not leave draft until a human confirms
this amended revision. The state counts in §5 are read from
`./run.sh pnpm spec:status` at this revision: 149 `verified`, 4 `unverified`,
3 `n/a`, of 156.
