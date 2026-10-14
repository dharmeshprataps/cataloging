# DEC-0006 — Traceability uses a text convention, not a test-runner feature

| Field | Value |
|---|---|
| **ID** | `DEC-0006` |
| **Title** | Requirement IDs are carried in test titles; the gate parses them |
| **Owner** | Dharmesh Pratap Singh (operator) |
| **Status** | APPROVED |
| **Created** | 2026-10-14 |
| **Last modified** | 2026-10-14 |
| **Spec** | `spec.md` v1.0 |
| **Source classification** | OBSERVED |
| **Confidence** | HIGH |
| **Supersedes** | — |
| **Superseded by** | — |
| **Dependencies** | `DEC-0005` |

## Problem

A traceability gate is only worth having if it cannot silently pass. It needs to
read, from the codebase, which requirements are covered by which tests. The
mechanism must not depend on a runner feature that may be absent — because an
absent mechanism that fails open produces a gate that proves nothing.

## Options considered

1. **Vitest test tags** (`it('…', { tags: ['CONV-004'] }, …)`) and a tag filter.
2. **A leading requirement ID in the test title**, parsed with a regular
   expression.
3. **A hand-maintained mapping file** listing test names per requirement.
4. **No automated gate** — rely on review discipline. _(stop)_

## Evidence

| Claim | Class | Basis |
|---|---|---|
| vitest 3.2.7 accepts a `{ tags: [...] }` argument **and silently discards it** | `OBSERVED EVIDENCE` | Probe: the suite ran and reported 1 passing test, with the tag having no observable effect |
| vitest 3.2.7 has no `--tags-filter`; passing it aborts with a parse error | `OBSERVED EVIDENCE` | Probe: `CAC.parse` failure |
| No `tags` member exists in the installed `@vitest/runner` type declarations | `OBSERVED EVIDENCE` | `grep` over `node_modules/@vitest/runner/dist/*.d.ts` |
| Test titles are unique across the suite | `OBSERVED EVIDENCE` | Duplicate scan returned nothing |
| No existing test title begins with an ID-shaped token | `OBSERVED EVIDENCE` | `grep` for `^[A-Z]{2,6}-[0-9]{3}` returned nothing |

**Option 1 was the obvious design and it was wrong.** Had it been assumed rather
than probed, the gate would have read zero tags, found zero orphans, and passed
everything while proving nothing — the exact failure this decision exists to
prevent. This is the clearest justification for verifying a mechanism before
building on it.

## Assumptions

- Requirement IDs are stable, which makes them safe to embed in test titles.
- A visible ID in a failing test name is useful, not noise.

## Arguments for option 2

- Works with any runner, any language, any future test framework — no coupling to
  vitest internals.
- Zero configuration; greppable by a human.
- A failing test names its requirement in the output, so a red suite is
  self-documenting.
- Fails loudly rather than silently: a malformed ID is simply not found, and the
  gate reports the requirement as uncovered.

## Arguments against option 2

- Renames titles, producing a noisy diff.
- Regex over source for structure is brittle compared with a real API.
- A test may reasonably cover several requirements, which a single leading ID
  expresses poorly.

## Material dissent

None recorded. The residual concern is brittleness: parsing source text is a
weaker mechanism than a runner API. Accepted knowingly, because no runner API
exists here, and a weaker mechanism that works beats a stronger one that does not.

## Risks

- A test title is edited carelessly and the citation is lost, silently reducing
  coverage. Mitigated by the gate failing when a requirement has no citing test.
- Multiple tests citing one requirement is supported; multiple requirements in one
  test title is not, and must be avoided by splitting the test.

## Chosen decision

**Option 2.** A test citing requirement `CONV-004` has a title beginning
`CONV-004`. `spec/verify.ts` parses test titles and `traceability.yaml`, and fails
on any inconsistency. There is no hand-maintained duplicate mapping of test names.

## Reversibility

High. If a future runner supports tags natively, the gate's parser is the only
thing that changes; requirement IDs in titles remain valid.

## Resources committed

One parser plus its falsification tests.

## Success metrics

Fixed before the result:

- The gate fails when a requirement is uncovered. **Must be proven by test.**
- The gate fails when a test cites an unknown requirement. **Must be proven.**
- The gate fails when an `implemented` requirement lacks a test. **Must be
  proven.**
- The gate does not fail when the suite is legitimately green.

A gate that has never been observed failing is not evidence of anything.

## Review date

On upgrading the test runner, or if a test-title citation is ever lost silently.
