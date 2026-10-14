# F-003 — Requirement normalization gaps: 43 requirements are unverified

| Field | Value |
|---|---|
| **ID** | `F-003` |
| **Title** | 43 of 156 requirements are implemented but unproven; 32 sit here |
| **Owner** | Dharmesh Pratap Singh (operator) |
| **Status** | OPEN |
| **Created** | 2026-10-14 |
| **Last modified** | 2026-10-14 |
| **Spec** | `spec.md` v1.0 |
| **Source classification** | OBSERVED |
| **Confidence** | VERIFIED |
| **Supersedes** | — |
| **Superseded by** | — |
| **Dependencies** | `DEC-0005`, `DEC-0006` |

## Summary

**This finding is the record of a moment in normalization, not the current
state.** When the catalogue was first normalised, the gate reported **156
requirements: 153 `implemented`, 1 `not_implemented`, 2 `partial`, and 43
`unverified`.**

`unverified` means: code exists, the requirement is met as far as inspection
shows, and **no automated test would fail if it silently broke.** 43 requirements
was roughly a third of the system's specified behaviour that could regress
without anyone noticing.

Most of those 43 are now genuinely verified — see "Count reconciliation" below
for the current figures and what is left. The grouped findings underneath are
retained because they explain *why* each group was hard to test, which is still
the honest context for the four that remain.

This artifact is the catch-all finding referenced by those requirements. It
exists so that `unverified` is an honest, visible status rather than a quiet
omission — which is the entire point of `DEC-0005` and `DEC-0006`.

## Why this is not a defect

`unverified` is not the same as broken. Most of these are structural properties —
"SQLite is used", "the schema covers every entity" — which are trivially true by
inspection and are awkward to assert without writing tests that restate the
implementation. Writing a test that asserts `src/media/store.ts` is an `interface`
proves nothing a reader cannot see.

The honest position is: **these are believed, inspected, and untested.** Marking
them `verified` would be a false claim, and the gate exists to prevent exactly
that.

## Grouped findings

### G1 — Persistence (10) — highest risk

`PERSIST-001` … `PERSIST-010`, except `PERSIST-010` which is covered indirectly.

The most consequential is **`PERSIST-008` — blob keys cannot escape the storage
root.** Path-traversal protection is implemented (`safeJoin`, verified by
reading) and tested by nothing. A regression here is a file-system read outside
the storage directory.

**Recommended:** add tests for `PERSIST-008` (traversal refused) and `PERSIST-009`
(write is atomic) — both are cheap, both describe real security and durability
properties, and neither restates the implementation.

### G2 — WhatsApp outbound path (6)

`WA-015` … `WA-018`, `WA-020`, plus `WA-019`.

The outbound Cloud API calls — sending text, uploading media before referencing
it, the two-hop authenticated media download, version pinning, and recording
deliveries — have **never been exercised against Meta, not even against a mock of
Meta's HTTP responses.** They are covered only by the `FakeAdapter`, which
replaces the code under discussion rather than testing it.

**This is the most concerning gap in terms of shipping risk:** the inbound path
has thorough tests, and the outbound path has none. A unit test with a stubbed
`fetch` would close most of it without any credentials.

### G3 — Configuration (6)

`CFG-001`, `CFG-003` … `CFG-008`.

Notably **`CFG-001` is verified by observation, not by test:** booting with
`PORT=0` was manually confirmed to fail fast and name the offending variable. That
is a real, valuable behaviour with no regression protection.

**Recommended:** tests for `CFG-001` (invalid config refuses to boot, naming the
variable) and `CFG-003` (WhatsApp channel without credentials refuses to boot).

### G4 — Generation mechanism (6)

`GEN-006` … `GEN-008`, `GEN-010`, `GEN-011`, `GEN-015`.

Prompt construction, retry/backoff, timeout enforcement, interaction-id capture,
and passing aspect ratio through.

**Recommended:** `GEN-008` and `GEN-010` are testable with a fake provider that
fails or hangs deterministically, and both protect against real failure modes
(runaway retry cost, a hung turn).

### G5 — Simulator and observability (7)

`SIM-003`, `SIM-006`, `SIM-008`, `OBS-001`, `OBS-003`, `OBS-005`, `CATALOG-005`.

SSE delivery, blob serving, the disabled-simulator 409 path, logging shape, and
which output becomes the hero. Low risk individually; `CATALOG-005` matters
because the wrong hero would be user-visible.

### G6 — Housekeeping (8)

`UX-003`, `CONV-020`, `BRIEF-006`, `MED-004`, `COST-003`, `SEC-003`, `SEC-004`,
`SIM-001`.

- `UX-003` ("no turn ends in silence") is a charter principle (Principle 4) with no
  test. **Recommended:** this one is worth testing — the error path is exactly
  where silence creeps in.
- `SEC-003` (secrets never committed) is enforced by audit and `.gitignore`, not by
  a test. Acceptable, but a CI secret-scan would make it mechanical.

### G7 — Resolved during normalization

- **A dead method contradicted the enforced budget.** `Repo.countGenerations()`
  counted rows in `generations`, while the limit the pipeline actually enforces is
  `sessions.generation_count`, incremented by `incrementGenerationCount()`. Two
  sources of truth for one budget, and the method had no callers. **Removed.** The
  session counter is now the only source of truth for `COST-001`.
- **WA-015 … WA-020 are no longer unverified.** The entire outbound Cloud API path
  now has 15 tests against an injected `fetch`, asserting URL, method, bearer
  token, and request body for text, media upload, image send, the two-hop media
  download, read receipts, error surfacing, and API-version pinning. No
  credentials and no network are required.

## Count reconciliation

**At this revision:** 159 requirements — 152 `verified`, 4 `unverified`
(`GEN-001`, `GEN-008`, `GEN-009`, `SIM-008`), 3 `n/a` (`WA-009`, `CONV-008`,
`SEC-006`). `./run.sh pnpm spec:status` is authoritative for the individual
statuses and regenerates the list; `PROBLEMS.md` carries the per-requirement
reason in its "Unverified requirements" table.

**At normalization time (this finding's original figures):** 43 `unverified` —
41 requirements marked `unverified` in `traceability.yaml` plus 2 `n/a`
(`WA-009` `not_implemented`, `SEC-006` `partial`). The prose in this artifact
groups them by theme; that grouping is why the jump from 43 to 4 is explainable
rather than suspicious: the suite that landed with the gate turned most of them
into real citations, and the ones that could not be honestly cited were either
recorded as `unverified` with a gap or are still open.

The four that remain are not untested-by-oversight: each has a citing test, and
each of those tests substitutes a fake for the code the requirement names. See
`PROBLEMS.md` for the correction each one needs.

## What would resolve this artifact

Not "write a test for each". Most valuable first:

1. `PERSIST-008`, `PERSIST-009` — security and durability.
2. `WA-015`–`WA-018`, `WA-020` — the entire outbound channel, with a stubbed
   `fetch`.
3. `CFG-001`, `CFG-003` — boot-time failure behaviour.
4. `UX-003` — the charter's "always reply" principle.
5. `GEN-008`, `GEN-010` — runaway cost and hangs.

That would take `unverified` from 43 to roughly 30 and cover every gap with real
consequence. The remainder are structural properties that may reasonably stay
`unverified` with an explanation.

## Status

OPEN. Deliberately not closed by lowering standards: these requirements stay
`unverified` until a test proves them, or they are removed with a decision.
