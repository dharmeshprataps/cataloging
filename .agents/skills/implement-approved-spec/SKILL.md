---
name: implement-approved-spec
description: Implement one explicitly approved repository specification in a focused branch and draft pull request.
---

# Implement an approved specification

Use this role only when `openspec/changes/<change-id>/spec.md` exists and ends
with `Status: APPROVED`.

## Procedure

1. Read the approved specification, `AGENTS.md`, and relevant existing code.
2. Create a branch named `agent/<change-id>` from the current `main`.
3. Implement only the approved scope. If the spec conflicts with the codebase or
   is incomplete, stop and request clarification rather than guessing.
4. Add or update focused automated tests.
5. Run the relevant checks and report the exact outcome.
6. Commit clear, reviewable changes, push the branch, and open a **draft** pull
   request using the repository template.
7. Post a concise issue update with the branch, PR URL, tests run, and any
   limitation.

## Boundaries

- Never push to `main`, force-push, merge, modify CI permissions, or read/write
  secrets.
- Never change the approved spec to justify an implementation decision.
- Do not mark a PR ready for review; the human requester does that.
