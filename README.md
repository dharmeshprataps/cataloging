# wa-catalog-bot

A WhatsApp Business bot that turns phone photos of a garment into photorealistic
catalog shots of a synthetic model wearing it — so a small clothing-designer
brand can build a product catalog without paying for a model photoshoot.

> **Creating a cataloguing solution for small designer showrooms.**
>
> — the project's original one-line description, kept here because it states the
> audience more plainly than the paragraph above.

**The problem it solves:** a one-person brand has the garments and the phone, but
not the studio, the model, or the retoucher. This bot takes the flat/hanger/
mannequin photos a designer already has, plus a one-line style brief, and returns
an e-commerce-ready image of the garment on a model. The design goal is that the
*garment* survives the process unchanged: a pretty shot of the wrong print is
worse than no shot.

> Status: unit- and integration-tested with faked boundaries, and exercised
> against the real Gemini API only through the opt-in live smoke test. Treat it as
> **ready for live testing**, not as production-proven.

---

## 1. What it does

1. You message the bot on WhatsApp (or the local simulator) with 1–3 photos of
   one garment.
2. You describe the shot you want in plain language — e.g. *"women's dress,
   outdoor daytime, model walking, warm natural light, 4:5"*.
3. The bot parses that into a structured brief (garment, model, pose, setting,
   lighting, mood, format) and shows it back to you for confirmation.
4. You reply `go`. The bot generates one photorealistic image and sends it back.
5. You reply `1` to approve, `2` to change something, `3` for variations,
   `4` to see the brief, or `5` to cancel.
6. On approval the image is linked to the item as its hero image, and the item —
   with its SKU if you provided one — appears in the catalog
   (`GET /api/catalog`, and the simulator's side panel).

A new photo after a review starts a fresh item rather than mixing two garments in
one prompt. Bursty sends are batched: photos and their trailing caption that
arrive within `MESSAGE_DEBOUNCE_MS` (3 s by default) are assembled into one turn
on **both** channels, so three photos become one acknowledgement, not three.

---

## 2. Quick start

```bash
# 1. Install (uses the Node runtime that run.sh selects — see below)
./run.sh pnpm install

# 2. Configure
cp .env.example .env
# edit .env and set GEMINI_API_KEY=...

# 3. Run
./run.sh pnpm dev

# 4. Open the local chat UI
open http://localhost:3000/sim
```

No Meta account is needed for any of this: `MESSAGING_CHANNEL=simulator`
(the default) drives the **same** `Pipeline`, the same SQLite database and the
same image provider as the WhatsApp channel — only the transport differs.

The server binds `HOST=0.0.0.0` on `PORT=3000` by default. Without a
`GEMINI_API_KEY` the bot still runs and still walks the whole conversation, but
generation fails with a clear message; a stub provider stands in so you can test
the flow without spending credit.

### About `run.sh`

This environment's bundled Node has a code signature that cannot load native
`.node` addons, so rollup/rolldown/esbuild prebuilds fail with a *"different Team
IDs"* `dlopen` error. `run.sh` therefore prefers a system Node **>= 24** and falls
back to the bundled runtime only if it exists, then to any Node on `PATH` with a
warning. It resolves everything from the environment — `NODE_BIN`, then `PATH`,
then standard install prefixes, then `DSH_RUNTIME_ROOT/node/bin/node` — so a
checkout on another machine needs no edit. Override explicitly with:

```bash
NODE_BIN=/path/to/node ./run.sh pnpm test
PNPM_BIN=/path/to/pnpm ./run.sh pnpm test
./run.sh which          # prints the Node binary that would be used
```

Direct `pnpm`/`node` also work if your system Node is >= 24 (`engines.node` in
[package.json](package.json)); `node:sqlite` is built in, so there is no native
module to compile.

### About the pnpm config (read before touching it)

[.npmrc](.npmrc) sets `verify-deps-before-run=false`. Without it, `pnpm run
<script>` fails on this machine inside pnpm's own preflight with
`spawn bash ENOENT` **even though the underlying command succeeds** when invoked
directly — so `pnpm test`/`pnpm typecheck` would look broken while nothing is.

[pnpm-workspace.yaml](pnpm-workspace.yaml) holds `allowBuilds` with all three
entries explicitly `false`. esbuild's native binary ships inside its platform
package (`@esbuild/darwin-arm64`) and rolldown's inside `@rolldown/binding-*`, so
neither postinstall is needed and the toolchain works with them blocked.

> **Do not delete the `allowBuilds` key.** If it is absent, pnpm 11 silently
> re-inserts the block with the literal placeholder text
> `set this to true or false` as the value, and a subsequent `git add -A` would
> commit invalid config. It must stay present with real booleans.

---

## 3. How a conversation flows

Stages come from `STAGES` in [src/types.ts](src/types.ts):

| Stage | Meaning |
| --- | --- |
| `idle` | Session exists, nothing received yet. |
| `collecting_images` | Recognised by the handler, but no code path transitions into it today — a first photo moves `idle → collecting_brief` directly. |
| `collecting_brief` | Photo(s) received; waiting for the style text. |
| `confirm_brief` | Brief shown back to you. `go`/`yes`/`ok`/`confirm`… generates; anything else is appended as `Additional correction: …` and re-confirmed. More photos are still accepted here. |
| `generating` | A shot is in flight. Other messages get “still working”. |
| `review` | The shot was delivered; commands below apply. |
| `approved` | Hero image linked to the product. Terminal: the next photo starts a new item. |
| `cancelled` | Terminal: the next photo starts a new item. Also where `start over`/`new item`/`reset` banks the current session from any stage. |

### Review commands

| You send | Command | What happens |
| --- | --- | --- |
| `1`, `approve`, `ok`, `looks good`, `love` | `approve` | Links the current output as the product's **hero**, writes the title/description from the brief, ends the item. |
| `2`, `revise`, `change`, `edit` | `revise` | **Targeted edit.** Text after the digit is the instruction (`2, make the light warmer`). Bare `2` falls back to *“a slightly different pose and framing”*. |
| `3`, `variations`, `vary`, `more` | `variations` | Up to `VARIATIONS_COUNT` alternates, each varied along one dimension; **never chained**. |
| `4`, `details` | `details` | Reprints the current brief. |
| `5`, `cancel`, `stop` | `cancel` | Ends the item. |
| `go`, `again`, `redo`, `regenerate` | `regenerate` | A fresh roll of the same brief with the chain cleared — the drift-prone path, so it is explicit. |
| anything else in `review` | — | Treated as revision feedback (the most likely intent). |

Two deliberate exceptions:

- **Pleasantries are not feedback.** `thanks`, `cheers`, `nice`, `perfect`,
  `👍`, … get an acknowledgement, not a generation.
- **Unrecognised text in `review` is a revision**, not a no-op — but that does
  mean a stray message can cost a generation.

Outside `review`: `help`/`how`/`guide`/`?` returns the help text; `hi`/`hello`/
`hey`/`start`/`new` while `idle` returns the greeting; `sku DRESS-001` anywhere
in your text tags the item's SKU (stored uppercase); text before any photo asks
for a photo.

`start over`, `new item` or `reset` works **from any stage** — including
mid-review — and banks the current item in favour of a fresh `idle` session, so a
designer who changes their mind never has to finish the old flow first.

---

## 4. Architecture

```
src/
├── main.ts            Entry point: creates the data dirs, then starts the server.
├── server.ts          Fastify app: raw-body parser, error handler, /healthz, route registration.
├── config.ts          Zod-parsed env → typed `config`; channel credential assertions.
├── logger.ts          pino: pretty in dev, newline-delimited JSON in production.
├── types.ts           Conversation stages, the `Brief` schema, review-command parsing.
├── providers.ts       Chooses the concrete provider/adapter; the test-injection seam.
├── api/
│   ├── body.ts        Raw-body capture plus `bodyOf`/`rawBodyOf` accessors.
│   ├── webhook.ts     GET verification handshake and HMAC-verified POST /webhook.
│   ├── simulator.ts   Local /sim, /sim/events (SSE), /sim/message, /sim/blob.
│   ├── simulator-ui.ts  Single-file HTML/JS chat client; no build step.
│   └── media.ts       GET /media/:assetId and GET /api/catalog.
├── core/
│   ├── pipeline.ts    The conversation state machine — channel-agnostic.
│   ├── coordinator.ts TurnCoordinator: debounce, then emit one assembled turn.
│   ├── turns.ts       TurnBuffer: the debounce primitive underneath.
│   ├── ingest.ts      Persists inbound/generated bytes; loads provider-ready refs.
│   ├── copy.ts        Every user-facing string, in one place.
│   └── catalog.ts     Catalog read helpers and CSV export.
├── db/
│   ├── migrate.ts     Opens `node:sqlite`, applies the schema, in-memory test DB.
│   ├── repo.ts        All SQL, with explicit row types (deliberately not an ORM).
│   └── schema.sql     Portable schema: orgs, contacts, sessions, assets, products, generations, messages.
├── imaging/
│   ├── gemini.ts      Gemini implementation: `interactions.create`, retries, timeouts.
│   ├── prompts.ts     Layered prompt construction and the variation notes.
│   └── types.ts       `ImageProvider` seam, request/result types, `ImageProviderError`.
├── media/
│   ├── store.ts       `BlobStore` seam, local-disk implementation, key layout.
│   └── validate.ts    Byte-sniffing validation, sha256, indicative cost estimate.
└── messaging/
    ├── types.ts       `DeliveryAdapter` seam.
    ├── simulator.ts   Local adapter + the SSE event bus (`sim:<browserId>` contacts).
    ├── whatsapp.ts    Meta Cloud API adapter, payload parsing, signature verification.
    └── console.ts     Prints deliveries to the log instead of sending them.
```

### The two seams

The core depends on interfaces, not implementations, which is what makes the
product channel-agnostic and engine-agnostic:

- **`DeliveryAdapter`** ([src/messaging/types.ts](src/messaging/types.ts)) is the
  only channel dependency: `sendText`, `sendImage`, `downloadMedia`, optional
  `markRead`. There are three implementations —
  `simulator` ([src/messaging/simulator.ts](src/messaging/simulator.ts)),
  `whatsapp` ([src/messaging/whatsapp.ts](src/messaging/whatsapp.ts), Meta Cloud
  API) and `console` ([src/messaging/console.ts](src/messaging/console.ts)).
  `createDeliveryAdapter()` picks one from `MESSAGING_CHANNEL`, so wiring up Meta
  is a config change, not an integration project. Adding Instagram DM, Telegram
  or email means writing one more implementation.
- **`ImageProvider`** ([src/imaging/types.ts](src/imaging/types.ts)) is the seam
  for a different image engine: `generate`, `parseBrief`, `describeGarment`.
  `GeminiImageProvider` is the current implementation; a dedicated virtual
  try-on model (fal.ai, Replicate, …) would be another implementation rather than
  a refactor of the pipeline.

`src/providers.ts` is the single place where concrete implementations are chosen,
and `setProviders()` lets tests inject fakes — which is exactly how the test
suites fake only the two external boundaries and run everything else for real.

There is a third, smaller seam: **`BlobStore`** in
[src/media/store.ts](src/media/store.ts). The default writes to local disk under
`STORAGE_DIR`; S3/R2 is an implementation of the same four methods.

---

## 5. Configuration

Every env var is parsed and validated by zod in
[src/config.ts](src/config.ts); an invalid value fails fast at boot with
`Invalid environment configuration`. The table below is every variable in
[.env.example](.env.example).

| Variable | Default | Meaning |
| --- | --- | --- |
| `GEMINI_API_KEY` | *(empty)* | Enables real generation and brief parsing. Without it a stub provider is used and every `generate` fails with an actionable error. |
| `GEMINI_IMAGE_MODEL` | `gemini-nano-banana-2.1` | Image model. `gemini-3.1-flash-lite-image` is cheaper/faster but weaker with multiple references; `gemini-2.5-flash-image` is the documented-legacy model. |
| `GEMINI_TEXT_MODEL` | `gemini-flash-latest` | Text model used only to turn a free-form brief into structured JSON. A `-latest` alias on purpose, so it is not pinned to a dated snapshot. |
| `PORT` | `3000` | HTTP port. |
| `HOST` | `0.0.0.0` | Bind address. |
| `LOG_LEVEL` | `info` | pino level (`silent` in tests). |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | Trailing slashes are stripped. Currently used for the startup log line and as the canonical public URL; media URLs in payloads are relative. |
| `STORAGE_DIR` | `./data/uploads` | Where uploaded and generated images live (resolved to an absolute path). Mount a volume in production. |
| `DATABASE_PATH` | `./data/bot.db` | SQLite file (WAL mode). |
| `MESSAGING_CHANNEL` | `simulator` | `simulator` \| `whatsapp` \| `console`. |
| `WHATSAPP_ACCESS_TOKEN` | *(empty)* | Meta permanent access token. Required when channel is `whatsapp`. |
| `WHATSAPP_PHONE_NUMBER_ID` | *(empty)* | Meta phone number ID. Required when channel is `whatsapp`. |
| `WHATSAPP_VERIFY_TOKEN` | *(empty)* | The token you invent and paste into the Meta webhook config. Required when channel is `whatsapp`. |
| `WHATSAPP_APP_SECRET` | *(empty)* | Meta app secret, used to verify `X-Hub-Signature-256`. Required when channel is `whatsapp`. |
| `WHATSAPP_API_VERSION` | `v21.0` | Graph API version, pinned deliberately so a Meta default change cannot alter behaviour silently. |
| `MESSAGE_DEBOUNCE_MS` | `3000` | Window in which bursty sends are batched into one turn, on every channel (`0` disables the wait). |
| `MAX_GENERATIONS_PER_SESSION` | `15` | Hard cap on generations per item, the main cost lever. |
| `VARIATIONS_COUNT` | `4` | Alternates produced by the `variations` command; validated to a maximum of 8. |

`NODE_ENV` is also read (default `development`); production switches the logger
to JSON and turns off development-only conveniences.

### Tunables that are code, not env

Defined in [src/config.ts](src/config.ts) and
[src/media/validate.ts](src/media/validate.ts), and intentionally not tunable by
env today:

| Setting | Value |
| --- | --- |
| Generation timeout | 120 s per call |
| Transient retries | 3 attempts, exponential backoff + jitter from 1.5 s (429/5xx/network only) |
| Upload limits | 8 MB, ≥ 64 px per side, JPEG/PNG/WebP only |
| Default format | aspect ratio `4:5`, size `2K` (overridable per brief) |
| Reference cap | the last 4 garment photos are kept |
| Service window | `serviceWindowMs = 24h` — declared, but **not enforced** anywhere in the code (see limitations) |

---

## 6. The image pipeline

```
photos ─┐
        ├─► parse brief ──► CONFIRM (cost gate) ──► prompt layers ──► generate ──► review
brief ──┘                                              │                            │
                                                       │                  1 approve ──┴── 2 revise / 3 vary
                                                       │                             │
                                          previous output + interaction id ◄──────────┘ (revisions only)
```

**1. Brief.** `provider.parseBrief()` sends your text plus a vision cue
(`BRIEF_SYSTEM_INSTRUCTION` and a draft-7 JSON schema) to the text model. It
decodes into `BriefSchema`: `garment`, `model`, `pose`, `setting`, `lighting`,
`mood`, `aspectRatio`, `imageSize`, `notes`. Any failure — network, bad JSON,
schema violation — falls back to `BriefSchema.parse({})` defaults and logs a
warning; a brief is a convenience and never blocks a turn.

**2. Confirm.** The brief is rendered as bullets and sent for approval. Nothing is
generated, and nothing is spent, before you say `go`. This is the cheapest
quality lever in the product.

**3. Prompt layers.** `buildImagePrompt()` in
[src/imaging/prompts.ts](src/imaging/prompts.ts) composes, in this order (order
matters — invariants come before creative direction):

1. the hard invariants in `SYSTEM_INSTRUCTION`: reproduce the garment exactly
   (colour, print, pattern scale, fabric, cut, proportions, seams, hardware,
   logos), never restyle it, the model must be synthetic, never a real
   identifiable person, never a minor, no added text/watermarks/graphics, one
   photograph rather than a collage;
2. the brief fields — garment, model, pose, setting, lighting, mood;
3. a brand style guide line (the built-in `DEFAULT_STYLE_GUIDE` today; the seam
   for a per-brand guide already accepts `styleGuide`);
4. `Additional direction from the client` when the brief has notes;
5. **either** a `REVISION` clause **or** an `ALTERNATES` clause — never both;
6. the composition paragraph (full-body, sharp focus, realistic drape, natural
   skin and hair, catalog-ready).

**4. Generate.** One `provider.generate()` call with the prompt and the reference
images (`response_format` image/JPEG with the brief's aspect ratio and size,
`store: true` so the interaction can be chained). Transient failures (408, 409,
425, 429, 5xx, network) are retried up to 3 times with jittered exponential
backoff; a **content-policy refusal is never retried** — it is detected, recorded
on the `generations` row, and surfaced to you as a brief that is still editable
(`confirm_brief`, or back to `review` if an earlier shot exists). The returned
bytes are re-validated by header sniffing before being stored, so a provider that
returns junk fails loudly instead of poisoning the catalog.

**5. Review → revise / vary → approve.**

- **Revision (`2`, or free text) = a targeted edit.** It requires a previous
  output, and then does three things at once: the prompt says *"change only the
  following, and keep every other element — especially the garment, its colour,
  print, and silhouette — exactly as it is"*, the previous output is attached as
  an extra reference image, and the call is chained with
  `previous_interaction_id`. That combination is what stops the print and
  silhouette from drifting.
- **Variation (`3`) = deliberate exploration.** The prompt says *"vary the shot
  along exactly this dimension, and keep the garment identical"*, with one of the
  eight rotating `VARIATION_NOTES` (pose, angle, crop, background tone, light…).
  Variations **do not chain and do not use the previous output as a reference** —
  chaining them would collapse the set into near-duplicates. They run
  sequentially, not in parallel, because each call mutates session state.
- **Regenerate (`go`/`again`) = a fresh roll.** It clears the stored interaction
  id and does not pass the previous output, so composition is free to change.
  This is the drift-prone path, which is why it must be asked for explicitly.

**Garment fidelity constraint.** The pipeline keeps at most the **last 4**
reference photos (more references dilute fidelity and cost tokens; the newest
angles are the most useful). A revision adds the previous output on top of those
references. The system instruction forbids restyling, and the variation clause
demands the garment stay identical — but the honest engineering position is that
*any* fresh generation can drift, so revisions are the default interpretation of
free text and `regenerate` is opt-in.

**6. Approve.** The current output is linked to the product as `hero` at position
0, the product title becomes the brief's garment and its description is built
from the brief's model/pose/setting/lighting/mood, and the session becomes
`approved`. All other outputs stay linked as `alternate`, so earlier takes are not
lost — they are reachable through `GET /api/catalog` and the `product_assets`
table.

---

## 7. Specification and traceability

This repository runs a **human-gated, specification-driven workflow**, defined in
[`AGENTS.md`](AGENTS.md): work happens on a feature branch, the specification is
written and approved before implementation, and the reviewer compares the pull
request to that exact approved specification. Per-change specifications live at
`openspec/changes/<change-id>/spec.md`.

The baseline for everything already built is
`openspec/changes/requirements-baseline/`:

| Artifact | Purpose |
|---|---|
| `spec.md` | The baseline specification: goal, user stories, acceptance criteria, known gaps |
| `requirements.md` | 159 requirements in 18 areas (`CONV`, `GEN`, `WA`, `TOOL`, …) |
| `traceability.yaml` | Machine-readable status index, one line per requirement |
| `PROBLEMS.md` | Problems and known deviations, in resolution order |
| `decisions/` | `DEC-0001`–`DEC-0006`, each with options (including stop and defer), material dissent, reversibility, and success metrics fixed before the outcome |
| `findings/` | The original findings distilled into `PROBLEMS.md` |

Requirement ids are `<AREA>-<NNN>` and are permanent: never renumbered, never
reused, never deleted, so an existing citation never silently points at different
behaviour.

### The traceability gate

```bash
./run.sh pnpm spec:status   # coverage report; exit 1 on any violation
./run.sh pnpm spec:sync     # resync declared test counts after test changes
./run.sh pnpm test          # runs the suite *and* the gate
```

A test cites a requirement by starting its title with the id:

```ts
it('CONV-004 suppresses duplicate deliveries before any work', ...)
```

The gate fails when a requirement has no test, a test cites an unknown
requirement, a requirement is falsely marked `verified`, a `partial` requirement
does not name its gap, a `not_implemented` requirement does not link a finding, a
material artifact lacks a metadata block, or the declared test counts disagree
with reality.

Two properties make this more than documentation:

- **Every check has a falsification test** in
  [`tests/spec-gate.test.ts`](tests/spec-gate.test.ts) proving it fails when
  violated. A gate nobody has watched fail is not evidence of anything.
- **Verification is derived from evidence, not asserted.** During normalization
  the gate caught **42 requirements marked `verified` by hand with no test behind
  them** — exactly the failure mode it exists to prevent.

**Coverage: 152 of 159 requirements verified, 4 `unverified`, 3 `n/a`.** The
deviations are recorded in `PROBLEMS.md` rather than claimed. The four
`unverified` entries — `GEN-001`, `GEN-008`, `GEN-009`, `SIM-008` — are
implemented and cited by a test, but the citing test exercises a substitute
rather than the code the requirement names. The three `n/a` entries describe
behaviour that does not exist: `WA-009` (24-hour service window unenforced),
`CONV-008` (unreachable guard), `SEC-006` (unauthenticated media and catalogue
endpoints). `./run.sh pnpm spec:status` is the authority for these counts.

### Why citations are plain text, not test tags

vitest 3.2.7 **accepts** `{ tags: [...] }` and **silently discards it**, and has
no `--tags-filter`. A gate built on tags would have found zero citations and
reported full coverage while inspecting nothing. That is the clearest argument in
this repository for verifying a mechanism before depending on it (`DEC-0006`).

---

## 8. Testing

```bash
./run.sh pnpm test          # vitest run, then the traceability gate
./run.sh pnpm test:watch    # watch mode (suite only)
./run.sh pnpm typecheck     # tsc --noEmit over src, tests and scripts
./run.sh pnpm spec:status   # coverage report; fails on spec/code drift
./run.sh pnpm verify:e2e    # full HTTP flow with faked boundaries
./run.sh pnpm smoke:gemini  # LIVE Gemini calls — needs a real key, costs credit
```

`.github/workflows/ci.yml` runs `typecheck`, `build`, `pnpm test` (vitest **and** the
traceability gate) and `pnpm verify:e2e` on every pull request and every push to
`main`, on the Node and pnpm versions `package.json` pins (see
`openspec/changes/ci-traceability-gate/`). No secret is referenced: the suite and
the end-to-end script fake both external boundaries.

`test.sh` deliberately **does not load the real `.env`**, so a developer's live API
key can never be spent by the suite. [tests/setup-env.ts](tests/setup-env.ts) points
`STORAGE_DIR` and `DATABASE_PATH` at a fresh temp directory per run, silences logs,
shortens the debounce to 10 ms, empties `GEMINI_API_KEY`, and forces the
simulator channel. [vitest.config.ts](vitest.config.ts) runs the node environment,
matches `tests/**/*.test.ts`, and uses a single forked process because the
integration tests share SQLite and filesystem state.

`verify:e2e` boots the **real** Fastify server over HTTP with only the two
boundaries faked (no API key needed) and drives upload → brief → generate →
revise → variations → approve, then checks idempotency and the catalog API.

It is **self-contained**: before importing any config it pins its own short
debounce and points `STORAGE_DIR`/`DATABASE_PATH` at a fresh temp directory, so it
needs no environment overrides, never touches `./data`, and is safe to run
repeatedly (it asserts on the *change* in catalog size, not an absolute count).

### What the suites cover

| Suite | Covers |
| --- | --- |
| [tests/media.test.ts](tests/media.test.ts) | PNG/JPEG/WebP header sniffing (including a truncated JPEG), the 8 MB and 64 px limits, empty payloads, sha256 stability, the cost table. |
| [tests/prompts.test.ts](tests/prompts.test.ts) | The safety and fidelity invariants in `SYSTEM_INSTRUCTION`, that every brief layer reaches the prompt, style-guide fallback, and that a revision and a variation are never mixed. |
| [tests/turns.test.ts](tests/turns.test.ts) | Debounce semantics: one batch per window, independent keys, fresh windows, flush, every caller resolved exactly once. |
| [tests/pipeline.test.ts](tests/pipeline.test.ts) | The whole state machine against real SQLite and the real blob store: happy path, confirm-before-spend, review loop, chained revisions, four distinct variations, refusal handling, failure recovery, the generation cap, idempotency, multi-item sessions and the explicit reset/`new item` path, SKU capture, batch semantics (one call per batch, every photo kept as a reference, the caption only acted on last, duplicates suppressed, empty batch ignored), CSV export, target isolation. |
| [tests/whatsapp.test.ts](tests/whatsapp.test.ts) | HMAC verification (valid, missing, tampered, wrong secret, malformed) and payload parsing (text, image+caption, button replies, ignored types, statuses). |
| [tests/webhook.test.ts](tests/webhook.test.ts) | The assembled Fastify server via `inject`: the GET handshake, 401 for unsigned and tampered bodies, an accepted message reaching the pipeline, no generation before brief confirmation, duplicate suppression, and status-only deliveries. |

### The live smoke test

```bash
GEMINI_API_KEY=... ./run.sh pnpm smoke:gemini
```

[scripts/smoke-gemini.ts](scripts/smoke-gemini.ts) makes **real API calls**
(a few generations' worth of credit) and checks what fakes cannot: the
`interactions.create` call shape, the multi-reference image input, the
structured-brief JSON response, a returned interaction id, and that the returned
bytes are a genuinely decodable image. It writes the result to `data/smoke/`.
This is the only place the real SDK surface is exercised, which is why the project
is described as ready for live testing rather than proven.

### Node / vitest constraint

The test runner is **vitest 3** ([package.json](package.json) pins `^3.2.7`). Do
not upgrade to vitest 5 in this environment: its rolldown binding is a native
addon, and the bundled Node's code signature cannot load native addons. `run.sh`
works around the general problem by preferring a system Node >= 24, but the
vitest 5 constraint is separate and intentional.

---

## 9. Honest limitations

- **Every generated image carries Google's SynthID watermark.** Gemini image
  models embed it and there is no API to remove it. It is invisible to the eye but
  detectable, so treat “AI-generated” as a property of every catalog asset. There
  is no handling of this in the code — it is a property of the model, not a
  feature of the bot.
- **One garment per shot.** There is no outfit composition (top + bottom + shoes,
  or layered looks). Sending new garment photos during `review` starts a *new
  item* rather than adding to the current one; `start over`/`new item`/`reset`
  does the same deliberately from any stage.
- **No consistent named model personas yet.** `brief.model` is free text, so two
  items can end up with visibly different models. There is no persona table or
  reference-image set for a house model.
- **No background cleanup or retouch pass.** The background is whatever the
  prompt produces; there is no cutout, no replacement, no relighting step.
- **The vision garment description is not wired in.** `ImageProvider.describeGarment()`
  is implemented and used by the smoke test, but the pipeline currently passes the
  brief's garment text as the description, so the extra vision pass does not run
  during normal use.
- **Single-tenant.** `ensureDefaultOrg()` uses the first org; there is no user
  model, no login and no tenancy separation. The org's `style_guide_json` column
  exists but is not read by the pipeline.
- **`/media/:assetId` and `/api/catalog` have no authentication** — access is
  “know the UUID”. They exist for the local simulator and must **not** be exposed
  publicly as-is.
- **Cost figures are indicative.** `estimateCostUsd()` is a hardcoded per-size
  table used for logging; it is not a billing record.
- **SQLite plus local disk means a single instance.** WAL and a 5 s busy timeout
  keep one process healthy; there is no shared store or queue, so you cannot run
  two replicas over the same data.
- **The 24-hour service window is not enforced.** `config.messaging.serviceWindowMs`
  exists but is never read: there is no proactive window check and no template
  fallback. Meta enforces the window server-side, so an out-of-window free-form
  send fails as an API error in the logs.
- **Read receipts are implemented but never invoked.** `markRead()` exists in the
  WhatsApp adapter and the fake, but nothing calls it, so you should not expect
  blue ticks.
- **Inbound turns are deliberately delayed.** `TurnCoordinator` waits
  `MESSAGE_DEBOUNCE_MS` (3 s by default) before processing, on the simulator and
  the WhatsApp webhook alike, so bursty photos and their caption become one turn.
  That is a real latency cost on every message, and the trade is worth it: without
  it, three photos would be treated as three garments. Inside a batch, text is
  only acted on for the *last* message, and idempotency is applied to the whole
  batch before any processing.
- **A stray message can cost money.** Unrecognised text during `review` is
  interpreted as revision feedback and triggers a generation.
- **Generation can fail.** Content-policy refusals are common enough to have
  dedicated copy; they are never retried and are surfaced as a recoverable brief
  edit.

---

## 10. Deploying to WhatsApp

The short version: the only application differences are the channel and the Meta
credentials.

```bash
MESSAGING_CHANNEL=whatsapp
WHATSAPP_ACCESS_TOKEN=<permanent token>
WHATSAPP_PHONE_NUMBER_ID=<phone number id>
WHATSAPP_VERIFY_TOKEN=<a token you invent>
WHATSAPP_APP_SECRET=<app secret>
# WHATSAPP_API_VERSION keeps its v21.0 default
PUBLIC_BASE_URL=https://your-host
```

What changes behaviourally: `GET /webhook` answers Meta's `hub.challenge`
handshake, `POST /webhook` verifies the HMAC-SHA256 `X-Hub-Signature-256`
signature over the **raw** body and returns 200 before processing, inbound media
is fetched with two authenticated Graph API hops and persisted immediately
because the media URL is short-lived, and outbound images are uploaded to Meta
first and then referenced by media id. The simulator routes are not registered at
all in this mode — `/sim` answers 409 telling you the channel is not `simulator`.

Step-by-step instructions, including how to get each credential and what to do
when the webhook verification fails, are in
[docs/meta-setup.md](docs/meta-setup.md).

For container deploys the repo also ships a multi-stage [Dockerfile](Dockerfile)
(`node:24-alpine`, non-root, data on `/data`, healthcheck against `/healthz`) and
a [fly.toml](fly.toml) example that mounts one volume, keeps a single machine
always on (webhook redelivery and slow generations make scale-to-zero a bad fit)
and starts in the simulator channel. Keep the tokens out of `fly.toml` — use
provider secrets — and remember the single-instance constraint: one SQLite file
and one storage tree means one machine.

---

## 11. Roadmap / extension points

Every deferred feature has a seam waiting for it, which is why none of them
require reworking the conversation core:

| Deferred feature | Where it plugs in |
| --- | --- |
| Dedicated virtual try-on model (fal.ai, Replicate, …) | Implement `ImageProvider` in [src/imaging/types.ts](src/imaging/types.ts) and choose it in [src/providers.ts](src/providers.ts). |
| S3 / Cloudflare R2 object storage | Implement `BlobStore` in [src/media/store.ts](src/media/store.ts). |
| Postgres instead of SQLite | `Repo` is raw SQL over a narrow surface, and [src/db/schema.sql](src/db/schema.sql) is written portably (TEXT/INTEGER, ISO timestamps). |
| Per-brand style guides | `orgs.style_guide_json` already exists; pass it as `styleGuide` to `buildImagePrompt()`. |
| Garment vision pre-pass | `describeGarment()` is implemented in [src/imaging/gemini.ts](src/imaging/gemini.ts) — it needs calling from `pipeline.generate()`. |
| Outfit composition / multiple garments | `generate()`'s `inputAssets` and the prompt layers. |
| Consistent model personas | A persona table plus reference images, fed through `brief.model`. |
| Shopify / CSV export | [src/core/catalog.ts](src/core/catalog.ts) already exports CSV and is kept out of the conversation path. |
| More channels (Instagram DM, Telegram, email) | Another `DeliveryAdapter` plus a `createDeliveryAdapter()` case. |
| Read receipts | `markRead()` is implemented in the WhatsApp adapter; wire it into the inbound path. |
| 24-hour window handling and template fallback | `config.messaging.serviceWindowMs` plus a template send in the adapter. |
| Authentication on `/media` and multi-tenancy | An auth hook on the media routes plus real users/orgs. |
