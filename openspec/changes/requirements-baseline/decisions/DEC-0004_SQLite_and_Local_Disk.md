# DEC-0004 — SQLite and local disk, single instance

| Field | Value |
|---|---|
| **ID** | `DEC-0004` |
| **Title** | Persist to SQLite and the local filesystem, accepting a single-instance constraint |
| **Owner** | Dharmesh Pratap Singh (operator) |
| **Status** | APPROVED |
| **Created** | 2026-10-14 |
| **Last modified** | 2026-10-14 |
| **Spec** | `spec.md` v1.0 |
| **Source classification** | OBSERVED |
| **Confidence** | HIGH |
| **Supersedes** | — |
| **Superseded by** | — |
| **Dependencies** | `DEC-0001`, `PERSIST-001`, `PERSIST-007` |

## Problem

The service needs durable conversation state and image storage, and must deploy
somewhere cheap without an operations burden.

## Options considered

1. **Managed Postgres plus object storage** from the start. Correct at scale,
   adds a database dependency and a bucket to every local run. _(defer)_
2. **SQLite via `node:sqlite` plus local disk**, with a blob-store interface for
   later replacement.
3. **In-memory state only.** _(stop — a webhook service is redeployed; state
   would be lost mid-conversation)_

## Evidence

| Claim | Class | Basis |
|---|---|---|
| `node:sqlite` ships with Node and requires no native compilation | `OBSERVED EVIDENCE` | `PERSIST-001`; the container builds with no compiler |
| Session state is reloaded around every pipeline step | `OBSERVED EVIDENCE` | `PERSIST-005`; `spec.md` |
| Blob access is behind an interface | `OBSERVED EVIDENCE` | `PERSIST-007`; `src/media/store.ts` |
| Two replicas over one SQLite file is unsafe | `REASONED INFERENCE` | WAL semantics; documented in the README |

## Assumptions

- Initial volume is one brand or a handful, not thousands of concurrent users.
- A single instance is an acceptable operational shape because Meta needs one
  stable public HTTPS endpoint anyway.

## Arguments for option 2

- No native modules, so the container image stays small and the build cannot fail
  on a compiler.
- Zero external services locally: `./run.sh pnpm dev` and nothing else.
- The migration path is explicit rather than incidental: the schema is written
  portably and blobs are behind an interface.

## Arguments against option 2

- **Hard scaling ceiling.** No horizontal scale-out is possible.
- Backup and restore are the operator's problem.
- A container restart without a mounted volume loses everything — including the
  catalog.

## Material dissent

None recorded. The relevant caveat is that the single-instance limit is a real
product constraint, not a temporary implementation detail, and it must be stated
to any future operator rather than discovered.

## Risks

- **Data loss without a volume.** Mitigated by the deployment configuration
  mounting `/data` and the README stating it.
- Silent migration pain when Postgres becomes necessary.

## Chosen decision

**Option 2.** `node:sqlite` for structured data, a `BlobStore` interface with a
filesystem implementation for images, and a documented single-instance limit.
Option 1 is deferred with the interface already in place.

## Reversibility

Moderate. The blob store is already behind an interface; the schema is portable;
but the repository's SQL is written for SQLite and would need review.

## Resources committed

One persistent volume in deployment.

## Success metrics

Fixed before the result:

- The service boots with no external services running. **Holds.**
- The container builds without a compiler. **Holds — no native dependencies.**
- Swapping the blob store requires no change above `src/media/store.ts`. **Holds
  by interface construction; untested against a real second implementation.**

## Review date

On the first requirement for horizontal scale, or on the first production data
loss, whichever comes first.
