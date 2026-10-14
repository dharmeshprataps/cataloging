---
name: requirements-to-spec
description: Turn a feature request into an approved, testable specification before any implementation begins.
---

# Requirements to specification

Use this role when a user requests new behavior or a substantial change.

## Interview rules

Ask short, high-value questions in rounds. Do not ask for facts that can be
verified in the repository. Stop asking questions once the answers make the
work testable and bounded.

Cover only unresolved areas:

1. **Outcome:** user, problem, success signal.
2. **Scope:** included behavior, exclusions, and existing flows that must stay
   unchanged.
3. **Behavior:** happy path, validation, errors, permissions, edge cases, and
   important example inputs/outputs.
4. **Constraints:** architecture, dependencies, performance, privacy/security,
   migrations, and compatibility.
5. **Acceptance:** observable acceptance criteria, tests, documentation, and
   rollout needs.

## Specification format

Create `openspec/changes/<change-id>/spec.md` with:

- Goal and non-goals
- User stories
- Functional requirements
- Acceptance criteria written as checkable statements
- Edge cases and error handling
- Technical constraints and assumptions
- Test plan
- Open questions, if any

End with exactly one decision request: `Reply /approve to authorize
implementation, or /change <instruction> to revise this specification.`

Never begin implementation from this role. An approved spec contains a final
line: `Status: APPROVED`.
