# Problems and known deviations — `requirements-baseline`

Referenced from [`spec.md`](spec.md) §§5 and 7. Every requirement that is not
`implemented` links here, so a reader cannot mistake a gap for working behaviour.

Ordered by recommended resolution priority.

---

## P-1 — The 24-hour service window is not enforced

| | |
|---|---|
| **Requirement** | `WA-009` (`not_implemented`) |
| **Severity** | **HIGH** — the most likely real-user failure |
| **Effort** | Small, but has an external dependency |

`config.messaging.serviceWindowMs` is declared and read **nowhere**. Meta
enforces the customer-service window server-side, so a reply sent more than 24
hours after the user's last message is rejected with an API error. The user sees
silence; the log shows a failure.

**Why it matters most:** people do not reply within 24 hours reliably. A designer
who goes to bed mid-conversation and replies the next evening gets nothing.

**Correction:** record the last inbound timestamp, check it before sending, and
outside the window send an approved message template instead of free-form text.
Blocked in part on a template being approved in the Meta dashboard, which is a
lead-time item outside this repository.

---

## P-2 — No real image has ever been generated

| | |
|---|---|
| **Requirement** | none — this is an absence of evidence, not a behaviour |
| **Severity** | **HIGH** — bounds every quality decision |
| **Effort** | One API key and one hour |

Every generation test runs against a synthetic provider returning a flat-colour
PNG. The live smoke test exists and **has never been executed**, for want of a
`GEMINI_API_KEY`.

**The unverified claim:** *a photo of a garment on a hanger can become a
publishable catalogue image of that same garment on a model.*

**How to falsify it:** run the smoke test on three real garments — one complex
print, one plain dark fabric, one with fine detail such as lace trim. Prints and
dark fabrics are where general image models fail first.

**Why this blocks decisions:** prompt strategy, the revision-versus-regeneration
choice, the model selection, and whether the unused vision pass matters are all
currently guesswork. Roadmap priority cannot be set rationally until someone looks
at real output. **This is not resolvable by further development.**

---

## P-3 — Review-without-output guard is unreachable

| | |
|---|---|
| **Requirement** | `CONV-008` (`deferred`) |
| **Severity** | LOW |
| **Effort** | Trivial — either reach it or delete it |

The guard that reports "no shot to work from yet" exists, but no reachable path
leaves the session in `review` without an output. A failed first generation
returns to `confirm_brief` instead (`GEN-014`).

**Correction:** decide whether the guard protects a path that can exist. If it
cannot, remove it; an unreachable branch implies a state the system does not
have, which misleads the next reader.

---

## P-4 — Media and catalogue endpoints are unauthenticated

| | |
|---|---|
| **Requirement** | `SEC-006` (`deferred`) |
| **Severity** | MEDIUM once deployed; none locally |
| **Effort** | Moderate — needs an auth decision |

`GET /media/:assetId` and `GET /api/catalog` permit access by "knowing the UUID"
and have no authentication. They exist to serve the local simulator.

**Current safeguard:** the limitation is documented in the project README, and the
default channel is the simulator rather than an internet-facing one. Nothing in
the code enforces it.

**Correction:** before exposing the service publicly, add authentication, or serve
these routes only on a private interface. Requires a decision about user accounts
that is out of scope here.

---

## P-5 — Read receipts are implemented but never invoked

| | |
|---|---|
| **Requirement** | `WA-019` (`partial`) |
| **Severity** | LOW — cosmetic |
| **Effort** | Trivial |

The read-receipt method is part of the channel interface and implemented by both
adapters, but nothing calls it. No blue ticks. The unused method implies a feature
that does not exist.

**Correction:** call it on inbound message receipt, or remove it from the
interface. Silence is the wrong answer.

---

## P-6 — The vision garment pass is implemented but not used on the hot path

| | |
|---|---|
| **Requirement** | none — a capability that exists and is not wired |
| **Severity** | **HIGH for output quality** |
| **Effort** | Small |

`ImageProvider.describeGarment()` is implemented and exercised only by the smoke
test. The pipeline passes the *brief's* garment text to the prompt builder, so no
vision pass runs during a real generation.

**Why it matters:** the garment description reaching the image model is a
*summary*, not an observation of the actual photograph — while garment fidelity is
the product's central promise. This is the single highest-leverage unused
capability in the codebase.

**Correction:** run the vision pass on the uploaded references and feed its output
into the prompt. Costs one extra text-model call per item. **Do this only after
P-2**, so the improvement can be judged against output rather than assumed.

---

## P-7 — The brand style guide is stored but never read

| | |
|---|---|
| **Requirement** | none — unimplemented |
| **Severity** | MEDIUM-HIGH for the product premise |
| **Effort** | Small |

The style-guide column exists in the schema and the prompt builder accepts an
optional style guide, but **no code path passes one**, so every item is prompted
with the same default. A catalogue cannot be made visually uniform — which is the
difference between a catalogue and a folder of images.

**Correction:** read the organisation's style guide and pass it through. Small
change, meaningful product effect.

---

## P-8 — Rejected approach: a competing spec framework

Recorded for completeness, because it was built and then rejected.

A full alternative framework was constructed before this repository's own
spec-driven workflow was discovered: a `spec/` tree with a 156-requirement set, a
`traceability.yaml` index, a text-based citation convention, and a checker with
falsification tests. It also carried 125 new tests raising coverage from 83 to
208.

**It was rejected as a competing framework, not on quality.** It duplicated
`AGENTS.md`, invented a second spec location, and added a second gate — two of
everything, which is worse than either alone. Its substantive content has been
folded into this change.

**What is preserved:** the requirement set, the decision records, and the
findings are in this change directory. The test suites that were on the local
branch `local/spec-framework-wip` now ship **in this change**, absorbed together
with the gate; there is no separate `expand-test-coverage` change.

---

## Unverified requirements

Four requirements are `implemented` and carry a citing test, yet no test would
fail if the behaviour broke. The gate reports them as
`UNVERIFIED REQUIREMENTS (4) — implemented, unproven` and points here.

| Requirement | Why the citing test does not prove it |
|---|---|
| `GEN-001` — the adapter calls `interactions.create` once per generation | No test constructs `GeminiImageProvider`. The citing test injects `FakeImageProvider` and asserts the pipeline↔provider contract (`GEN-002`), so the adapter body could `throw` and the suite would still pass. |
| `GEN-008` — a transient failure is retried with backoff | The retry loop lives only in `GeminiImageProvider`, which no test exercises; the citing test injects `FakeImageProvider`. |
| `GEN-009` — a content-policy refusal is never retried | `isContentPolicyError` is never executed by any test for the same reason. |
| `SIM-008` — a non-simulator channel does not serve the simulator UI | The only citing test asserts the configured channel, which holds whether or not the 409 branch exists. |

These are recorded rather than claimed. A false `verified` would be worse than an
unverified one, because it would hide the gap: `GEN-001` in particular carries the
"we call the Gemini interactions API" claim, and the gate's structural rules
cannot detect that a citation fails to support its claim.

**Correction, for all four:** inject the SDK client — mirroring the
injected-credentials/`fetch` seam in `src/messaging/whatsapp.ts` — then assert the
concrete call: one `interactions.create` with the configured model and a returned
image plus interaction id (`GEN-001`), the retry count and backoff on a transient
error (`GEN-008`), no retry on a policy refusal (`GEN-009`), and the 409 for a
non-simulator channel (`SIM-008`). This is product code and belongs to a
follow-on change (`wire-unwired-capabilities`), not to the baseline itself.

Closely related: **P-2** records that no real image has ever been generated, which
is the outcome-level version of the same absence of evidence.

---

## Not a problem, but worth stating

- **SynthID watermark.** Generated images carry a Google watermark with no API to
  remove it. This is a property of the model, not a defect in this system, and it
  may affect brand acceptance.
- **Single instance.** SQLite plus local disk means the service cannot scale
  horizontally. Stated as a product constraint, not an oversight
  (`DEC-0004`).
- **Cost figures are estimates.** Per-image cost is a hardcoded table used for
  logging, never reconciled against an invoice.
