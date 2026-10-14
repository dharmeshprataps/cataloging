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

> **This specification is documentation only.** It establishes the requirement
> baseline and the traceability convention for the existing system. It contains
> **no source changes**. The implementation that satisfies it, and the
> traceability gate that enforces it, are proposed as **follow-on changes** (see
> §9). This keeps the change reviewable and respects the rule that implementation
> begins only after approval.

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

### 1.3 Non-goals

- **Not an implementation change.** No file outside `openspec/` and `.gitignore`
  is modified.
- **Not a redesign.** This spec describes the system as it is. It does not
  propose new product behaviour.
- **Not an approval of current behaviour.** Where the implementation has gaps,
  they are recorded as open problems (§7) rather than written up as correct.
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

**Verified (153 of 156 requirements):** each has at least one automated test that
fails if the behaviour breaks, with the test citing the requirement id in its
title. That suite currently sits on an unmerged branch (see §9): this change
carries the specification and the evidence index, not the tests themselves, so
that the baseline can be reviewed on its own merits. Coverage spans the conversation state machine, batching, brief
confirmation, generation and iteration, media validation, the inbound and
outbound WhatsApp Cloud API path, the simulator surface, persistence, catalogue
export, configuration, and the security controls around webhook signatures.

**Not verified (3 of 156), recorded as open problems rather than claims:**

| Requirement | State | Why it is not verified |
|---|---|---|
| `WA-009` 24-hour service window | `not_implemented` | The configured window is read nowhere. Meta rejects out-of-window sends server-side. Highest real-world failure risk. |
| `CONV-008` review without an output | `deferred` | The guard exists but is unreachable in normal operation. |
| `SEC-006` unauthenticated media/catalogue endpoints | `deferred` | Unauthenticated by design for local use; must not be exposed publicly. |

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

## 9. Follow-on changes (not part of this one)

This specification deliberately contains no implementation. Once approved, it
authorises these separate changes, each with its own spec:

| Proposed change ID | Scope |
|---|---|
| `traceability-gate` | The `AREA-NNN` citation convention, the checker that fails on drift, and its falsification tests. |
| `expand-test-coverage` | Land the tests that demonstrate the 153 verified requirements, including the previously untested outbound WhatsApp path. |
| `wire-unwired-capabilities` | `WA-009`, `F-001` F3 and F5. |

Proposing these separately follows `AGENTS.md` ("keep each pull request focused on
one approved specification") and means a reviewer can reject the baseline without
also rejecting the tests.

---

## 10. Test plan

This change adds documentation only, so it has no code tests. Verification of the
specification itself is by review:

| Check | Method |
|---|---|
| Every requirement id is unique and well-formed | Manual pass over `requirements.md`; automated in the follow-on `traceability-gate` change. |
| Every `implemented` requirement names a test | Catalogue `Status` column; automated in `traceability-gate`. |
| Every `deferred`/`not_implemented` requirement links a problem | Same. |
| No document claims behaviour that contradicts the code | Reviewer compares a sample against `src/`. |
| The specification does not contradict `AGENTS.md` or `openspec/README.md` | Read together. |

The follow-on `traceability-gate` change will make the first three mechanical.

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
3. **Who confirms the three unverified requirements are acceptable?** Resolving
   `WA-009` needs an approved Meta message template, which is an external
   dependency with lead time.
4. **Is the SynthID watermark acceptable** for published brand imagery? If not,
   it changes the image-provider decision (`DEC-0002`) rather than the bot.

---

## 12. Decision request

Reply `/approve` to authorize implementation, or `/change <instruction>` to
revise this specification.

Status: APPROVED — approved by Dharmesh Pratap Singh on 2026-10-14
(`/approve` on https://github.com/dharmeshprataps/cataloging/pull/2#issuecomment-6173700774).
Recorded here by the implementation agent; §1–§12 are unmodified from the
reviewed revision.
