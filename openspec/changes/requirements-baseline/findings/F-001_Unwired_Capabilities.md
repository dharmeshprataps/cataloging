# F-001 — Capabilities implemented but never wired in

| Field | Value |
|---|---|
| **ID** | `F-001` |
| **Title** | Code exists for several behaviours that no runtime path reaches |
| **Owner** | Dharmesh Pratap Singh (operator) |
| **Status** | OPEN |
| **Created** | 2026-10-14 |
| **Last modified** | 2026-10-14 |
| **Spec** | `spec.md` v1.0 |
| **Source classification** | OBSERVED |
| **Confidence** | VERIFIED |
| **Supersedes** | — |
| **Superseded by** | — |
| **Dependencies** | `WA-009`, `WA-019`, `CONV-001` |

## Summary

Five capabilities are implemented and tested in isolation, but no runtime path
reaches them. They are recorded here because a future reader will otherwise
assume they work, and because "implemented" in a code review currently means two
different things.

An unwired capability is **worse than an absent one**: it consumes review
attention, implies a guarantee, and fails silently at exactly the moment it is
relied upon.

## Findings

### F1 — The 24-hour service window is not enforced

- **Requirement:** `WA-009` (`not_implemented`)
- **Evidence:** `config.messaging.serviceWindowMs` is declared in
  `src/config.ts` and read **nowhere** in the codebase. `[OBSERVED EVIDENCE]`
- **Impact:** a designer replying more than 24 hours after their last message gets
  a silently failed send. The turn is recorded as an attempt; the user sees
  nothing. Meta rejects it server-side.
- **Severity:** HIGH for real-world use. This is the most likely failure a real
  user will hit first — people do not reply within 24 hours reliably.
- **Required fix:** check the last-inbound timestamp before sending; outside the
  window, send an approved template instead of free-form text. Requires a
  template approved in the Meta dashboard, so it has an external dependency.

### F2 — Read receipts are never invoked

- **Requirement:** `WA-019` (`partial`)
- **Evidence:** `markRead()` is implemented in `src/messaging/whatsapp.ts`, is
  part of the `DeliveryAdapter` interface, and is implemented by the fake
  adapter — but no caller exists anywhere. `[OBSERVED EVIDENCE]`
- **Impact:** no blue ticks. Cosmetic, but it makes the bot feel less responsive
  than it is, and the unused method implies a feature that does not exist.
- **Severity:** LOW.

### F3 — The vision garment pass is implemented but unused on the hot path

- **Requirement:** not represented as a requirement, because it is not behaviour
  the system exhibits. It is a **capability that exists and is not used.**
- **Evidence:** `ImageProvider.describeGarment()` is implemented in
  `src/imaging/gemini.ts` and exercised only by `scripts/smoke-gemini.ts`. The
  pipeline passes `brief.garment` (text the user or the brief parser produced)
  into `buildImagePrompt` as `garmentDescription`, so no vision pass runs during
  a real generation. `[OBSERVED EVIDENCE]`
- **Impact:** the garment description reaching the image model is a *summary*,
  not an observation of the actual photograph. Given that garment fidelity is the
  product's central promise (`DEC-0002`), this is the single highest-value unused
  capability in the codebase.
- **Severity:** HIGH for output quality.
- **Interacts with:** `F-002`. This is the most obvious lever to pull once real
  output can be judged.

### F4 — `collecting_images` is a reachable state that is never entered

- **Requirement:** `CONV-001`
- **Evidence:** the stage exists in `STAGES`, is handled in the text router, and
  is excluded from nothing — but no transition writes it. Uploading photos from
  `idle` moves directly to `collecting_brief`. `[OBSERVED EVIDENCE]`
- **Impact:** misleading to any reader mapping the state machine; a reader will
  assume a "collecting" phase exists where the user is prompted repeatedly.
- **Severity:** LOW, but it is a correctness problem in the spec's own state
  description, so it is recorded rather than quietly dropped.

### F5 — `orgs.style_guide_json` is stored but never read

- **Requirement:** none — the requirement is unimplemented.
- **Evidence:** the column exists in the schema; `createOrg` accepts and stores a
  style guide; `buildImagePrompt` accepts an optional `styleGuide`;
  **no code path passes one.** `[OBSERVED EVIDENCE]`
- **Impact:** brand consistency across a catalogue is unimplemented. Every item is
  prompted with the same default style guide, so a catalogue cannot be made
  visually uniform — which is the difference between a catalogue and a folder of
  images.
- **Severity:** MEDIUM-HIGH for the product's premise.

## What this pattern reveals

Every finding has the same shape: **a seam was built, and then not connected.**
That is not carelessness so much as the predictable result of building the hard,
interesting part (the boundary) before the boring part (the call site).

The traceability gate now makes this class of gap visible: an `unverified`
requirement is a capability nobody has proven works end to end.

## Recommended order

1. **F3** — highest quality leverage, small change, no external dependency.
2. **F1** — highest real-world failure probability, but needs an approved Meta
   template.
3. **F5** — unlocks catalogue consistency, small change.
4. **F2**, **F4** — low severity, cheap to resolve (wire, or delete).

## Status

OPEN. No fix has been attempted. Resolving any item requires either a test that
proves the behaviour (`verified`) or a decision to remove the dead code — silence
is not an acceptable resolution.
