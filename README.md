# AutoFlow

An open-source automation platform: users build workflows as node graphs on a visual
canvas and run them on a durable execution engine - triggers, HTTP calls, AI models,
and chat deliveries, connected and chained.

**Current status:** pre-beta, under active hardening. What actually works today is
tracked honestly in [`docs/planning/progress.md`](docs/planning/progress.md);
the task board lives in [`docs/planning/tasks.md`](docs/planning/tasks.md).
Product documents describe intent, not behaviour - those two planning files are
the source of truth.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) + TypeScript strict |
| API | tRPC v11 + TanStack Query |
| Database | PostgreSQL via Prisma 6 |
| Auth | Better Auth (email/password + social) |
| Execution | Inngest 3 (durable functions, step-based) |
| Validation | Zod v4 at every boundary |
| UI | Tailwind CSS, shadcn/ui, React Flow canvas |
| Billing | Polar |
| Tooling | Biome (lint + format), Vitest, Playwright, GitHub Actions CI |

## Quick start

Prerequisites: Node.js 20+, a PostgreSQL database.

```bash
npm install
cp .env.example .env        # then fill in values - see docs/operations/environment_setup.md
npx prisma migrate deploy   # or `migrate dev` locally
npx prisma generate
npm run dev                 # app on http://localhost:3000
```

To run the full local topology (app + Inngest Dev Server) use `npm run dev:all`.
Webhook triggers require a public tunnel; see the trigger dialogs in the running app.

## Verification gates

All four must pass before opening a PR (CI enforces them):

```bash
npm run lint          # biome check - zero errors tolerated
npx tsc --noEmit      # type check
npm test              # vitest unit tests
npm run build         # production build
```

## Documentation

Start at [`docs/README.md`](docs/README.md) - it indexes every document with a
one-line "read this when". Agents should read [`AGENTS.md`](AGENTS.md) first.
Key entry points:

- Planning: `docs/planning/{implementation_plan,tasks,progress}.md`
- Architecture: `docs/architecture/` (overview, node SDK, execution engine, data model, API contract, security)
- Engineering rules: `docs/engineering/engineering_rules.md` (binding HARD rules)
- Decisions: `docs/decisions/` (ADRs)

## License

TBD before any public release.
