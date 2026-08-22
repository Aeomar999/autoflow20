# Environment Setup

**Read when:** setting up locally, adding an env var, or debugging a boot failure.

> **2026-08-22 reality check:** a **`.env.example`** now exists at the repo
> root (verified against actual code reads) — the quick-start `cp` works.
> However, env validation (`src/lib/env.ts`) is still unbuilt (see `AF-M0-08`):
> missing values fail late and obscurely, so double-check the required block
> before booting. Also note the stack runs Next.js 15.5 / Prisma 6 today (see
> §1 note below).

---

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20 LTS+ | Next.js 15.5 (docs elsewhere say 16 — that is the target, not the installed version) |
| npm | 10+ | Lockfile is npm; do not mix package managers |
| PostgreSQL | 15+ | Local, Docker, or a hosted dev branch |
| Docker | optional | Easiest route to Postgres for dev + tests |
| Inngest CLI | via devDependency | `npm run inngest:dev` |

---

## 2. Quick start

```bash
git clone <repo> && cd autoflow
npm ci
cp .env.example .env          # then fill in the values below
npx prisma migrate dev
npx prisma generate
npm run dev:all               # Next.js + Inngest together (preferred)
```

- App: http://localhost:3000
- Inngest dev UI: http://localhost:8288
- Prisma Studio: `npm run prisma:studio`

`npm run dev` alone starts only Next.js — background jobs will not fire. Use `dev:all` whenever you touch execution.

---

## 3. Environment variables

`.env.example` is the source of truth for names; this table is the source of truth for meaning. Both are validated at boot by `src/lib/env.ts` (`AF-M0-08`) — the app refuses to start rather than failing mysteriously at 2am.

### Validated now — the app refuses to boot without these

| Variable | Example | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://user:pass@localhost:5432/autoflow` | Prisma connection string |
| `POLAR_ACCESS_TOKEN` | `polar_at_...` | Server-side Polar API |
| `POLAR_PRODUCT_ID` | `00000000-0000-0000-0000-000000000000` | Product to sell, server-side checkout config (`src/lib/auth.ts`) |
| `POLAR_PRODUCT_SLUG` | `Autoflow-Pro` | Slug shown in the checkout URL |

### Validated now — client (`NEXT_PUBLIC_*`)

The app also refuses to boot without these; they are inlined into the browser bundle at build time.

| Variable | Example | Notes |
|---|---|---|
| `NEXT_PUBLIC_POLAR_PRODUCT_ID` | `00000000-0000-0000-0000-000000000000` | Must match `POLAR_PRODUCT_ID`; client-side checkout (`app-sidebar.tsx`, `upgrade-modal.tsx`) |
| `NEXT_PUBLIC_POLAR_SUCCESS_URL` | `http://localhost:3000/workflows` | Client-side post-checkout redirect |

### Validated if present — optional now, features degrade cleanly when unset

| Variable | Example | Notes |
|---|---|---|
| `BETTER_AUTH_URL` | `http://localhost:3000` | Read by `src/lib/auth.ts`; defaults to `http://localhost:3000` when unset |
| `BETTER_AUTH_SECRET` | 32+ random bytes | Session signing; better-auth requires it in production |
| `POLAR_SUCCESS_URL` | `http://localhost:3000/workflows` | Server-side post-checkout redirect (`src/lib/auth.ts`, Inngest) |
| `INNGEST_BASE_URL` | `http://localhost:8288` | Local Inngest dev server override; unset in production |
| `INNGEST_EVENT_KEY` | — | Production event ingestion (M2) |
| `INNGEST_SIGNING_KEY` | — | Verifies inbound Inngest requests (M2) |
| `TEST_DATABASE_URL` | `postgresql://user:pass@localhost:5432/autoflow_test` | Test suite DB (see §4) |
| `AUTOFLOW_DB_PASSWORD` | — | Local provisioning scripts |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_API_KEY` | — | Source-map upload; optional in dev |
| `GROQ_API_KEY` | — | The existing demo Inngest function reads it at runtime |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` / `DEEPSEEK_API_KEY` | — | Planned AI nodes (M5) |
| `NODE_ENV` | `development` | Set by the framework; not validated |
| `LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error`; filters `src/lib/logger.ts` output. Defaults to `info`. |

### Required as milestones land

| Variable | From | Notes |
|---|---|---|
| `CREDENTIAL_MASTER_KEY` | M3 | **32 bytes, base64.** App must refuse to boot without it. Never reuse dev and prod values. |
| `NEXT_PUBLIC_APP_URL` | M4 | Webhook URL construction |
| `OLLAMA_BASE_URL` | M5 | Local models |
| `REDIS_URL` | M8 | Rate limiting |
| `BLOB_STORE_*` | M2/M3 | Binary item storage |

Generate a master key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Rules

- **[HARD]** Never commit `.env`. `.env.example` carries names and dummy values only.
- **[HARD]** Client-readable values must be `NEXT_PUBLIC_`-prefixed — and remember that means they are public. Never prefix a secret.
- **[HARD]** Read env through `src/lib/env.ts`, never `process.env` directly in feature code. Nodes read `ctx.env` (allowlisted), never `process.env`.
- Adding a variable means updating: `.env.example`, `src/lib/env.ts`, this table, and the deployment environment. All four, same PR.

---

## 4. Database

### Local Postgres via Docker

```bash
docker run --name autoflow-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=autoflow -p 5432:5432 -d postgres:16
```

### Common operations

```bash
npx prisma migrate dev --name add_execution_tables   # create + apply a migration
npx prisma migrate deploy                            # apply in CI/production
npx prisma generate                                  # regenerate the client (output: src/generated/prisma)
npx prisma studio                                    # browse data
```

**Never** `prisma db push` or `prisma migrate reset` against a database you did not create in this session. Migrations are the only sanctioned path to a schema change (`docs/engineering/engineering_rules.md` §7).

### Test database

`AF-M0-06` provisions a separate database (`autoflow_test`) using **`TEST_DATABASE_URL`** (not `DATABASE_URL_TEST`). Tests truncate between cases and never touch the dev database.

Two ways to create it:

```bash
# 1. Podman helper script (Windows-friendly, creates a `autoflow` container with both DBs)
.\scripts\dev-db.ps1

# 2. Manually, inside an already-running Postgres
psql "$DATABASE_URL" -c "CREATE DATABASE autoflow_test;"
```

`TEST_DATABASE_URL` is the dev URL with the database name swapped to `autoflow_test`, e.g. `postgresql://postgres:postgres@localhost:5432/autoflow_test`. Per-suite truncation lives in `test/db.ts`; the CI workflow creates the test DB itself via `psql` before running migrations on it.

---

## 5. Running the stack

| Command | What it runs |
|---|---|
| `npm run dev` | Next.js only — background jobs will not fire |
| `npm run dev:all` | mprocs: Next.js + Inngest dev server (**use this**) |
| `npm run inngest:dev` | Inngest dev server alone |
| `npm run build` | Production build — must pass before any PR |
| `npm run lint` | ESLint |
| `npm run prisma:studio` | DB browser |
| `npm test` | Unit + component + integration (Vitest) |
| `npm run test:watch` | Vitest watch mode |
| `npm run test:e2e` | Playwright e2e — needs `POLAR_ACCESS_TOKEN` and the test DB |

`mprocs.yaml` configures the multi-process dev setup.

---

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `PrismaClientInitializationError` at boot | `DATABASE_URL` wrong or Postgres down | Check the container/service and the URL |
| Types missing from `@/generated/prisma` | Client not regenerated after a schema change | `npx prisma generate` |
| Inngest functions never fire | Only `npm run dev` is running | `npm run dev:all` |
| Checkout opens but lands on the wrong page | `NEXT_PUBLIC_POLAR_SUCCESS_URL` (client) vs `POLAR_SUCCESS_URL` (server) point to different pages | Both are env-driven; align them in `.env` |
| Checkout fails with an unknown product | `POLAR_PRODUCT_ID` / `NEXT_PUBLIC_POLAR_PRODUCT_ID` don't match a product on your Polar account | Set both to the product id from your Polar dashboard |
| Demo Groq function fails | `GROQ_API_KEY` absent from `.env` | Add the key, or ignore — it is deleted in `AF-M5-09` |
| Next.js API behaves unlike the docs you remember | This Next.js version has breaking changes | Read `node_modules/next/dist/docs/` — see `AGENTS.md` header |
| Empty list where data should be | Prefetch or client query failed; failures now render an error state, not an empty list | Check the server log — rerun with `LOG_LEVEL=debug` for the full prefetch context |
| No log output | `LOG_LEVEL` filters out the level you expect | Set `LOG_LEVEL=debug` in `.env` |
| Migration conflict after a rebase | Two branches added migrations | Rebase, delete yours, regenerate against the updated schema |
| Playwright renders the page but the form never hydrates / submit does nothing | Next.js 16 dev blocks dev resources from cross-origin hosts | Load `http://localhost:3000`, never `http://127.0.0.1:3000` — the Playwright `baseURL` must be `localhost` |
| E2E signup fails with HTTP 500 | Signup creates a real Polar customer; a missing/invalid `POLAR_ACCESS_TOKEN` (or a reserved email domain like `@example.com`) fails the request | Add a valid sandbox `POLAR_ACCESS_TOKEN`; use a deliverable-looking domain like `@gmail.com` in the test |
| First e2e run downloads a browser for a long time | Playwright browser binaries aren't installed | `npx playwright install chromium`; or `$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` if you run it via an installed browser |

---

## 7. Editor setup

- ESLint + Prettier on save.
- TypeScript: use the workspace SDK version, not the editor's bundled one.
- Recommended: Prisma, Tailwind CSS IntelliSense, ESLint, Playwright.
- Path alias `@/*` → `src/*` (`tsconfig.json`).

---

## 8. Deployment (target)

| Concern | Approach |
|---|---|
| Host | Vercel (Next.js-native) |
| Database | Managed Postgres with PITR backups |
| Jobs | Inngest Cloud with signing keys configured |
| Secrets | Platform env vars; `CREDENTIAL_MASTER_KEY` restricted to the smallest possible audience |
| Migrations | `prisma migrate deploy` in the deploy step, gated on CI green |
| Rollback | Revert the deployment; DB migrations use expand-migrate-contract so a revert is always safe |
| Monitoring | Sentry + platform metrics + execution dashboards (M7) |

Production readiness checklist is `AF-M8-08`.
