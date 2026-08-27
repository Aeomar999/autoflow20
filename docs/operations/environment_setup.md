# AutoFlow Setup Manual

**Read when:** you are setting the project up from zero, obtaining any `.env`
value, exposing local webhooks to the internet, or deploying to production.

This is the complete operator's guide: every environment variable, where each
one comes from, how to run the stack locally, how to expose it publicly for
webhook testing, and how to ship it online. For a machine-specific, already
verified walkthrough of Jerry's Windows/Podman setup, see
[`local_setup_guide.md`](./local_setup_guide.md).

> **Truth discipline:** reconciled against actual code reads on 2026-08-25
> (`src/lib/env.ts`, `src/lib/auth.ts`, `src/lib/polar.ts`, `next.config.ts`,
> `sentry.*.config.ts`, `package.json`, webhook routes). Where a variable is
> optional it really is optional; where a value is hardcoded that is stated.

## Table of contents

1. [What runs locally](#1-what-runs-locally)
2. [Prerequisites](#2-prerequisites)
3. [Quick start](#3-quick-start)
4. [Environment variable reference](#4-environment-variable-reference)
5. [How to obtain every value](#5-how-to-obtain-every-value)
6. [Running locally — full walkthrough](#6-running-locally--full-walkthrough)
7. [Exposing local dev to the internet (ngrok)](#7-exposing-local-dev-to-the-internet-ngrok)
8. [Deploying online (production)](#8-deploying-online-production)
9. [Database operations (Prisma 7)](#9-database-operations-prisma-7)
10. [Troubleshooting](#10-troubleshooting)
11. [Hard rules](#11-hard-rules)

---

## 1. What runs locally

```
+---------------------------+       +--------------------------+
| next dev (:3000)          |<----->| Postgres 16 (:5432)      |
| UI + tRPC + auth +        |       | Docker/Podman container  |
| webhooks + Inngest serve  |       +--------------------------+
+-------------^-------------+
              |
              v
+---------------------------+
| inngest-cli dev (:8288)   |  durable workflow runtime +
| dev UI + event delivery   |  realtime execution streaming
+---------------------------+
```

| Piece | What it needs from `.env` |
|---|---|
| Next.js server (`npm run dev`) | `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ENCRYPTION_KEY`, `CREDENTIAL_MASTER_KEY` |
| Better Auth (`/login`, `/signup`) | same four; social providers only if their vars are set |
| Prisma 7 CLI (via `prisma.config.ts`) | `DATABASE_URL` (schema-level `url` was removed in v7 — P1012 without it) |
| Prisma 7 runtime client | driver adapter `@prisma/adapter-pg`, wired in `src/lib/db.ts` |
| Inngest dev server (`npm run inngest:dev`) | nothing — cloud keys are production-only |
| Credential encryption (envelope, `src/lib/crypto.ts`) | `CREDENTIAL_MASTER_KEY` |
| (legacy Cryptr path, `src/lib/encryption.ts`) | `ENCRYPTION_KEY` — replaced by the master-key envelope in AF-M3-02 |

Boot-time Zod validation lives in `src/lib/env.ts`, called from
`src/instrumentation.ts`. A bad or missing required value stops the boot with
one readable error naming every offending variable. Set
`SKIP_ENV_VALIDATION=1` to bypass (CI and tests do this).

**AI node API keys (OpenAI/Anthropic/Gemini), Discord/Slack tokens etc. are
NOT env variables.** They are entered per-user through the app's Credentials
UI, encrypted at rest with the credential vault (envelope encryption keyed by
`CREDENTIAL_MASTER_KEY`, `src/lib/crypto.ts`), and injected into nodes at
execution time. Never put them in `.env`.

---

## 2. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20 LTS+ | Next.js 15.5 requirement |
| npm | 10+ | lockfile is npm; do not mix package managers |
| Git | recent | clone/push |
| PostgreSQL 16 | local container **or** hosted | §5.1 covers both |
| Docker **or** Podman | recent | easiest local Postgres route |
| ngrok agent | latest | only for §7; `winget install ngrok.ngrok` |

Inngest CLI ships as a devDependency — nothing global to install.

---

## 3. Quick start

```bash
git clone https://github.com/Aeomar999/autoflow20.git autoflow20
cd autoflow20
npm ci
cp .env.example .env          # then fill values per section 5
docker run --name autoflow-db -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=autoflow -p 5432:5432 -d postgres:16
npx prisma migrate deploy     # apply all migrations
npx prisma generate           # client -> src/generated/prisma
npm run dev:all               # mprocs: next + inngest (+ ngrok if configured)
```

- App: http://localhost:3000
- Inngest dev UI: http://localhost:8288
- DB browser: `npx prisma studio`

`npm run dev` alone starts only Next.js — workflows enqueue but never execute.
Use `dev:all` whenever you touch execution.

---

## 4. Environment variable reference

`.env.example` is the template; `src/lib/env.ts` validates at boot. These
tables are the source of truth for meaning and requiredness.

### 4.1 Required — app refuses to boot without them

| Variable | Example | Used by | Purpose |
|---|---|---|---|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/autoflow?schema=public` | Prisma CLI + runtime adapter | single Postgres connection string |
| `BETTER_AUTH_SECRET` | 32+ random chars | `src/lib/auth.ts` | session signing secret |
| `BETTER_AUTH_URL` | `http://localhost:3000` | Better Auth | base URL for auth callbacks/redirects; must be browser-reachable |
| `ENCRYPTION_KEY` | 64 hex chars | `src/lib/encryption.ts` | legacy symmetric key for stored credentials; being replaced by the envelope vault (AF-M3-02) |
| `CREDENTIAL_MASTER_KEY` | base64 of 32 bytes | `src/lib/crypto.ts` | KEK of the envelope-encrypted credential vault; app refuses to boot without it |

### 4.2 Optional — features degrade cleanly when unset

| Variable | Used by | Purpose when set |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `publicAppUrl` export | public base URL rendered into trigger/webhook URLs in the UI; defaults to localhost:3000 |
| `GITHUB_CLIENT_ID` / `_SECRET` | `src/lib/auth.ts` | enables GitHub sign-in |
| `GOOGLE_CLIENT_ID` / `_SECRET` | `src/lib/auth.ts` | enables Google sign-in |
| `POLAR_ACCESS_TOKEN` | `src/lib/polar.ts` | Polar API access; billing calls fail without it |
| `POLAR_SUCCESS_URL` | checkout plugin | server-side post-checkout redirect |
| `POLAR_PRODUCT_ID` | `polarProductId` export | Pro product UUID; unset = empty products list, app still boots |
| `POLAR_PRODUCT_SLUG` | `polarProductSlug` export | server-side slug override |
| `NEXT_PUBLIC_POLAR_PRODUCT_SLUG` | client checkout buttons | slug for sidebar/upgrade-modal checkout; falls back to `"pro"` |
| `INNGEST_EVENT_KEY` | SDK convention | production event ingestion only |
| `INNGEST_SIGNING_KEY` | SDK convention | verifies inbound Inngest requests (required on cloud) |
| `STRIPE_WEBHOOK_SECRET` | stripe webhook route | signature verification; unsigned requests rejected |
| `SENTRY_AUTH_TOKEN` | build-time plugin | source-map upload only; DSNs are hardcoded |
| `NGROK_URL` | `ngrok:dev` script | reserved static domain for section 7 |
| `LOG_LEVEL` | `src/lib/logger.ts` | debug/info/warn/error, default info |
| `ENGINE_RETRIES` | `src/inngest/config.ts` | engine retry count 0-20, default 3 |

**Test tooling** (not read by application code): `TEST_DATABASE_URL` points the
`integration` vitest project at its own Postgres — contract and local Docker
recipe in `docs/engineering/testing_strategy.md` §6; without it those suites
skip visibly. `SKIP_ENV_VALIDATION=1` bypasses boot validation (CI/builds).

> **Known hardcoded values (not env-configurable yet):** Polar targets
> `server: "sandbox"` (`src/lib/polar.ts`); Sentry DSNs are literal in the
> three `sentry.*.config.ts` / `instrumentation-client.ts` files; Sentry
> org/project literal in `next.config.ts`. Tracked as defect D9. Consequence:
> real-money billing needs a one-line code change before going live (section 8
> step 6).

---

## 5. How to obtain every value

### 5.1 `DATABASE_URL` — Postgres

**Option A — local container (recommended for dev):**

```bash
# Docker
docker run --name autoflow-db -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=autoflow -p 5432:5432 -d postgres:16

# Podman (Windows)
podman run --name autoflow-db -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=autoflow -p 5432:5432 -d docker.io/library/postgres:16
```

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/autoflow?schema=public"
```

**Option B — free hosted Postgres (Neon):**

1. Account at https://neon.tech -> New Project.
2. Copy the pooled connection string from the dashboard.
3. For `prisma migrate` commands prefer the **direct** (unpooled) host; for the
   running app the pooled string is fine. Both appear under Connection Details.

Any Postgres >= 15 works identically (Supabase, Railway, RDS...).

### 5.2 `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY` and `CREDENTIAL_MASTER_KEY` — generated secrets

Generate locally; no provider involved:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # BETTER_AUTH_SECRET and CREDENTIAL_MASTER_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"      # ENCRYPTION_KEY
```

All must be >= 32 chars (Zod enforces; `CREDENTIAL_MASTER_KEY` has the stricter
32-byte-base64 requirement). Never reuse dev values in production. Rotating
`ENCRYPTION_KEY` makes previously saved credentials undecryptable; rotating
`CREDENTIAL_MASTER_KEY` works through the versioned re-wrap path
(`src/lib/crypto.ts`) once the vault stores `keyVersion` per row (AF-M3-02).

### 5.3 GitHub OAuth (optional)

1. https://github.com/settings/developers -> OAuth Apps -> **New OAuth App**.
2. Fill in:
   - Application name: `AutoFlow (dev)`
   - Homepage URL: `http://localhost:3000`
   - Authorization callback URL:
     `http://localhost:3000/api/auth/callback/github`
3. Register -> copy the Client ID.
4. Generate a new client secret -> copy it once (GitHub hides it afterwards).

```env
GITHUB_CLIENT_ID="Iv1.xxxxxxxxxxxxxxxx"
GITHUB_CLIENT_SECRET="long-secret"
```

### 5.4 Google OAuth (optional)

1. https://console.cloud.google.com -> create/select a project.
2. APIs & Services -> OAuth consent screen: External, fill app name + your
   email, add yourself as test user while in Testing mode.
3. Credentials -> Create credentials -> OAuth client ID:
   - Type: Web application
   - Authorized JavaScript origins: `http://localhost:3000`
   - Authorized redirect URIs:
     `http://localhost:3000/api/auth/callback/google`
4. Copy client ID + secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

For deployment repeat with your production domain added alongside localhost.

### 5.5 Polar (billing)

Polar has sandbox (fake money) and production. The SDK client here targets
**sandbox** today, so obtain sandbox values:

1. Sign up at https://sandbox.polar.sh.
2. Settings -> API keys -> create access token -> `POLAR_ACCESS_TOKEN`.
3. Products -> New product ("Pro", monthly price) -> publish; copy the product
   UUID from its page URL -> `POLAR_PRODUCT_ID`.
4. Checkout slug users see, e.g. `pro` -> set both `POLAR_PRODUCT_SLUG` and
   `NEXT_PUBLIC_POLAR_PRODUCT_SLUG`.
5. `POLAR_SUCCESS_URL`: point at an existing route — note there is no
   `/workflows/billing/success` page yet, so use
   `http://localhost:3000/workflows`.
6. Configure a Beneficiary under Settings if prompted; sandbox checkout needs
   one before completing.

With no Polar vars at all: sign-up works, upgrade buttons open broken
checkouts, premium gates deny paid actions. Fine for pure development.

### 5.6 Inngest keys

Local dev: none needed — `inngest-cli dev` discovers
`http://localhost:3000/api/inngest` automatically.

Production (Inngest Cloud):

1. Account at https://www.inngest.com -> Create app.
2. App dashboard -> Keys tab: Event Key (`INNGEST_EVENT_KEY`) lets the app send
   events; Signing Key (`INNGEST_SIGNING_KEY`) proves inbound requests to
   `/api/inngest`. Set both on your host.
3. Register your deployed sync URL `https://your-domain.com/api/inngest`
   in the Inngest dashboard (section 8 step 5).

### 5.7 Stripe webhook secret

Needed only for Stripe trigger workflows.

Local (Stripe CLI):

```bash
stripe login
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# prints whsec_...  -> STRIPE_WEBHOOK_SECRET
```

Hosted: dashboard.stripe.com/webhooks -> Add endpoint ->
`https://your-domain.com/api/webhooks/stripe?workflowId=<id>&secret=<wf-secret>`
(query params come from the app's Stripe trigger dialog, which embeds a
per-workflow secret) -> copy the endpoint Signing secret (`whsec_...`).
Signing secrets are per-endpoint: local CLI and hosted endpoints differ.

### 5.8 Sentry auth token

Runtime error reporting works out of the box (DSNs hardcoded). The token is
only needed so `next build` uploads source maps:

1. sentry.io -> Settings -> Auth Tokens -> Create New Token.
2. Scope for the org/project in `next.config.ts` (`enra-doo/nodebase`) with
   project:releases write access.
3. `SENTRY_AUTH_TOKEN="sntrys_..."` — CI/build environments only.

To fully own Sentry (own DSN/org), replace the three hardcoded DSNs plus the
`org`/`project` fields — tracked defect D9.

### 5.9 ngrok reserved domain

Only for section 7 (public webhook ingress against your laptop):

1. Free account at https://dashboard.ngrok.com.
2. Once: `ngrok config add-authtoken <token-from-dashboard>`.
3. Universal Gateway -> Domains -> claim a free static domain
   (e.g. `example-loved-mammal.ngrok-free.app`) -> `NGROK_URL`.

---

## 6. Running locally — full walkthrough

1. **Install:** `npm ci`.
2. **Start Postgres** (5.1 option A); verify:
   `docker exec -it autoflow-db pg_isready -U postgres`.
3. **Create `.env`:** `cp .env.example .env`; minimum is the four required
   values (5.1, 5.2) with `BETTER_AUTH_URL=http://localhost:3000`. Add
   integrations lazily — everything else is optional.
4. **Apply migrations:** `npx prisma migrate deploy` (first run creates all
   tables incl. `NodeExecution` traces and drops the dead tutorial `Post`
   table).
5. **Generate client:** `npx prisma generate` (skip if you ran `migrate dev`,
   which regenerates automatically).
6. **Run the stack:** `npm run dev:all`. mprocs opens panes: `next` (:3000),
   `inngest` (:8288), `ngrok` (exits immediately until NGROK_URL is set — that
   pane failing is normal).
7. **Verify boot:** open http://localhost:3000 -> redirects to `/workflows` ->
   bounced to `/login` unauthenticated.
8. **Smoke test the loop:**
   - Sign up at `/signup` (email/password; or GitHub/Google if configured).
   - Create a workflow -> add Manual Trigger + HTTP Request node (URL
     `https://example.com`) -> connect nodes -> Ctrl+S to save.
   - Click Run on the trigger node; watch the run at localhost:8288 and the
     live stream in the editor.
   - Executions page: run detail shows per-node traces (status, duration,
     attempts) from AF-A-05.

---

## 7. Exposing local dev to the internet (ngrok)

Webhook triggers (Stripe, Google Forms) need a URL providers can reach.
Tunnel your laptop:

1. Put `NGROK_URL` in `.env` (5.9).
2. Point the app's public-URL notion at the tunnel, otherwise auth callbacks
   and generated webhook URLs keep saying localhost:
   ```env
   BETTER_AUTH_URL="https://example-loved-mammal.ngrok-free.app"
   NEXT_PUBLIC_APP_URL="https://example-loved-mammal.ngrok-free.app"
   ```
3. Restart `npm run dev:all`; the ngrok pane now forwards the domain to
   localhost:3000. Manual equivalent: `ngrok http --url=$NGROK_URL 3000`.
4. Register the public webhook with the provider using the exact URL copied
   from the app's trigger dialog (includes workflowId + secret params).
5. When finished, revert both vars to localhost so browser flows stop
   bouncing off the tunnel.

Free-tier caveat: ngrok shows an interstitial warning to first-time visitors;
some provider verifications need a one-time browser pass through it.

---

## 8. Deploying online (production)

Target: **Vercel** (Next.js-native) + managed **Postgres** + **Inngest Cloud**
+ Polar production. No Dockerfile exists; Vercel builds from the repo.

### 8.1 Provision production Postgres

1. Create a Neon/Supabase/RDS instance; enable backups.
2. If pooling is offered, keep two strings: direct host for migrations,
   pooled for the app.
3. Apply the schema once from your machine:

```bash
DATABASE_URL="<direct-url>" npx prisma migrate deploy
```

### 8.2 Create the Vercel project

1. Import the GitHub repo at vercel.com/new; framework auto-detects Next.js.
2. Add environment variables (Production scope) — the required four plus
   every integration you want live:

| Variable | Production value |
|---|---|
| `DATABASE_URL` | prod URL with `?sslmode=require` |
| `BETTER_AUTH_SECRET` | fresh 32+ char secret (never the dev value) |
| `BETTER_AUTH_URL` | `https://your-domain.com` |
| `ENCRYPTION_KEY` | fresh 64-hex key (never the dev value) |
| `CREDENTIAL_MASTER_KEY` | fresh 32-byte base64 key (never the dev value) |
| `NEXT_PUBLIC_APP_URL` | `https://your-domain.com` |
| GitHub/Google OAuth pairs | prod apps with prod callback URLs |
| Polar set (token/product/slug/success URL) | see 8.4 |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | from Inngest Cloud |
| `STRIPE_WEBHOOK_SECRET` | live-mode endpoint secret |

3. Deploy. A first-build failure almost always means boot validation tripped;
   the build log names the exact variable.

### 8.3 Wire Inngest Cloud

1. In Inngest Cloud, create the app and copy Event Key + Signing Key into
   Vercel env (then redeploy).
2. Add an app in the Inngest dashboard with sync URL
   `https://your-domain.com/api/inngest`.
3. Confirm the functions list shows `execute-workflow` after handshake.

### 8.4 Billing in production — known blocker

`src/lib/polar.ts` pins the SDK to `server: "sandbox"`. For real money:

1. Create the production product at https://polar.sh (not sandbox); obtain a
   production access token; swap into Vercel env.
2. Edit `src/lib/polar.ts` to `server: "production"`.
3. Point `POLAR_SUCCESS_URL` and the OAuth callbacks at the prod domain.
4. Redeploy.

### 8.5 Stripe live webhook

1. Stripe dashboard (live mode) -> Webhooks -> Add endpoint:
   `https://your-domain.com/api/webhooks/stripe`.
2. Copy the endpoint signing secret into Vercel `STRIPE_WEBHOOK_SECRET`.
3. Per-workflow URLs: copy from the app's trigger dialog on the deployed
   domain and register them in Stripe.

### 8.6 Custom domain + final checks

1. Add your domain in Vercel -> Domains; update `BETTER_AUTH_URL`,
   `NEXT_PUBLIC_APP_URL`, and the Polar success URL to match.
2. Verify: sign-up works; a manual-trigger run executes end to end; an error
   shows in Sentry; checkout opens in Polar production.

Later releases that change the schema ship a migration; run
`npx prisma migrate deploy` against prod (or add it as a Vercel build step)
before/with the deploy.

---

## 9. Database operations (Prisma 7)

> **Prisma 7 notes.** The CLI no longer reads `DATABASE_URL` from the schema —
> connection config lives in **`prisma.config.ts`**, which loads `.env` via
> `dotenv/config`. The runtime client requires a driver adapter:
> `src/lib/db.ts` passes `new PrismaPg({ connectionString })` from
> `@prisma/adapter-pg`. The generated client is plain ESM TypeScript in
> `src/generated/prisma`; import from `@/generated/prisma/client`.

```bash
npx prisma migrate dev --name <change>   # author + apply locally
npx prisma migrate deploy                # apply in CI/production
npx prisma generate                      # regenerate client
npx prisma studio                        # browse data
```

**Never** `prisma db push` or `migrate reset` against a database you did not
create this session; migrations are the only sanctioned schema path.

Test DB strategy (`TEST_DATABASE_URL`, per-suite truncation) is planned under
AF-M0-06 and blocked until wired; CI today provisions its own `autoflow_test`
Postgres service container.

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Boot error listing variables | required env missing/invalid | read the message, fix `.env`, restart |
| `PrismaClientInitializationError` | `DATABASE_URL` wrong or DB down | check container/service and URL |
| P1012 from Prisma CLI | Prisma 7 needs config-file env load | keep `prisma.config.ts`; ensure `.env` exists |
| Types missing from `@/generated/prisma` | client not regenerated | `npx prisma generate` |
| Workflows enqueue but never run | only `npm run dev` running | use `npm run dev:all` |
| mprocs ngrok pane exits instantly | no `NGROK_URL` set (normal) or ngrok unauthenticated | ignore, or run `ngrok config add-authtoken` |
| Social sign-in fails at provider | callback URL mismatch | must be exactly `<BETTER_AUTH_URL>/api/auth/callback/<provider>` |
| Checkout opens but lands wrong | `POLAR_SUCCESS_URL` points at a nonexistent route | point it at `/workflows` (no billing/success page exists yet) |
| Stripe webhook returns 500 | `STRIPE_WEBHOOK_SECRET` unset or wrong endpoint secret | set the value printed by `stripe listen` / dashboard endpoint |
| Playwright form never hydrates | cross-origin host block in dev | use `http://localhost:3000`, never `127.0.0.1`, as baseURL |
| E2E signup HTTP 500 | signup creates a real Polar customer | valid sandbox token + deliverable-looking email domain |
| Empty list where data should be | prefetch/query failed | server log; rerun with `LOG_LEVEL=debug` |

---

## 11. Hard rules

- **[HARD]** Never commit `.env`. `.env.example` carries names and dummy
  values only.
- **[HARD]** Client-readable values must be `NEXT_PUBLIC_`-prefixed — and that
  means they are public. Never prefix a secret.
- Adding or renaming a variable means updating all four places in the same PR:
  `.env.example`, `src/lib/env.ts`, this document, and the deployment
  environment.
- Read env through `src/lib/env.ts` exports (`ensureEnv`, `publicAppUrl`,
  `polarProductId`, `polarProductSlug`) in feature code; nodes read `ctx.env`,
  never `process.env`.
- Dev and production secrets are always different values, especially
  `ENCRYPTION_KEY` / `CREDENTIAL_MASTER_KEY` (credential decryptability) and
  `BETTER_AUTH_SECRET` (session forgery).

