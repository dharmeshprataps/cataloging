# Specifications

Each approved feature lives at `openspec/changes/<change-id>/spec.md`.

Lifecycle:

1. Drafted by the `requirements-to-spec` agent after discovery.
2. Reviewed and explicitly approved by a human.
3. Implemented by the `implement-approved-spec` agent on `agent/<change-id>`.
4. Verified and reviewed against the same specification.
5. Archived after the pull request is merged by a human.

Never reuse an approved specification for unrelated work.
