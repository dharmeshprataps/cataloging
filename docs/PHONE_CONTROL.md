# Phone control protocol

Use GitHub Mobile with this private repository as the remote control plane. Do
not expose the DeepSeek Harness web UI to the public internet.

## Start work

Create a **Feature request** issue. The requirements agent replies with focused
questions. Answer in issue comments.

## Commands

Post one command as its own comment:

| Command | Result |
| --- | --- |
| `/approve` | Mark the current specification approved and start implementation. |
| `/change <instruction>` | Revise the specification before implementation. |
| `/status` | Report phase, active branch/PR, checks, and blockers. |
| `/review` | Start an independent review of a ready PR. |

## Updates you will receive

The agents update the Issue or PR only on state changes: specification ready,
waiting for approval, implementation started, tests passed/failed, draft PR
opened, review requested, review approved, or review changes requested.

Enable GitHub Mobile notifications for **Participating** and **Mentions**. The
agents should mention the issue author only when they need an answer, approval,
or a decision.
