# Requirement catalogue — `requirements-baseline`

| Field | Value |
|---|---|
| **ID** | `REQ-CATALOGUE` |
| **Title** | Normative requirement catalogue for `SPEC-REQ-BASELINE` |
| **Owner** | Dharmesh Pratap Singh (operator) |
| **Status** | APPROVED |
| **Created** | 2026-10-14 |
| **Last modified** | 2026-10-14 |
| **Spec** | `spec.md` v1.0 |
| **Source classification** | OBSERVED |
| **Confidence** | VERIFIED |
| **Supersedes** | — |
| **Superseded by** | — |
| **Dependencies** | `spec.md`, `traceability.yaml`, `PROBLEMS.md` |

Normative requirement text for [`SPEC`](spec.md). Ids are `<AREA>-<NNN>`,
permanent, never renumbered or reused.

## Status vocabulary

`implemented` · `partial` · `deferred` · `not_implemented` · `superseded`

Verification: `verified` (a test fails if the behaviour breaks) · `unverified`
(implemented but unproven) · `n/a`.

## Coverage

**158 requirements** — 154 `implemented`, 1 `partial`, 2 `deferred`,
1 `not_implemented`. **151 verified**, **4 `unverified`**, **3 `n/a`**.

The catalogue held 156 when the baseline was approved; `TOOL-001` and `TOOL-002`
were added by this change when its own first implementation failed them. They
describe the gate's artifact scan and `run.sh`'s runtime selection, both
implemented and tested in this tree.

The `unverified` set is `GEN-001`, `GEN-008`, `GEN-009`, `SIM-008`: each is
implemented, and each has a non-skipped asserting test that cites it, but that
test exercises a substitute rather than the code the requirement names, so it
would still pass if the behaviour broke. The `n/a` set is `WA-009`, `CONV-008`,
`SEC-006`: each describes behaviour that does not exist.

Coverage is not proof. Every `implemented` requirement is cited by a test, but
for the four above the citation is a pointer rather than evidence. All seven
deviations are recorded in [`PROBLEMS.md`](PROBLEMS.md), including the
"Unverified requirements" table that the gate's own report points readers to.

---

# Conversation state machine (`CONV`)

Stages: `idle → collecting_brief → confirm_brief → generating → review →
approved | cancelled`.

### CONV-001 — Stages exist and are formally enumerated

`idle`, `collecting_images`, `collecting_brief`, `confirm_brief`, `generating`,
`review`, `approved`, `cancelled`.

**Acceptance:** the stage set is a single exported constant used by both storage
and control flow; an unknown stage cannot be written.

### CONV-002 — Terminal sessions are not resumed

`approved` and `cancelled` are terminal. The next inbound message opens a fresh
session; history is retained but not continued.

**Acceptance:** given a session in `approved`, an inbound message creates a new
active session with stage `idle`.

### CONV-003 — An idle user is asked for garment photos

With no open item, any non-command message results in a request for garment photos
rather than an error.

**Acceptance:** idle + arbitrary text ⇒ outbound text asking for the photo.

### CONV-004 — Duplicate channel deliveries are suppressed before any work

The channel message id is recorded with a uniqueness constraint. A repeated
delivery is discarded **before** any generation, download, or state change.

**Acceptance:** the same message id delivered twice produces exactly one
observable turn and no additional generation.

### CONV-005 — A confirmed brief returns the conversation to review

After a successful first generation the session is in `review` and the output
reference is stored.

**Acceptance:** `confirm_brief` + `go` ⇒ session stage `review`,
`last_output_asset_id` set.

### CONV-006 — Review accepts numbered commands

`1` approve · `2` revise · `3` variations · `4` details · `5` cancel.

**Acceptance:** each digit produces its documented effect.

### CONV-007 — Review accepts named commands and the `go` alias

Including `approve`, `looks good`, `revise`/`edit`/`change`,
`variations`/`vary`/`more`, `details`, `cancel`/`stop`, and `go`/`again`/`redo`
as regenerate.

**Acceptance:** word forms are equivalent to their digit form.

### CONV-008 — Review requires an existing output

With no current output, review commands report that nothing is available rather
than failing or generating from nothing.

**Status:** `deferred`. **Acceptance:** satisfied by a defensive guard that is
unreachable in normal operation. See [`PROBLEMS.md`](PROBLEMS.md) P-3.

### CONV-009 — Unrecognised review text is treated as revision feedback

Free text during `review` is the most likely revision instruction, so it is
applied as a revision rather than rejected.

**Acceptance:** arbitrary descriptive text in `review` triggers a chained
revision generation.

### CONV-010 — Pleasantries are not treated as instructions

Thanks, praise, and similar short acknowledgements must not be interpreted as
revision feedback, which would silently spend a generation.

**Acceptance:** a pleasantry produces an acknowledgement and **no** generation.

### CONV-011 — Revisions preserve garment fidelity through chaining

A revision passes the previous output as a reference **and** the previous
interaction id, so the change is a targeted edit rather than a re-roll.

**Acceptance:** a revision request records a `previousInteractionId` and includes
more reference images than the original request.

### CONV-012 — Variation prompts differ from one another

A variations request produces N generations whose prompts are pairwise distinct,
and they do **not** chain onto one another.

**Acceptance:** N variation generations ⇒ N distinct `ALTERNATES` prompts, each
with no `previousInteractionId`.

### CONV-013 — `details` returns the current brief

**Acceptance:** `4` ⇒ outbound text containing the current brief fields.

### CONV-014 — `cancel` terminates the item

**Acceptance:** `5` ⇒ confirmation text and a terminal session.

### CONV-015 — Approval records the item and acknowledges it

**Acceptance:** `1`/`approve` ⇒ a product exists with a linked hero asset, and the
user receives confirmation including the SKU when known.

### CONV-016 — A new garment during review starts a new item

Sending garment photos while in `review` banks the current item and opens a fresh
one, rather than mixing two garments into one prompt.

**Acceptance:** photos arriving in `review` ⇒ prior session terminal, new session
at `collecting_brief` with no inherited output.

### CONV-017 — SKUs are captured from free text

A `sku <code>` token in the brief text is recorded on the item, uppercased.

**Acceptance:** `sku: DRESS-001` ⇒ stored SKU `DRESS-001`.

### CONV-018 — An explicit reset works from any stage

`start over` / `new item` / `reset` terminates the current item from any stage and
greets the user.

**Acceptance:** mid-`review` reset ⇒ actioned item banked, new session `idle`.

### CONV-019 — The `new` word is not misread mid-flow

`new` mid-conversation must not be consumed as brief text.

**Acceptance:** `new item` while `collecting_brief` ⇒ reset, no generation.

### CONV-020 — State survives process restart

Session stage, brief, references, and the interaction chain are persisted, so a
redeploy mid-conversation does not lose the item.

**Acceptance:** state is read from storage on every turn; nothing that governs
control flow is held only in memory.

---

# User-visible copy (`UX`)

### UX-001 — `help` returns the workflow

**Acceptance:** `help`/`how`/`guide`/`?` returns the step-by-step guide.

### UX-002 — Greeting is available from idle

**Acceptance:** `hi`/`hello`/`hey`/`start`/`new` at `idle` returns the greeting.

### UX-003 — No turn ends in silence

**Acceptance:** an unexpected internal failure still produces an outbound message
to the user.

### UX-004 — Failure messages are actionable

A rejected photo explains the accepted formats, and a failed generation offers a
next action.

**Acceptance:** an unreadable upload yields a message naming JPG/PNG/WebP; a
failed generation yields retry or variation guidance.

### UX-005 — The bot acknowledges long work before starting it

Generation is acknowledged before the slow call begins, then the result is
delivered.

**Acceptance:** a generation turn produces an acknowledgement, then the image.

---

# Turn batching (`BATCH`)

### BATCH-001 — Bursty sends are assembled into one turn

Items arriving inside the debounce window are processed as a single turn.

**Acceptance:** three items inside the window resolve to one batch.

### BATCH-002 — Three photos produce one acknowledgement

**Acceptance:** three photos in one batch ⇒ exactly one "got your photo" reply,
with all three retained as references.

### BATCH-003 — Buffers are independent per contact

**Acceptance:** two contacts sending concurrently produce two independent
single-item batches.

### BATCH-004 — Text is acted on only for the last message in a batch

Otherwise a trailing caption is consumed before the remaining photos are attached.

**Acceptance:** photo + photo + caption ⇒ brief requested, both photos attached.

### BATCH-005 — Duplicates within one batch are suppressed

**Acceptance:** the same message twice in a batch ⇒ one reference, one effect.

### BATCH-006 — An empty batch is a no-op

**Acceptance:** no outbound message, no state change.

### BATCH-007 — The window opens fresh after closing

**Acceptance:** items arriving after a window closes form a new batch.

### BATCH-008 — Flush releases buffered items immediately

**Acceptance:** flush returns and resolves the buffered batch, leaving no pending
window.

### BATCH-009 — Every waiting caller receives the assembled batch exactly once

**Acceptance:** N callers in one window each observe the full batch a single time.

### BATCH-010 — Buffers are keyed, and an unknown key flush is a no-op

**Acceptance:** flushing an unseen key returns empty and does not throw.

---

# Brief parsing and confirmation (`BRIEF`)

### BRIEF-001 — Free-form text becomes a validated structured brief

Structured model output produces the brief object; an invalid or failed parse
falls back to documented defaults rather than failing the turn.

**Acceptance:** a brief parses into the schema; a provider error yields the
default brief and the turn continues.

### BRIEF-002 — The brief schema constrains garment, model, scene and format

Required fields, enumerations for aspect ratio and image size, and defaults for
every field.

**Acceptance:** the schema rejects invalid enumerations and applies defaults for
missing fields.

### BRIEF-003 — The `model` field is constrained to a synthetic person

Neither the brief parser nor the image prompt may describe a real, identifiable
individual.

**Acceptance:** the brief system instruction states the model must be synthetic
and must not be a named real person.

### BRIEF-004 — Defaults are tasteful and commercially safe

Vague user input must still yield a usable brief without asking for clarification.

**Acceptance:** the default brief is complete and valid with no user input.

### BRIEF-005 — The brief is confirmed before any generation

**Acceptance:** providing brief text produces a confirmation prompt and **zero**
generations.

### BRIEF-006 — Corrections modify the brief without losing the original request

Corrections are appended to the pending brief text rather than replacing it.

**Acceptance:** a correction re-parses text that still contains the original
request.

### BRIEF-007 — The brief determines aspect ratio and image size

These are carried from the brief into the provider request, not hardcoded at the
call site.

**Acceptance:** a brief with aspect ratio `4:5` results in a generation request
specifying `4:5`.

---

# Image generation (`GEN`)

### GEN-001 — Generation goes through the Gemini `interactions` API

The provider calls `interactions.create` with the configured image model. This is
the only place the SDK is touched.

**Acceptance:** the adapter issues exactly one `interactions.create` call per
generation and returns a usable image plus the interaction id. Claim class:
`EXTERNAL-VERIFIED` against `@google/genai` 2.29.0 type declarations, which is why
that version is pinned exactly.

### GEN-002 — The pipeline depends on an interface, not on Gemini

The pipeline calls `ImageProvider` only; it holds no provider-specific types.

**Acceptance:** the pipeline runs end-to-end against a fake provider.

### GEN-003 — The prompt is composed from explicit, separable layers

Identity constraints, garment, model, pose, setting, lighting, mood, style guide,
and composition.

**Acceptance:** each brief field and the style guide appear in the prompt.

### GEN-004 — The model is told to reproduce the garment faithfully

Colour, print, pattern scale, fabric, cut, proportions, seams, hardware, and logos
must be preserved, and the garment must not be restyled.

**Acceptance:** the system instruction states the fidelity requirement in these
terms.

### GEN-005 — Added text, watermarks and graphics are forbidden

**Acceptance:** the system instruction forbids adding text or watermarks. Note
that the image model embeds a SynthID watermark regardless; that is a model
property, not a failure of this requirement.

### GEN-006 — Reference images are supplied to the provider

The uploaded garment photos are passed as image inputs, not described in words
alone.

**Acceptance:** a generation request carries the uploaded references.

### GEN-007 — Reference count is capped

At most four references are retained per item, keeping the most recent.

**Acceptance:** five uploaded photos leave four references and drop the oldest.

### GEN-008 — A transient failure is retried with backoff

Rate limits, 5xx, and network errors are retried with exponential backoff and
jitter, up to a configured attempt count.

**Acceptance:** an injected transient provider error is retried up to the cap and
then fails cleanly.

### GEN-009 — A content-policy refusal is never retried

Retrying burns quota and cannot succeed. The user is told and the brief stays
editable.

**Acceptance:** an injected `content_policy` error is surfaced as a recoverable
brief edit with exactly one attempt.

### GEN-010 — Generation is bounded by a timeout

**Acceptance:** a provider call exceeding the configured timeout fails the
generation rather than hanging the turn.

### GEN-011 — The interaction id is captured for follow-up edits

**Acceptance:** a successful generation records the provider's interaction id on
the session.

### GEN-012 — Generation outcomes are recorded

Success records latency and estimated cost; failure records the error and status.

**Acceptance:** a failed generation leaves a `failed` row with a non-empty error.

### GEN-013 — A failed revision returns the session to `review`

The prior good output must survive a failed attempt so the user can retry.

**Acceptance:** a failed revision leaves stage `review` and the previous output
reference intact.

### GEN-014 — A failed first generation returns to `confirm_brief`

With no good output yet, the user must be able to adjust the brief.

**Acceptance:** a failed first generation leaves stage `confirm_brief`.

### GEN-015 — The aspect ratio and image size come from the brief

**Acceptance:** the generation request echoes the brief's aspect ratio and image
size.

### GEN-016 — A successful generation is delivered to the user

The user always receives the produced image, with the review options.

**Acceptance:** a successful first generation produces exactly one outbound image
and then the review prompt.

---

# Revision and variation (`ITER`)

### ITER-001 — A revision is a chained edit

It supplies the previous output as a reference and sets
`previous_interaction_id`.

**Acceptance:** a revision request carries the prior interaction id and the prior
output among its references.

### ITER-002 — A variation does not chain

Variations re-shoot from the same base references so the composition can change.

**Acceptance:** every variation request omits `previousInteractionId`.

### ITER-003 — Revision and variation instructions are mutually exclusive

An edit and an exploration pull in opposite directions; a prompt must not request
both.

**Acceptance:** supplying both a revision note and a variation note yields
`REVISION` and no `ALTERNATES` clause.

### ITER-004 — Variation notes are distinct and cycle safely

**Acceptance:** successive notes differ, the list wraps without returning
undefined, and an out-of-range index is safe.

### ITER-005 — A revision instruction is preserved verbatim in the prompt

**Acceptance:** the user's revision text appears in the prompt unaltered.

---

# Media validation (`MED`)

### MED-001 — Media is sniffed, never trusted

Formats are determined by inspecting bytes rather than a declared MIME type,
because the declaration arrives from an untrusted channel.

**Acceptance:** the declared type is not consulted to decide the format.

### MED-002 — PNG dimensions are parsed from the header

**Acceptance:** a valid PNG reports its true width and height.

### MED-003 — JPEG dimensions are parsed from the SOF frame header

The image model returns JPEG by default, so this is the production path.

**Acceptance:** a valid JPEG reports its true width and height; a JPEG is not
reported as a PNG.

### MED-004 — WebP is accepted

**Acceptance:** VP8/VP8L/VP8X variants are recognised as WebP.

### MED-005 — Oversized payloads are rejected before any API call

**Acceptance:** a payload exceeding the configured cap is rejected with a
user-safe message, and no generation is attempted.

### MED-006 — Unrecognised bytes are rejected safely

**Acceptance:** non-image bytes are rejected without throwing an unhandled error,
with a message naming the accepted formats.

### MED-007 — Empty payloads are rejected

**Acceptance:** zero-length input is rejected.

### MED-008 — Undersized images are rejected

**Acceptance:** an image below the minimum dimension is rejected as too small
rather than as an unknown format.

### MED-009 — A truncated but identifiable image is still classified

**Acceptance:** a JPEG with no reachable frame header reports unknown dimensions
but is still identified as JPEG.

### MED-010 — Identical bytes are stored once

Content hashing deduplicates re-sent photos.

**Acceptance:** identical bytes yield a stable hash; different bytes yield a
different hash; a re-sent photo reuses the stored asset.

### MED-011 — Cost per size is estimated for logging

**Acceptance:** the estimate increases with the requested image size and is stable
for an unknown size.

---

# WhatsApp channel (`WA`)

### WA-001 — The webhook verification handshake is honoured

A `GET` with the correct mode, verify token, and challenge echoes the challenge as
plain text.

**Acceptance:** valid handshake ⇒ 200 with the raw challenge body.

### WA-002 — An incorrect verify token is refused

**Acceptance:** wrong token ⇒ 403, no challenge echoed.

### WA-003 — Every inbound payload is signature-verified over the raw bytes

HMAC-SHA256 compared with `X-Hub-Signature-256` using a constant-time comparison,
over the exact received bytes — not the re-serialised parsed body.

**Acceptance:** a correctly signed body is accepted; a body altered after signing
is rejected; a signature without the `sha256=` prefix is also accepted.

### WA-004 — A missing signature header is rejected

**Acceptance:** no header ⇒ 401, and the payload is not processed.

### WA-005 — A signature from a different secret is rejected

**Acceptance:** a signature computed with another secret ⇒ 401.

### WA-006 — Malformed signature values are rejected without throwing

**Acceptance:** non-hex, empty, and `sha256=`-only values ⇒ `false`, no exception.

### WA-007 — Inbound text messages are normalised

Sender id, message id, timestamp, and text body are extracted into the
channel-neutral message shape.

**Acceptance:** a text webhook yields one normalised message with the correct
sender, id, timestamp, and display name.

### WA-008 — Inbound image messages are normalised, keeping the caption

**Acceptance:** an image webhook yields an attachment referencing the media id and
the caption as text.

### WA-009 — Outbound sends respect the 24-hour service window

Free-form replies are only sent inside the customer-service window; outside it, an
approved template is required.

**Status:** `not_implemented` — the configured window value is read nowhere. Meta
enforces the window server-side, so an out-of-window send fails as an API error
rather than being pre-empted. See [`PROBLEMS.md`](PROBLEMS.md) P-1.

### WA-010 — Interactive button replies are normalised

**Acceptance:** a button reply yields both its id and its title as text.

### WA-011 — Unsupported message types are ignored, not fatal

**Acceptance:** audio and location messages produce no normalised message and do
not raise.

### WA-012 — Delivery statuses are processed separately

**Acceptance:** statuses are extracted without producing a user turn.

### WA-013 — A failed status surfaces its error detail

**Acceptance:** a failed status carries the provider's error message.

### WA-014 — A malformed payload yields empty results, never an exception

**Acceptance:** `{}` and an entry-less payload each yield no messages and no
statuses.

### WA-015 — Outbound text is sent through the Cloud API

**Acceptance:** text is posted as a `text` message with link previews disabled.

### WA-016 — Outbound images are uploaded before being referenced

**Acceptance:** an image send performs a media upload, then posts an `image`
message referencing the returned media id.

### WA-017 — Inbound media is fetched in two authenticated hops

The media id resolves to a short-lived URL, which is then fetched with bearer
authentication; bytes are persisted immediately.

**Acceptance:** both requests carry the bearer token and the bytes are returned.

### WA-018 — The API version is pinned by configuration

**Acceptance:** the base URL embeds a single configured version, not a moving
default.

### WA-019 — Read receipts are best-effort and never fail a turn

**Acceptance:** the read-receipt call swallows its own errors. **Note:** the method
exists but nothing calls it; see [`PROBLEMS.md`](PROBLEMS.md) P-5.

### WA-020 — Outbound deliveries are recorded

**Acceptance:** each outbound message is persisted with its channel id and status.

---

# Local simulator (`SIM`)

### SIM-001 — The whole product runs locally with no Meta account

The simulator drives the **same** pipeline, state machine, and storage as the
WhatsApp channel; only the transport differs.

**Acceptance:** with the simulator channel configured, the full conversation
completes over HTTP.

### SIM-002 — A browser chat client is served

**Acceptance:** `GET /sim` returns 200 with HTML that references the message and
event endpoints.

### SIM-003 — Bot replies are streamed to the client

**Acceptance:** outbound text and images are published as server-sent events
scoped to the session.

### SIM-004 — Inbound images can be posted and are stored

**Acceptance:** a base64 image is validated, stored, and accepted with 200.

### SIM-005 — Invalid inbound requests are rejected with a reason

**Acceptance:** a missing contact id, an empty payload, and a non-image upload each
return 400 with a machine-readable `error` code.

### SIM-006 — Simulator-hosted bytes are retrievable

**Acceptance:** an uploaded blob is served back with the correct content type.

### SIM-007 — The generated catalog is listed for the UI

**Acceptance:** `GET /api/catalog` returns items with their hero asset id.

### SIM-008 — A non-simulator channel does not serve the UI

**Acceptance:** with another channel configured, `GET /sim` returns 409 explaining
how to enable it.

### SIM-009 — The simulator and WhatsApp contact namespaces are separate

**Acceptance:** the same person on each channel gets an independent session.

---

# Persistence (`PERSIST`)

### PERSIST-001 — SQLite via the built-in driver, with no native dependency

Storage uses `node:sqlite`, which ships with Node ≥ 24. There is no native module
to compile, which keeps the container build trivial.

**Acceptance:** the database opens and the schema applies using only the standard
library.

### PERSIST-002 — The schema covers every domain entity

`orgs`, `contacts`, `sessions`, `assets`, `products`, `product_assets`,
`generations`, `generation_assets`, `messages`.

**Acceptance:** every entity has a table with the columns its repository methods
read and write.

### PERSIST-003 — Schema application is idempotent

Applying the schema twice is safe.

**Acceptance:** applying the schema twice leaves the table set unchanged.

### PERSIST-004 — Repository methods are typed and constrained

Each method exposes an explicit row type, inserts generate ids and timestamps, and
patches are assembled from an explicit field allowlist rather than raw caller
input.

**Acceptance:** an insert produces a generated id and a parseable timestamp; a
partial patch leaves unpatched fields intact.

### PERSIST-005 — Session state is updated and reloaded around every step

**Acceptance:** every field governing control flow round-trips through storage.

### PERSIST-006 — Asset bytes live in a blob store keyed by a storage path

**Acceptance:** bytes round-trip by key and existence can be queried.

### PERSIST-007 — The blob store is an interface with a filesystem default

Swapping to S3/R2 is an implementation change behind the interface, not a refactor
above it.

**Acceptance:** the default implementation satisfies the interface.

### PERSIST-008 — Blob keys cannot escape the storage root

Path traversal via a crafted key is refused.

**Acceptance:** a key containing `../` is rejected for both read and write.

### PERSIST-009 — Writes are atomic

Bytes are written to a temporary file and renamed, so a reader never observes a
partial asset.

**Acceptance:** after a write no temporary file remains.

### PERSIST-010 — Message identity is unique per channel id

A unique constraint on `(direction, external_id)` is what makes duplicate
suppression possible at the storage layer.

**Acceptance:** the same external id cannot be stored twice; a null external id is
permitted (simulator-generated messages).

---

# Catalog (`CATALOG`)

### CATALOG-001 — Approving creates a product

**Acceptance:** approval creates exactly one new product for the item.

### CATALOG-002 — Products carry SKU, title, description and commercial fields

Title and description are populated from the brief; SKU from user text; price,
currency and category exist for future use.

**Acceptance:** the created product records its title and commercial fields.

### CATALOG-003 — Assets and products are linked with an explicit role

Roles: `input`, `hero`, `alternate`.

**Acceptance:** approval links a `hero`; generation links outputs as `alternate`
and inputs as `input`.

### CATALOG-004 — The hero asset is a generated image

**Acceptance:** the linked hero asset has kind `generated`, never `uploaded`.

### CATALOG-005 — Only the current best output becomes the hero

**Acceptance:** the hero is the session's last output, not its first.

### CATALOG-006 — Products are listed newest first

**Acceptance:** the listing reflects the approved items and honours a limit.

### CATALOG-007 — The catalog exports to CSV with the hero reference

**Acceptance:** the export contains a header row and the hero asset id.

### CATALOG-008 — CSV escaping is correct

Fields containing commas, quotes, or newlines are quoted and internal quotes
doubled.

**Acceptance:** a title containing `"` and a SKU containing `,` both survive the
round trip.

---

# Configuration (`CFG`)

### CFG-001 — All configuration is environment-driven and validated at boot

Invalid configuration fails fast with an actionable message rather than producing
a confusing downstream error.

**Acceptance:** booting with an invalid port exits non-zero and names the
offending variable.

### CFG-002 — The active channel is selected by configuration

One of `simulator`, `whatsapp`, `console`.

**Acceptance:** the adapter is chosen from configuration and reports its name.

### CFG-003 — Channel credentials are asserted before use

Selecting WhatsApp without its four credentials fails at boot rather than at the
first message.

**Acceptance:** construction without credentials throws, naming every missing key.

### CFG-004 — The image model is configurable

Selecting a different image model requires no code change.

**Acceptance:** the model id is a configuration value.

### CFG-005 — The text model used for brief parsing is separately configurable

Text and image models are on independent release cadences.

**Acceptance:** the two model ids are independent configuration values.

### CFG-006 — The batching window is configurable, including zero

**Acceptance:** the window is a configuration value and zero disables the wait.

### CFG-007 — Limits are configurable and bounded

Maximum generations per session, variation count, upload size, timeout and retry
count are configuration, validated (e.g. variation count is capped).

**Acceptance:** the variation count cannot be configured above its documented
maximum.

### CFG-008 — Example configuration documents every variable

`.env.example` lists every supported variable, with the unset-by-default secrets
empty.

**Acceptance:** every variable the application reads appears in the example file.

---

# Observability (`OBS`)

### OBS-001 — Structured logging with production-appropriate output

Human-readable in development; newline-delimited JSON in production.

**Acceptance:** the logger exposes the standard level methods and child loggers.

### OBS-002 — A health endpoint exists and checks dependencies

It touches the database so a broken volume surfaces as unhealthy rather than as a
failure during a user's turn.

**Acceptance:** the health endpoint returns 200 with the active configuration.

### OBS-003 — The health endpoint reports provider configuration state

So an operator can distinguish "running without a key" from "misconfigured".

**Acceptance:** the response distinguishes the two.

### OBS-004 — Each generation is logged with latency, cost and remaining budget

**Acceptance:** a successful generation logs latency, estimated cost and the
remaining per-item budget.

### OBS-005 — Failures are logged with enough context to diagnose

Turn failures log the error, stack, and contact; generation failures log the
policy classification.

**Acceptance:** the logger supports structured context on every level.

---

# Architecture seams (`SEAM`)

### SEAM-001 — The channel is an interface

The delivery adapter is the only channel dependency of the core.

**Acceptance:** the pipeline runs unchanged against a bespoke adapter
implementation.

### SEAM-002 — The image engine is an interface

The provider is the only engine dependency of the core.

**Acceptance:** the pipeline runs unchanged against a fake provider.

### SEAM-003 — Concrete implementations are chosen in one place

A single factory selects the adapter and provider, so tests inject fakes without
touching the pipeline.

**Acceptance:** the provider and adapter can be substituted for a run.

### SEAM-004 — A missing API key degrades safely instead of crashing

The service starts and walks the conversation, failing only at generation with a
clear message.

**Acceptance:** with no key configured the factory still produces a usable object,
and generation rejects with an actionable message.

### SEAM-005 — Simulator and WhatsApp share one pipeline

There is no second implementation of the conversation.

**Acceptance:** both channels exercise the same code path.

---

# Security (`SEC`)

### SEC-001 — Inbound webhooks require a valid signature

An unsigned or incorrectly signed payload must never reach the pipeline.

**Acceptance:** missing, mismatched, and tampered signatures are all rejected.

### SEC-002 — Signature comparison is constant-time

Prevents recovering the expected signature byte-by-byte through timing.

**Acceptance:** comparison uses a timing-safe equality check and rejects length
mismatches.

### SEC-003 — Secrets come from the environment and are never committed

`.env` is ignored; `.env.example` carries empty placeholders.

**Acceptance:** no committed file contains a credential-shaped string, and the
example file's secret fields are blank.

### SEC-004 — The webhook cannot be served without its secret configured

Rather than accepting unverified payloads, the endpoint refuses.

**Acceptance:** with no app secret the endpoint returns 503 and processes nothing.

### SEC-005 — Duplicate delivery cannot replay a turn

Uniqueness of the channel message id is the front door against replay.

**Acceptance:** a repeated message id produces no second effect.

### SEC-006 — The media and catalog endpoints are unauthenticated by design and must not be exposed publicly

Access is "know the UUID". They exist for the local simulator.

**Status:** `deferred`. **Acceptance:** the limitation is stated where an operator
will see it, and the default channel is not internet-facing. See
[`PROBLEMS.md`](PROBLEMS.md) P-4.

### SEC-007 — Unknown asset ids do not disclose whether an asset exists elsewhere

**Acceptance:** an unknown asset id returns 404.

---

# Content policy (`CONTENT`)

### CONTENT-001 — Depicting real, identifiable people is prohibited

**Acceptance:** the system instruction forbids it explicitly.

### CONTENT-002 — Depicting minors is prohibited

**Acceptance:** the system instruction forbids it explicitly.

### CONTENT-003 — The garment must not be restyled, recoloured, or altered

**Acceptance:** the system instruction states the garment may not be restyled and
must retain colour and pattern.

### CONTENT-004 — No added text, watermarks, or graphics

**Acceptance:** the system instruction forbids added text and watermarks.

### CONTENT-005 — A policy refusal is surfaced as a recoverable brief edit

Never retried, never silent.

**Acceptance:** an injected policy error produces user-facing guidance and leaves
the brief editable.

---

# Cost control (`COST`)

### COST-001 — Generations per item are capped

**Acceptance:** exceeding the cap refuses further generations with a message
offering to save or cancel.

### COST-002 — No generation occurs before the user confirms the brief

**Acceptance:** providing brief text yields zero generations.

### COST-003 — Variation batches are bounded by the remaining budget

**Acceptance:** requesting more variations than remain produces only the available
number.

### COST-004 — Per-call cost is estimated and persisted

**Acceptance:** a successful generation records a non-null estimated cost.

### COST-005 — A batch does not multiply cost

Three photos in one turn are one item, not three generations.

**Acceptance:** a three-photo batch produces exactly one acknowledgement and
requests the brief.

---

# Tooling (`TOOL`)

The two conventions this change must satisfy in any checkout, added when the
first implementation failed them: the metadata rule covered three artifacts out of
fifteen, and `run.sh` could not start on a machine other than its author's.

### TOOL-001 — Every material artifact carries a metadata block

The metadata rule (`spec.md` AC-5) is enforced over **every** markdown artifact
under the change directory, discovered by scanning rather than by a list kept in
the gate. The only exemption is `templates/METADATA_BLOCK.md`, which is
documentation *about* the standard and cannot carry a real block without making
the example indistinguishable from a header.

**Acceptance:** removing the block from any artifact — including one added later,
in a directory the gate does not name today — fails the
"carries a metadata block" check.

### TOOL-002 — The toolchain is resolved from the environment, not from a machine

`run.sh` selects its Node runtime from `NODE_BIN`, then a Node ≥ 24 on `PATH` or
at a standard install prefix, then a bundled runtime **only if it exists**, then
any Node on `PATH` with a warning. It contains no absolute path outside this
repository, and neither does `test.sh`. pnpm is resolved from `PNPM_BIN`, the
bundled runtime, or `PATH`, and a missing pnpm is reported with the command that
fixes it.

**Acceptance:** with a Node on `PATH` and no bundled runtime, `./run.sh which`,
`./run.sh tsx`, `./test.sh` and `./run.sh pnpm <script>` all work; a test asserts
that no machine-absolute path literal appears in either script.
