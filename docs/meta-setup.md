# Wiring the real WhatsApp channel

This is the operator guide for taking the bot from the local simulator to the
Meta WhatsApp Cloud API. Everything here is about credentials, the webhook and
verification; the application itself does not change. If you only want to develop
locally, you do not need any of this — `MESSAGING_CHANNEL=simulator` (the default)
drives the same pipeline and needs no Meta account.

Read the code alongside this guide:

- [src/messaging/whatsapp.ts](../src/messaging/whatsapp.ts) — the adapter, payload
  parsing and `verifySignature()`.
- [src/api/webhook.ts](../src/api/webhook.ts) — `GET /webhook` handshake and
  `POST /webhook` signature enforcement.
- [src/config.ts](../src/config.ts) — `assertWhatsAppConfigured()`, which fails
  fast at boot if a credential is missing.
- [README.md](../README.md) — architecture, configuration and limitations.

---

## 1. Prerequisites

| What | Why |
| --- | --- |
| A **Meta Business account** ([business.facebook.com](https://business.facebook.com)) | Owns the WhatsApp Business Account (WABA) and the app assets. |
| A **phone number that is not already on WhatsApp** | The Cloud API number cannot be registered to the consumer WhatsApp app. A landline/SIM that can receive one SMS or voice call works. Meta also provides a free **test number** you can use first. |
| A **Meta developer account** and the app dashboard ([developers.facebook.com/apps](https://developers.facebook.com/apps)) | Where you create the app, add the WhatsApp product and configure the webhook. |
| The bot reachable over **public HTTPS** | Meta posts webhooks to a public URL; `http://localhost` will not work. See §5 for a tunnel. |
| A **Gemini API key** | `GEMINI_API_KEY`; without it the conversation works but generation fails. |

**About Business verification:** business verification (and, for a production
number, display-name review) is the long lead-time item — it can take days and
sometimes weeks. It is **not** required to start: the test number and up to five
verified test recipients are enough to build and exercise the whole loop, and
none of it is needed for local simulator development. Start verification early if
you know you will go live, but do not block development on it.

---

## 2. Create the app and add WhatsApp

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) →
   **Create app** → use case **Business** → name it and select your Business
   portfolio.
2. On the app dashboard, **Add product** → **WhatsApp** → **Set up**.
3. The **API Setup** (Getting Started) page now shows the values you need:

| Value | Where to find it | Env var |
| --- | --- | --- |
| **Phone number ID** | API Setup → “From” phone number → **Phone number ID** (a long numeric id, *not* the phone number itself) | `WHATSAPP_PHONE_NUMBER_ID` |
| **WhatsApp Business Account ID** | API Setup, shown near the phone number / in Business Settings → Accounts → WhatsApp Accounts | not needed by this bot (useful for support and asset assignment) |
| **Temporary access token** | API Setup → “Temporary access token” | `WHATSAPP_ACCESS_TOKEN` (for a first test only) |

### Permanent access token

The temporary token on that page **expires after 24 hours**. It is fine for a
five-minute smoke test, but a running bot with an expired token fails every send
with a Graph API 401 — and the only symptom you would see is “messages arrive but
no reply”. Generate a permanent token:

1. [business.facebook.com](https://business.facebook.com) → **Business Settings**
   → **Users** → **System users** → **Add** (create a system user, role
   **Admin** or **Employee**).
2. With that system user selected, **Add assets** → **Apps** → select your app →
   grant **Manage app** (or at minimum the WhatsApp permissions). If you can also
   add the WhatsApp account asset, do so.
3. **Generate new token** → select the app → enable the
   `whatsapp_business_messaging` permission (and `whatsapp_business_management`
   if you want to manage templates/numbers from the API) → generate.
4. Copy it **once** — Meta will not show it again — and put it in `.env` as
   `WHATSAPP_ACCESS_TOKEN`. Store it in a secret manager for deployments.

System-user tokens are long-lived rather than permanently immortal: they stop
working if the system user is deleted, the asset assignment is removed, or the
password/token policy invalidates them. Rotate deliberately (§8).

---

## 3. Add and verify a test recipient

While the app is in development mode, you can only message numbers you have
explicitly added:

1. API Setup → **To** field → **Manage phone number list**.
2. Add the WhatsApp number you will test from (your own phone) and complete the
   verification code Meta sends it.
3. Send a message *from* that phone to the business number to open a conversation,
   then reply from the bot.

Sandbox limitations to expect:

- Up to **5 verified test recipients**; messages to any other number fail.
- Only **free-form** messages are allowed, and only inside the **24-hour service
  window** that the recipient opens by messaging you first. There is no
  template fallback in this codebase (see §7).
- The test number shows a Meta-provided display name and is clearly a test
  sender; some media and formatting behaviours differ from a production number.
- Rate limits and daily message allowances are much lower than production.

---

## 4. App Secret and verify token

### App Secret (webhook signature)

1. App dashboard → **App settings** → **Basic**.
2. **App secret** → **Show** and copy it.
3. Put it in `.env` as `WHATSAPP_APP_SECRET`.

Each `POST /webhook` must carry `X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of
the raw body using the App Secret>`. [src/messaging/whatsapp.ts](../src/messaging/whatsapp.ts)
computes the expected digest, accepts the header with or without the `sha256=`
prefix, and compares in constant time. If the secret is wrong or missing you get a
401 and a `rejected webhook with invalid signature` warning in the logs. If
`WHATSAPP_APP_SECRET` is not set at all, every POST is refused with
`503 {"error":"whatsapp_not_configured"}` — that is a configuration error, not an
attack.

### Verify token (webhook handshake)

This is **a random string you invent**, not something Meta issues. Pick a long
random value and use exactly the same string in two places:

```bash
openssl rand -hex 24        # example value
```

- `.env`: `WHATSAPP_VERIFY_TOKEN=<that value>`
- Meta: the webhook configuration in §5.

The project's implemented handshake, in [src/api/webhook.ts](../src/api/webhook.ts):

| Request | Project response |
| --- | --- |
| `GET /webhook?hub.mode=subscribe&hub.verify_token=<match>&hub.challenge=<n>` | `200`, body is the challenge echoed as `text/plain` |
| Token mismatch or `hub.mode` not `subscribe` | `403 {"error":"forbidden"}` |
| `WHATSAPP_VERIFY_TOKEN` unset | `503 {"error":"whatsapp_not_configured"}` |

---

## 5. Configure the webhook

1. Make the service publicly reachable over **HTTPS**. For local testing use a
   tunnel that terminates TLS and forwards to port 3000:

   ```bash
   # either
   cloudflared tunnel --url http://localhost:3000
   # or
   ngrok http 3000
   ```

   Copy the `https://…` URL the tunnel prints. Free tunnels change hostname on
   restart, so re-paste the callback URL in Meta whenever it does. For anything
   long-lived, put the service behind a stable domain and a reverse proxy.

2. App dashboard → **WhatsApp** → **Configuration** → **Webhook** → **Edit**:
   - **Callback URL**: `https://<your-host>/webhook`
   - **Verify token**: the value you invented in §4
   - **Verify and save** — Meta immediately calls `GET /webhook` with
     `hub.mode=subscribe`; the service must be running and healthy at that moment
     or the save fails.

3. Still on **Configuration**, under **Webhook fields**, **Manage** → subscribe to
   **`messages`**. Without this subscription Meta will verify the webhook and
   then never deliver a message. This project parses only the `messages` field
   (text, image, document, interactive button/list replies, plus delivery
   statuses).

### Environment

Set these in `.env` (see [.env.example](../.env.example) for the annotated
version):

```bash
MESSAGING_CHANNEL=whatsapp
WHATSAPP_ACCESS_TOKEN=<permanent system-user token>
WHATSAPP_PHONE_NUMBER_ID=<phone number id>
WHATSAPP_VERIFY_TOKEN=<the token you invented>
WHATSAPP_APP_SECRET=<app secret>
WHATSAPP_API_VERSION=v21.0        # the default; pinned deliberately
PUBLIC_BASE_URL=https://<your-host>
```

Notes:

- `MESSAGING_CHANNEL=whatsapp` is the only switch that changes behaviour. At boot,
  `assertWhatsAppConfigured()` throws `MESSAGING_CHANNEL=whatsapp requires: …`
  listing any missing credential, so a misconfiguration fails immediately rather
  than as a confusing 401 later.
- `WHATSAPP_API_VERSION` is used to build
  `https://graph.facebook.com/<version>`; keep it pinned and change it only after
  testing.
- `PUBLIC_BASE_URL` is used for the startup log line and as the canonical public
  URL; it does not affect webhook routing.
- Restart the server after changing `.env`.

---

## 6. Verify it works end to end

1. Start the service and read the first log lines:

   ```bash
   ./run.sh pnpm dev
   ```

   Expect `app built` with `channel: "whatsapp"` and your image model. No
   `assertWhatsAppConfigured` error, no `GEMINI_API_KEY is not set` warning.

2. Health check:

   ```bash
   curl -s http://localhost:3000/healthz
   # {"status":"ok","channel":"whatsapp","model":"gemini-nano-banana-2.1",
   #  "providerConfigured":true,"uptimeSeconds":…}
   ```

   `channel` must be `whatsapp` and `providerConfigured` must be `true`.

3. In Meta, re-save the webhook (or use **Test** on the `messages` field) and
   confirm the log shows `webhook verification succeeded`. A failed handshake
   logs `webhook verification failed` and returns 403.

4. From your verified test phone, message the business number: send **`hi`** and
   expect the greeting.

5. Send a **garment photo** (one to three angles). Expect *“Got your photo…”* and
   the prompt for a style description. Send something like
   *“studio, white background, walking pose, 4:5”* and expect the bulleted brief
   back with *“Reply go to generate”*.

6. Reply **`go`**. Expect the “On it — generating …” message, then the image, then
   the review menu. Try **`2, make the light warmer`** (a targeted edit), **`3`**
   (variations), **`4`** (show the brief), and finally **`1`** to approve.

7. Check the catalog — the approved item should appear:

   ```bash
   curl -s http://localhost:3000/api/catalog
   ```

8. Useful log lines to look for:

   | Log | Meaning |
   | --- | --- |
   | `webhook verification succeeded` | The `GET` handshake matched the verify token. |
   | `rejected webhook with invalid signature` | HMAC mismatch — wrong App Secret, or a proxy rewrote the body. |
   | `duplicate inbound delivery ignored` | A Meta retry of a message id already stored; no work done. |
   | `generation succeeded` | Includes `latencyMs`, `costUsd` and `remaining` generations. |
   | `generation failed` / `content policy` | A refusal or provider error; the user is told and the brief stays editable. |
   | `WhatsApp API <status> on <phoneNumberId>/messages` | A send failed — expired token, wrong recipient, or the 24 h window. |

---

## 7. Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| **Webhook verification fails, `403 {"error":"forbidden"}`** on Meta's “Verify and save”. | The `hub.verify_token` Meta sent does not equal `WHATSAPP_VERIFY_TOKEN`, or `hub.mode` is not `subscribe`. Fix the value in `.env` and restart, then re-save. If `WHATSAPP_VERIFY_TOKEN` is unset the project answers **503 `whatsapp_not_configured`** instead — set it. Check the service is actually reachable at `https://<host>/webhook` (a tunnel that is not running, or an HTTP-only URL, fails before the app sees anything). |
| **`POST` rejected, `401 {"error":"invalid_signature"}`.** | `WHATSAPP_APP_SECRET` does not match the app Meta is signing with, or the bytes Meta signed are not the bytes received. Verify the secret in App settings → Basic. Do not put a body-rewriting middleware, WAF transform or compression proxy in front of `/webhook`: the HMAC is over the **exact raw body**, so any transformation breaks it. A raw-body parser is registered before the routes for this reason ([src/api/body.ts](../src/api/body.ts)). An unsigned request (no `X-Hub-Signature-256`) is also a 401 by design. If the secret is unset you get **503 `whatsapp_not_configured`**. |
| **Media download fails with 401, or “metadata contained no url”.** | Inbound media takes two authenticated Graph API hops: the media id → a short-lived URL, then that URL → bytes, both with the bearer token. A 401 means the token is expired, revoked, or lacks `whatsapp_business_messaging`. “Expired URL” errors are expected if bytes are fetched late — the project downloads and persists immediately on receipt, so a persistent failure means the token, not the timing. Look for `WhatsApp media metadata <status>` / `WhatsApp media download <status>` in the logs; the user is told the download failed and simply gets the “trouble downloading that photo” message. |
| **Messages arrive but there is no reply.** | First rule out the expected delay: inbound turns are debounced by `MESSAGE_DEBOUNCE_MS` (3 s by default) so that bursty photos and their caption become one turn, so a reply is never instant. After that, in order of likelihood: the access token expired (the 24 h temporary token) — check for `WhatsApp API 401` in the logs and switch to a permanent system-user token; `GEMINI_API_KEY` is missing so no image can be produced (the boot log warns, and generation replies with a failure); the `messages` field subscription is not enabled; or the webhook is accepted but the failure happens after the 200 — the webhook answers immediately and processes afterwards, so **anything that fails after acceptance only appears in the logs**, never in the HTTP response. Also confirm `/healthz` reports `channel: "whatsapp"`. |
| **Replies fail with “outside 24h window”.** | WhatsApp only allows free-form messages within **24 hours** of the user's last message. This codebase has **no template fallback and no proactive window check** (see the limitations in the [README](../README.md)), so an out-of-window send is simply rejected by the Graph API and surfaced in the logs as `WhatsApp API 400 on <phoneNumberId>/messages: …`. The fix for the user is to message the business again to reopen the window; the fix for a product is to send an approved template message first. |
| **Duplicate replies.** | Meta retries webhooks aggressively, so a message id is stored once and duplicate deliveries are suppressed through the unique `(direction, external_id)` index on `messages` ([src/db/schema.sql](../src/db/schema.sql)) — expect `duplicate inbound delivery ignored` in the logs. Real duplicate *replies* therefore mean one of: two processes sharing one database (SQLite plus local disk is single-instance only), a database that was reset between the two deliveries, a message id that differs between the two deliveries (e.g. the same content sent twice, which is two genuine messages), or an accepted webhook whose processing failed and was retried after the id was recorded. Run one instance, and persist the database. |
| **`/sim` returns 409.** | Expected: the local simulator is only enabled when `MESSAGING_CHANNEL=simulator`. The 409 body names the channel currently configured; set `MESSAGING_CHANNEL=simulator` and restart to use the chat UI. In `whatsapp` mode the other simulator routes (`/sim/message`, `/sim/events`, `/sim/blob/*`) are not registered at all and return 404. |
| **Boot fails with `MESSAGING_CHANNEL=whatsapp requires: …`** | One or more of `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` is empty. The message lists exactly which. |
| **Outbound image sends fail while text works.** | Images are uploaded to `POST /<phoneNumberId>/media` first and then referenced by id; a failure there is a token/permission or file-size problem, logged as `WhatsApp media upload <status>`. Text sends do not take that path. |

---

## 8. Security checklist

- [ ] **Never commit tokens.** `.env` is git-ignored (`.gitignore`); keep
      `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` and
      `GEMINI_API_KEY` in a secret manager for anything deployed. Do not paste them
      into tickets, chats, screenshots or logs.
- [ ] **Rotate on exposure.** If the App Secret leaks, rotate it in App settings →
      Basic and update `.env` (signature verification uses it, so the webhook
      briefly rejects until redeployed — that is the safe failure direction). If a
      token leaks, revoke the system user's token and generate a new one.
- [ ] **Use a system-user token, not a personal token,** and rotate it on a
      schedule. Scope it to `whatsapp_business_messaging` and the one app.
- [ ] **Restrict the webhook.** HMAC verification is the real control, but also
      terminate TLS properly, forward to `/webhook` without body transformation,
      and rate-limit at the edge. Treat the verify token as a secret too: it guards
      the handshake, though not message delivery.
- [ ] **Remember `/media/:assetId` and `/api/catalog` are unauthenticated** —
      “access is knowing the UUID” ([src/api/media.ts](../src/api/media.ts)). Do not
      expose them to the public internet; put them behind a private network or add
      authentication before any public deployment. The same applies to the
      SQLite file and `STORAGE_DIR`: they hold every garment photo and every
      generated shot.
- [ ] **Keep the database and uploads on a persistent, private volume.** Losing
      `/media` bytes while rows remain produces `410 asset_bytes_missing` for
      already-approved catalog items.
- [ ] **Back up `DATABASE_PATH` and `STORAGE_DIR` together** — the database stores
      asset rows that point into the storage tree.
- [ ] **Watch the cost controls.** `MAX_GENERATIONS_PER_SESSION` (default 15 per
      item) is the only hard spend limit; cost is logged as an indicative estimate,
      not a budget alarm.
