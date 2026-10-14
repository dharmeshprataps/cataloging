# DeepSeek Harness + GitHub setup

## What is already in this repository

- Repository-local DSH skills for requirements, implementation, and independent
  review.
- An Issue form, PR template, and CI policy that requires an approved-spec
  reference before review.
- A phone-control protocol based on GitHub Issues and PRs.

DeepSeek Harness discovers skills below `.agents/skills` when a session runs
from this repository.

## Local DSH configuration

1. Open this repository as a DSH workspace.
2. Keep the selected specification-driven workflow for proposal, approval,
   implementation, verification, and archive.
3. Use the `requirements-to-spec` skill for Issue discovery, the
   `implement-approved-spec` skill only after approval, and the
   `review-pull-request` skill only in a fresh read-only session.
4. Use `deepseek-flash` for requirements and implementation. For maximum
   independence, configure a different provider/model for review; otherwise use
   a separate DeepSeek session and reviewer GitHub identity.

## GitHub identities and permissions

Create separate identities or GitHub Apps:

| Identity | Permissions | Prohibited |
| --- | --- | --- |
| Implementer | Contents read/write; Issues read/write; Pull requests read/write; Actions read | Merge, admin, secrets, branch protection |
| Reviewer | Contents read; Pull requests read/write; Actions read | Push, merge, admin, secrets |

Protect `main`: require the Agent policy check and one review; disallow direct
pushes and automatic merge.

## Webhook for phone-triggered automation

Use a dedicated DSH webhook listener and an HTTPS tunnel that forwards only its
`/github` endpoint. Configure GitHub webhooks for `issues`, `issue_comment`,
and `pull_request`; use a long random secret and validate every signature.

Route only these events from `dharmeshprataps/cataloging`:

- New `agent:discovery` Issues → requirements agent
- `/approve`, `/change`, `/status`, `/stop`, `/archive` Issue comments → active
  specification workflow
- `pull_request.ready_for_review` or `/review` → reviewer agent

The stock DSH GitHub review rule is read-only and reports inside DSH. Add a
small GitHub API bridge only after the reviewer session produces structured
findings; it may submit review comments or approval, but never merge.
