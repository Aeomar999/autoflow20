# Local Setup Guide — autoflow20 (Windows)

**Read when:** you cloned this repo fresh, your `.env` is empty, or the app will not boot.
This guide reflects the **actual verified state of Jerry's machine as of 2026-08-24** —
every value below was tested against real code reads and a live boot. It complements
the generic reference in [`environment_setup.md`](./environment_setup.md).

---

## Table of contents

1. [What the stack is](#1-what-the-stack-is)
2. [What is already set up on this machine](#2-what-is-already-set-up-on-this-machine)
3. [The `.env` file — full reference](#3-the-env-file--full-reference)
4. [How each value was produced](#4-how-each-value-was-produced)
5. [Running the project](#5-running-the-project)
6. [Database management](#6-database-management)
7. [Optional integrations](#7-optional-integrations-githubgoogle-polar-stripe-inngest-cloud)
8. [Troubleshooting](#8-troubleshooting)
9. [Verification checklist](#9-verification-checklist-all-passing-as-of-2026-08-24)

---

## 1. What the stack is

AutoFlow is a Next.js 15 app with three moving parts in development:

```
┌────────────────────────┐     ┌──────────────────────┐     ┌─────────────────────────┐
│ next dev (:3000)       │────▶│ Postgres 16 (:5432)  │◀────│ inngest-cli dev (:8288) │
│ UI + tRPC API + auth   │     │ via Podman container │     │ durable job runtime     │
└────────────────────────┘     └──────────────────────┘     └─────────────────────────┘
```

| Piece | What it needs from `.env` |
|---|---|
| Next.js server | `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ENCRYPTION_KEY`, `CREDENTIAL_MASTER_KEY`, `NEXT_PUBLIC_APP_URL` |
| Better Auth (email/password sign-up at `/login`) | same as above; social providers only if configured |
| Prisma 7 CLI (`prisma.config.ts` + `dotenv`) | `DATABASE_URL` (schema-level `url` was removed in v7 — P1012) |
| Prisma 7 runtime client | driver adapter `@prisma/adapter-pg`, wired in `src/lib/db.ts` |
| Inngest dev server (`npm run inngest:dev`) | nothing — cloud keys are production-only |
| Credential vault (envelope, `src/lib/crypto.ts`) | `CREDENTIAL_MASTER_KEY` |
| (legacy Cryptr path, `src/lib/encryption.ts`) | `ENCRYPTION_KEY` — replaced by the vault in AF-M3-02 |

Boot-time validation lives in `src/lib/env.ts`: on startup the app parses `.env`
against a Zod schema and **refuses to boot with a single readable error naming every
offending variable** if anything required is missing. Set nothing else up until that
error is gone.

---

## 2. What is already set up on this machine

You do **not** need to reinstall or re-provision anything. As of 2026-08-24:

| Component | State |
|---|---|
| Node.js v24.13.0 / npm 11.4.2 | installed |
| `node_modules` | present (`npm ci` already run once) |
| Podman Desktop | running, WSL distro `podman-machine-default` |
| Container **`autoflow-db`** | postgres:16 running, port forwarded to `localhost:5432` |
| Database **`autoflow20`** | created 2026-08-24, all 15 Prisma migrations applied |
| Prisma client | generated into `src/generated/prisma` |

### ⚠️ The two-database situation (read this once)

The same Postgres instance hosts **two databases**:

| Database | Belongs to | Do not touch it with |
|---|---|---|
| `autoflow` | an *older/different clone* of this project (has live data: 1 user, 32 workflows, different migration lineage) | `prisma migrate reset`, `migrate dev`, `db push` from THIS repo |
| `autoflow20` | **this repo copy** (fresh, matches this repo's migrations exactly) | — |
| `autoflow_test` | test suite of the other clone | — |

Because the migration histories diverged, pointing this repo at `autoflow` would fail
(`migrate` detects a foreign history). That is why `.env` uses `autoflow20`. If you ever
want to wipe and start over, target `autoflow20` only — see §6.

---

## 3. The `.env` file — full reference

Source of truth for names/validation: `src/lib/env.ts` (Zod schema parsed at first import).
Source of truth for dummy values: `.env.example`.

Current contents of this repo's `.env` (working copy, values verified):

```ini
DATABASE_URL="postgresql://autoflow:5piMKhK3lsAXKl9yu9kUKgjO@localhost:5432/autoflow20?schema=public"
BETTER_AUTH_SECRET="jSHn0S6uALj8hxyTiaUrlG90YqNRBmKtJM4QuU9bdbw="
BETTER_AUTH_URL="http://localhost:3000"
ENCRYPTION_KEY="1be965563412a6d2f0b2c1df897ea529e60072826d3a63b3c43381fc35d76ed0"
CREDENTIAL_MASTER_KEY="+Xd4MmXc8AX7VARYnI1RoW7kumnTkO/y/BBCLntI+Vc="
NEXT_PUBLIC_APP_URL="http://localhost:3000"

GITHUB_CLIENT_ID=""
GITHUB_CLIENT_SECRET=""
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""

POLAR_ACCESS_TOKEN=""
POLAR_SUCCESS_URL="http://localhost:3000/workflows/billing/success"

INNGEST_EVENT_KEY=""
INNGEST_SIGNING_KEY=""

STRIPE_WEBHOOK_SECRET=""
NGROK_URL=""
```

### Required — app refuses to boot without these

| Variable | Validation rule | Purpose |
|---|---|---|
| `DATABASE_URL` | must be a valid Postgres URL | Prisma connection (`prisma/schema.prisma:14`) |
| `BETTER_AUTH_SECRET` | ≥ 32 chars | Signs Better Auth sessions (`src/lib/auth.ts`) |
| `BETTER_AUTH_URL` | absolute URL | Base URL for auth callbacks/redirects; must match `NEXT_PUBLIC_APP_URL` in dev |
| `ENCRYPTION_KEY` | ≥ 32 chars | Legacy Cryptr key encrypting user credentials at rest (`src/lib/encryption.ts`). **Losing it = losing every saved credential.** Back it up somewhere safe before wiping `.env`. Being replaced by the envelope vault (AF-M3-02) |
| `CREDENTIAL_MASTER_KEY` | base64 of exactly 32 bytes | KEK of the envelope-encrypted credential vault (`src/lib/crypto.ts`). App **refuses to boot** without it. Rotation works via per-row `keyVersion` re-wrap |

### Required-ish — defaults exist but keep them set

| Variable | Default when unset | Why keep it |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Webhook URLs rendered in Stripe / Google Form trigger dialogs (`src/features/triggers/components/*/dialog.tsx`) |

### Optional — feature degrades cleanly when empty

| Variable | Unlocks | Notes |
|---|---|---|
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | "Sign in with GitHub" button | See §7.1 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | "Sign in with Google" button | See §7.1 |
| `POLAR_ACCESS_TOKEN` | Polar billing checkout + customer-on-signup | Without it, checkout endpoints fail but signup still works. Note: the Pro product ID is hardcoded in `src/lib/auth.ts:33` |
| `POLAR_SUCCESS_URL` | Post-checkout redirect target | Must be absolute |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Production Inngest Cloud | **Not needed locally** — `npm run inngest:dev` works without them |
| `STRIPE_WEBHOOK_SECRET` | Stripe trigger nodes receiving webhooks | Route returns 500 for unsigned requests when unset (`src/app/api/webhooks/stripe/route.ts:11`). Only needed if you build Stripe-trigger workflows |
| `NGROK_URL` | `npm run ngrok:dev` public webhook ingress | Your reserved ngrok domain; leave empty otherwise |
| `ENGINE_RETRIES` | Overrides workflow retry count | Defaults to 3 (`src/inngest/config.ts:31`); leave unset |
| `LOG_LEVEL` | Log filtering (`src/lib/logger.ts`) | `debug` / `info` / `warn` / `error`; default `info` (prod caps at `warn`) |

Not read by code today: `SENTRY_AUTH_TOKEN` (only used by the build-time Sentry
webpack plugin), `VERCEL_URL` (set by Vercel automatically). DSNs are currently
hardcoded in `sentry.*.config.ts`.

---

## 4. How each value was produced

If you ever need to regenerate:

### Database credentials — read from the container itself

```powershell
podman inspect autoflow-db --format "{{range .Config.Env}}{{println .}}{{end}}"
# → POSTGRES_USER=autoflow
#   POSTGRES_PASSWORD=5piMKhK3lsAXKl9yu9kUKgjO
#   POSTGRES_DB=autoflow
```

URL shape: `postgresql://<user>:<password>@localhost:5432/<database>?schema=public`

This repo uses database **`autoflow20`**, which was created with:

```powershell
podman exec autoflow-db psql -U autoflow -d autoflow -c 'CREATE DATABASE "autoflow20" OWNER autoflow;'
```

### Secrets — generated with Node's crypto

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # BETTER_AUTH_SECRET and CREDENTIAL_MASTER_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"      # ENCRYPTION_KEY (64 hex chars)
```

Regenerating `BETTER_AUTH_SECRET` just logs everyone out (sessions become invalid).
**Regenerating `ENCRYPTION_KEY` destroys access to previously saved credentials** — don't do it casually.
Rotating `CREDENTIAL_MASTER_KEY` re-wraps stored envelopes via `keyVersion`
(`src/lib/crypto.ts`) instead.

---

## 5. Running the project

```powershell
cd "C:\Users\Jerry\Desktop\PROJECT 2026\autoflow20"
npm run dev:all      # ← preferred: Next.js + Inngest dev server together (mprocs)
```

Or individually:

| Command | Runs | Use when |
|---|---|---|
| `npm run dev:all` | Next.js **and** Inngest via mprocs | Always, basically. Workflows won't execute without Inngest |
| `npm run dev` | Next.js only | Pure UI work where no workflow runs matter |
| `npm run inngest:dev` | Inngest dev server alone | Debugging Inngest separately |
| `npm run ngrok:dev` | ngrok tunnel to :3000 | Testing inbound webhooks (needs `NGROK_URL`) |

Then open:

- **App:** http://localhost:3000 → redirects to `/login` → create an account with any email/password (email/password auth is enabled, `autoSignIn: true`)
- **Inngest dev UI:** http://localhost:8288
- **Prisma Studio:** `npx prisma studio`

> Tip (from `environment_setup.md` §6): load `localhost`, never `127.0.0.1`, or the dev
> assets get blocked cross-origin.

### Stopping / restarting cleanly

mprocs binds `Ctrl+C` per pane; quit mprocs entirely with its quit key shown in the header.
If port 3000 stays occupied afterwards: `Get-Process node | Stop-Process -Force` (kills all Node processes).

### Making sure the Postgres container is running

After a reboot, Podman machines may be stopped:

```powershell
podman machine start                 # if `podman ps` errors or hangs
podman ps                            # should list autoflow-db ... Up ...
podman start autoflow-db             # if listed but exited
Test-NetConnection localhost -Port 5432   # TcpTestSucceeded : True
```

---

## 6. Database management

```powershell
npx prisma migrate status    # compare local migrations vs applied history
npx prisma migrate deploy    # apply pending migrations (safe; what CI uses)
npx prisma generate          # regenerate client after schema.prisma changes
npx prisma studio            # browse/edit data visually
```

Rules that matter here (see `docs/engineering/engineering_rules.md`):

- Schema changes ship as **migration files**; never `prisma db push`.
- **Never run `prisma migrate reset` against `autoflow` or `autoflow_test`** — they belong to another clone. This repo's database is `autoflow20`.
- Merged migrations are immutable — edit only migrations you have not committed yet.

Full nuke-and-restart of **this repo's** database only:

```powershell
podman exec autoflow-db psql -U autoflow -d postgres -c 'DROP DATABASE IF EXISTS "autoflow20";'
podman exec autoflow-db psql -U autoflow -d postgres -c 'CREATE DATABASE "autoflow20" OWNER autoflow;'
npx prisma migrate deploy
```

---

## 7. Optional integrations (GitHub/Google, Polar, Stripe, Inngest Cloud)

All optional. Skip unless you specifically need the feature.

### 7.1 GitHub OAuth

1. GitHub → Settings → Developer settings → OAuth Apps → **New OAuth App**
2. Homepage URL: `http://localhost:3000`; Authorization callback URL: `http://localhost:3000/api/auth/callback/github`
3. Copy Client ID → `GITHUB_CLIENT_ID`; Generate secret → `GITHUB_CLIENT_SECRET`
4. Restart `npm run dev` (server env vars are read at boot)

### 7.2 Google OAuth

Same idea at https://console.cloud.google.com/apis/credentials → OAuth client ID (Web application):
callback `http://localhost:3000/api/auth/callback/google`.

### 7.3 Polar billing

Dashboard → https://polar.sh → Settings/API → create an access token → `POLAR_ACCESS_TOKEN`.
Keep `POLAR_SUCCESS_URL` absolute. Note the Pro product ID hardcoded in `src/lib/auth.ts:33`
belongs to the original author's Polar account — externalizing it is tracked as AF-M0-03;
until then checkout points at *their* product.

### 7.4 Stripe triggers

Stripe Dashboard → Developers → Webhooks → endpoint `http://localhost:3000/api/webhooks/stripe`
(via ngrok for real deliveries) → copy signing secret → `STRIPE_WEBHOOK_SECRET`.

### 7.5 Inngest Cloud keys

Only relevant when deploying; local `inngest-cli dev` ignores them. Leave empty.

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `AutoFlow cannot start: invalid environment configuration` + bullet list | Zod validation failed in `src/lib/env.ts` | Add/fix the named variables in `.env`, restart |
| Boot error `CREDENTIAL_MASTER_KEY ... 32 bytes` / `refuses to boot` | missing or wrong-length master key | Generate `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` into `.env` |
| Boot OK but `PrismaClientInitializationError` / P1001 can't reach DB | Podman machine or container stopped | §5 "Making sure the container is running" |
| `P1010: User was denied access` | Wrong password/user/db in `DATABASE_URL` | Re-read creds via the `podman inspect` command in §4 |
| `P3018`/history mismatch on migrate | You pointed this repo at `autoflow` (foreign migration lineage) | Point back at `autoflow20` |
| Login page loads but sign-in fails silently | `BETTER_AUTH_URL` ≠ actual origin | Keep both `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` at `http://localhost:3000` |
| Workflow runs forever, nothing appears in executions | Inngest dev server not running | Use `npm run dev:all`, check http://localhost:8288 |
| Saved credential fails to decrypt after `.env` regeneration | `ENCRYPTION_KEY` changed | Old ciphertexts are unrecoverable; re-enter credentials |
| `Cannot find module '@/generated/prisma'` (types) | Client not regenerated after pull/schema change | `npx prisma generate`, restart TS server in editor |
| Port 3000 already in use | Zombie node process | `Get-Process node \| Stop-Process -Force` |
| `npx prisma dev` fails with `EBUSY ... durable-streams.sqlite` | Stale lock/sidecar files (`-wal`/`-shm`) from a crashed previous run | Close other terminals, delete `%LOCALAPPDATA%\prisma-dev-nodejs\Data\durable-streams\default\*`, retry. Note: this project doesn't need `prisma dev` at all — its database is the Podman Postgres; `prisma dev` only spins up Prisma's separate built-in local Postgres simulator |

---

## 9. Verification checklist — all passing as of 2026-08-24

| Check | Result |
|---|---|
| `npx prisma migrate status` against `autoflow20` | 15/15 migrations applied, histories in sync |
| `npx prisma generate` (Prisma 7.9.1, `prisma-client` generator) | plain-TS client emitted to `src/generated/prisma`; imports use `@/generated/prisma/client` |
| Runtime query through the v7 driver adapter (`@prisma/adapter-pg`) | live `workflow.count()` + enum import verified |
| `npm run lint` | clean (biome, 217 files) |
| `npx tsc --noEmit` | clean |
| `npm test` | **78/78 passing** |
| Live boot `npm run dev` → `GET http://localhost:3000` | HTTP 200; `/workflows` → 307 → `/login` → 200 |
