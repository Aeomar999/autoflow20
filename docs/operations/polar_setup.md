# Polar Billing Setup Manual (AutoFlow)

Operator's guide for configuring Polar (merchant-of-record billing) for this
project specifically. Written against the code as it stands today
(2026-08-26): `@polar-sh/better-auth` **1.1.9**, `@polar-sh/sdk` **0.35.4**,
Better Auth **1.3.x**.

> Scope note: this covers the SaaS's own billing ("Upgrade to Pro").
> The Stripe *trigger node* (workflows that fire on Stripe events) is a
> separate feature with its own webhook secret — see
> `docs/operations/environment_setup.md` §5.7. They share nothing.

---

## Table of contents

1. [TL;DR — 15-minute quick start](#1-tldr--15-minute-quick-start)
2. [How billing works in AutoFlow](#2-how-billing-works-in-autoflow)
3. [Part A — Configure the Polar sandbox](#3-part-a--configure-the-polar-sandbox)
4. [Part B — Configure AutoFlow (env vars)](#4-part-b--configure-autoflow-env-vars)
5. [Part C — Verify end to end](#5-part-c--verify-end-to-end)
6. [Understanding the premium gate](#6-understanding-the-premium-gate)
7. [Production go-live](#7-production-go-live)
8. [Optional extensions (not wired yet)](#8-optional-extensions-not-wired-yet)
9. [Troubleshooting matrix](#9-troubleshooting-matrix)
10. [Reference links](#10-reference-links)

---

## 1. TL;DR — 15-minute quick start

| Step | Where | What |
|---|---|---|
| 1 | https://sandbox.polar.sh | Create a **separate** sandbox account + organization |
| 2 | Sandbox dashboard → Products | Create a **recurring monthly** product named `Pro`; copy its UUID |
| 3 | Sandbox org Settings → Developers → New Token | Create an Organization Access Token with the scopes in §3.5 |
| 4 | `.env` | Fill `POLAR_ACCESS_TOKEN`, `POLAR_PRODUCT_ID`, `POLAR_SUCCESS_URL` (§4) |
| 5 | Restart dev server | Polar vars are optional — the app boots either way, but restart to load them |
| 6 | Sign up in the app | A Polar *customer* is created automatically (server logs will show it if it fails) |
| 7 | Click "Upgrade to Pro" | Pay with test card `4242 4242 4242 4242` |
| 8 | Back in the app | Sidebar hides the upgrade button; workflow/credential creation now passes |

If any step misbehaves, jump straight to §9 (troubleshooting matrix).

---

## 2. How billing works in AutoFlow

### 2.1 Architecture at a glance

```
 Browser                          Next.js server                    Polar (sandbox)
 ───────                          ──────────────                    ───────────────
 authClient.checkout({slug}) ──▶ POST /api/auth/checkout    ──▶   checkouts.create()
        ◀── redirect to hosted checkout page ──────────────       (email locked to
                                                                    logged-in user)
 authClient.customer.portal() ─▶ GET /api/auth/customer/portal ─▶ customerSessions.create()
        ◀── redirect to Customer Portal ────────────────────

 authClient.customer.state() ──▶ GET /api/auth/customer/state ──▶ customers.getStateExternal()
 useSubscription()                                        (externalId = user.id)

 tRPC mutation (premium) ──────▶ premiumProcedure           ──▶ customers.getStateExternal()
                                  src/trpc/init.ts:53            (live, every call)

 signup (email+password or OAuth) ─▶ Better Auth hook      ──▶ customers.create()
                                    createCustomerOnSignUp       (externalId = user.id)
```

Key design facts (important mental model):

- **No billing state lives in Postgres.** The Prisma schema has zero
  Polar-related tables. Subscription truth is always fetched live from the
  Polar API, keyed by `externalId === Better Auth user.id`
  (`createCustomerOnSignUp` sets this at signup — no mapping table needed).
- **Everything rides one access token.** All server→Polar calls use
  `POLAR_ACCESS_TOKEN` via the shared SDK client in `src/lib/polar.ts`.
- **The SDK client is pinned to sandbox.** `server: "sandbox"` is hardcoded
  in `src/lib/polar.ts:5`. Switching to production requires a one-line code
  change (§7) — this is a deliberate, documented go-live blocker.
- **Sandbox ≠ production, completely.** Accounts, organizations, products,
  and tokens are isolated between environments. A production token cannot
  talk to sandbox and vice versa.

### 2.2 File-by-file reference

| File | Role |
|---|---|
| `src/lib/polar.ts` | Shared `Polar` SDK client. Reads `POLAR_ACCESS_TOKEN`; pins `server: "sandbox"` |
| `src/lib/auth.ts:26-46` | Better Auth `polar()` plugin: `createCustomerOnSignUp: true`, wires `checkout()` + `portal()` sub-plugins |
| `src/lib/auth.ts:31-42` | Checkout config: product list built from `POLAR_PRODUCT_ID` + slug; `successUrl` from `POLAR_SUCCESS_URL`; `authenticatedUsersOnly: true` |
| `src/lib/env.ts:84-88` | Exports `polarProductId` / `polarProductSlug`. Slug resolution order: `POLAR_PRODUCT_SLUG` → `NEXT_PUBLIC_POLAR_PRODUCT_SLUG` → `"pro"` |
| `src/lib/env.ts:25-28` | Zod schema: all four `POLAR_*` vars are **optional** (billing unconfigured ⇒ app still boots) |
| `src/lib/auth-client.ts` | Client side: `createAuthClient` + `polarClient()` plugin from `@polar-sh/better-auth` |
| `src/features/subscriptions/hooks/use-subscription.ts` | `useSubscription()` / `useHasActiveSubscription()` — React Query over `authClient.customer.state()` |
| `src/components/app-sidebar.tsx:105-126` | Sidebar "Upgrade to Pro" (`authClient.checkout({slug})`) and "Billing Portal" (`authClient.customer.portal()`) buttons |
| `src/components/upgrade-modal.tsx:35` | Modal shown when a premium action is denied; same `authClient.checkout({slug})` call |
| `src/trpc/init.ts:53-71` | `premiumProcedure`: live `getStateExternal` check; throws `FORBIDDEN "Active subscription required"` if none |
| `src/features/workflows/server/routers.ts:32` | `workflows.create` — gated by `premiumProcedure` |
| `src/features/credentials/server/routers.ts:13` | `credentials.create` — gated by `premiumProcedure` |
| `src/app/api/auth/[...all]/route.ts` | Better Auth catch-all handler — hosts all `/api/auth/*` endpoints above |

### 2.3 What each env var actually controls

| Variable | Read by | Client-visible? | Effect if unset |
|---|---|---|---|
| `POLAR_ACCESS_TOKEN` | `src/lib/polar.ts:4` | No (server only) | Every Polar call fails. **Signup breaks too** (see §9 row 1). Checkout/portal buttons error |
| `POLAR_SUCCESS_URL` | `src/lib/auth.ts:40` | No | Checkout completes but lands nowhere sensible (plugin falls back to its own default) |
| `POLAR_PRODUCT_ID` | `src/lib/env.ts:84` → `auth.ts:36` | No | Server checkout product list is empty ⇒ slug never resolves ⇒ upgrade clicks fail (app still boots) |
| `POLAR_PRODUCT_SLUG` | `src/lib/env.ts:85` | No | Falls back to `NEXT_PUBLIC_POLAR_PRODUCT_SLUG`, then `"pro"` |
| `NEXT_PUBLIC_POLAR_PRODUCT_SLUG` | `src/lib/env.ts:87` (inlined into client bundle) | **Yes** | Same chain — client buttons send whatever this resolves to |

Subtlety worth knowing: `upgrade-modal.tsx` and `app-sidebar.tsx` import
`polarProductSlug` from `@/lib/env`. In the browser bundle,
`process.env.POLAR_PRODUCT_SLUG` is `undefined` (no `NEXT_PUBLIC_` prefix),
so the **effective client slug is `NEXT_PUBLIC_POLAR_PRODUCT_SLUG` or
literally `"pro"`**. Keep both set to the same value unless you know better.

Validation rules enforced at boot by `src/lib/env.ts` (when present):
token = any string, `POLAR_SUCCESS_URL` = absolute URL,
`POLAR_PRODUCT_ID` = UUID, slugs ≥ 1 char. Invalid values refuse to boot
with a readable error naming the variable.

---

## 3. Part A — Configure the Polar sandbox

Do all of this at https://sandbox.polar.sh — **not** polar.sh. Sandbox needs
its own account and organization (deliberately isolated from production).

### 3.1 Create the sandbox organization

1. Go to https://sandbox.polar.sh/start and sign up (GitHub/Google/email).
2. Create an organization, e.g. `AutoFlow Dev`. This org holds your dev
   products, test customers, and dev token.

> Sandbox limitation: customer-facing emails (order receipts, renewal
> reminders) are only delivered to members of your own organization.
> When testing signups, use sub-addressed aliases like
> `you+test1@example.com` so receipts reach you.

### 3.2 Payout / beneficiary setup

Sandbox checkout may require a beneficiary (payout account) to be configured
before a checkout can be completed. If prompted during first checkout or in
Settings → Finance, connect the sandbox payout account — sandbox walks you
through a Stripe Connect Express test account. You do not need real banking
details in sandbox.

### 3.3 Create the Pro product

1. Dashboard → **Products** → **New Product**.
2. Name: `Pro` (display name shown on checkout — anything works).
3. Type: **recurring subscription**, billed **monthly**. Pick your price
   (sandbox money is fake; use the real intended price so you exercise the
   tax math you'll see in production).
4. Benefits: skip entirely — AutoFlow grants access via the subscription
   check itself, not via Polar benefits. Adding benefits is harmless noise.
5. Publish the product.
6. Open the product's page and copy the UUID from the URL
   (`https://sandbox.polar.sh/dashboard/products/<UUID>`).
   **This is `POLAR_PRODUCT_ID`.**

### 3.4 Decide the checkout slug

The slug is what the app's client sends: `authClient.checkout({ slug })`.
It must match the slug mapped in `auth.ts`'s checkout config, which comes
from env (§2.3). Unless you have a reason otherwise, keep the default `"pro"`
in both `POLAR_PRODUCT_SLUG` and `NEXT_PUBLIC_POLAR_PRODUCT_SLUG`.

The slug is **not** visible anywhere in the Polar dashboard for this
integration style — it exists only inside the `products` mapping in
`src/lib/auth.ts`. You're free to choose any string; it just has to agree
between your env and nothing else.

### 3.5 Create the Organization Access Token

1. Sandbox dashboard → **Settings** (organization settings) → scroll to
   **Developers** → **New Token**.
2. Name: `autoflow-dev` (descriptive; it appears in audit lists).
3. Expiration: pick something sane (e.g. 90 days) — calendar a rotation.
4. Scopes — grant exactly these (each maps to a verified API call this
   integration makes):

| Scope | Why it's required (exact call made by the code) |
|---|---|
| `customers:read` | `customers.getStateExternal` — used by `premiumProcedure` (`src/trpc/init.ts:55`) and the portal/state endpoints |
| `customers:write` | `customers.create` on every new signup (`createCustomerOnSignUp`); the plugin also calls `customers.list` / `customers.updateExternal` to reconcile the external ID |
| `checkouts:write` | `checkouts.create` — the `checkout()` sub-plugin creating sessions for `authClient.checkout(...)` |
| `customer_sessions:write` | `customerSessions.create` — the `portal()` sub-plugin minting Customer Portal session tokens |

5. Create and **copy the token immediately** (shown once; format
   `polar_oat_…`). That value is `POLAR_ACCESS_TOKEN`.

> Security: Polar participates in GitHub Secret Scanning. If this token ever
> lands in a commit, it will be auto-revoked and you'll get an email. Never
> paste it into issues, chats, or client code. It must only exist in `.env`
> (gitignored) and your host's secret store.

---

## 4. Part B — Configure AutoFlow (env vars)

Edit `.env` (copy `.env.example` if starting fresh):

```bash
# --- Polar billing (sandbox) -------------------------------------------------
POLAR_ACCESS_TOKEN="polar_oat_xxxxxxxxxxxxxxxxxxxxxxxx"   # §3.5

# Post-checkout redirect. MUST be an absolute URL and MUST point at a route
# that exists. The success page lives at /workflows/billing/success and the
# plugin substitutes {CHECKOUT_ID} into this URL if you include it:
POLAR_SUCCESS_URL="http://localhost:3000/workflows/billing/success"

# Your product UUID from §3.3
POLAR_PRODUCT_ID="12345678-90ab-4cde-8f01-23456789abcd"

# Slugs — keep identical (see §2.3 subtlety)
POLAR_PRODUCT_SLUG="pro"
NEXT_PUBLIC_POLAR_PRODUCT_SLUG="pro"
```

Then **restart the dev server** (`npm run dev` / `npm run dev:all`) — env is
validated once at first import (`instrumentation.ts` → `ensureEnv()`), and
`NEXT_PUBLIC_*` values are inlined into the client bundle at build/start time.

Behavior tiers, for orientation:

- **Nothing set:** app boots; signup works *only because* the plugin's
  customer-create call fails silently enough not to abort? — no: see §9
  row 1. Treat Polar config as required-for-signup in practice once the
  plugin is active.
- **Token set, product unset:** boots; signup creates Polar customers;
  upgrade buttons fail at request time (empty product map).
- **All set (above):** full happy path.

Known wart: `.env.example` contains a duplicated `POLAR_SUCCESS_URL` block
(lines 55–59). Harmless (same value), but don't let it suggest two distinct
variables exist.

---

## 5. Part C — Verify end to end

Run through this after configuring; each step names the thing that proves it.

1. **Boot clean.** `npm run dev:all` starts without the env-validation error.
   (Polar vars are optional in schema — a typo'd UUID *will* refuse boot.)
2. **Signup creates a Polar customer.**
   - Sign up at `/signup` with `you+test1@example.com`.
   - Verify: sandbox dashboard → **Customers** → entry appears within
     seconds, External ID column equals the new user's id.
   - Failure here surfaces as HTTP 500 on the signup request — see §9 rows 1–2.
     This is also why CI e2e needs a valid sandbox token
     (`docs/engineering/testing_strategy.md` §“e2e”).
3. **Checkout.**
   - Log in → sidebar → **Upgrade to Pro**.
   - Polar-hosted checkout opens with the email pre-filled and locked
     (`authenticatedUsersOnly: true`).
   - Pay with `4242 4242 4242 4242`, any future expiry, any CVC.
   - After paying you are redirected to `POLAR_SUCCESS_URL`.
   - Verify: dashboard → **Customers → (you)** shows an active subscription;
     sidebar no longer renders the upgrade button
     (`useHasActiveSubscription` flipped).
4. **Premium gate passes.**
   - Create a workflow and save a credential (both `premiumProcedure`-
     gated). Both succeed.
5. **Portal.**
   - Sidebar → **Billing Portal** → Polar Customer Portal opens (cancel/
     resume subscription, invoices, payment method).
   - Cancel the subscription there, then re-check the sidebar: upgrade
     button reappears (state is read live, so this reflects quickly —
     possibly on next fetch; React Query caches under key `["subscription"]`).
6. **Direct API sanity check** (bypasses the app entirely):

```powershell
$tok = $env:POLAR_ACCESS_TOKEN   # or paste temporarily
Invoke-RestMethod -Uri "https://sandbox-api.polar.sh/v1/customers/external/<USER_ID>/state" `
  -Headers @{ Authorization = "Bearer $tok" }
```

A 200 with `activeSubscriptions` proves token + scoping independently of
the Next.js stack.

---

## 6. Understanding the premium gate

`premiumProcedure` (`src/trpc/init.ts:53`) wraps `protectedProcedure`:

```ts
const customer = await polarClient.customers.getStateExternal({
  externalId: ctx.auth.user.id,
});
if (!customer.activeSubscriptions || customer.activeSubscriptions.length === 0) {
  throw new TRPCError({ code: "FORBIDDEN", message: "Active subscription required" });
}
```

Operational consequences you should design around:

- **One outbound HTTPS round-trip to Polar per premium mutation**, on the
  hot path of `workflows.create` and `credentials.create`. Latency adds
  directly; Polar rate limits apply. Fine today; if you add more premium
  procedures, consider short-TTL caching (in-process, e.g. 30–60 s) before
  scaling up usage.
- **Fail-open vs fail-closed:** if Polar is unreachable, the procedure throws
  (fail-closed — users can't create workflows/credentials until Polar
  responds). There is no graceful degradation or stale-cache fallback yet.
- **Any active subscription counts.** The check is
  `activeSubscriptions.length > 0` — it doesn't verify *which* product. When
  you add plan tiers, tighten this to compare against expected product IDs.
- **UI handling:** the `FORBIDDEN` error triggers the `UpgradeModal` in the
  workflows UI; the modal's button funnels into checkout.

---

## 7. Production go-live

Checklist, in order:

1. **Production Polar org.** At https://polar.sh (production!), repeat §3.1–
   §3.5: real organization, real `Pro` product, production Organization
   Access Token with the same four scopes. Tokens/products do **not** carry
   over from sandbox.
2. **Flip the server pin.** Edit `src/lib/polar.ts:5`:

   ```ts
   export const polarClient = new Polar({
     accessToken: process.env.POLAR_ACCESS_TOKEN,
     server: "production",
   });
   ```

   This hardcoded pin is a tracked go-live blocker
   (`docs/operations/environment_setup.md` §8.4). If you want it env-driven
   first, add `POLAR_SERVER` to `src/lib/env.ts` and read it here — keep the
   Zod boundary, no raw `process.env` in feature code.
3. **Host env vars** (Vercel project settings or equivalent):
   production values for all five `POLAR_*` variables, plus updated
   `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL` to your domain, and
   `POLAR_SUCCESS_URL="https://your-domain.com/workflows"`.
4. **Finance.** Connect a real payout account (Stripe Connect Express) under
   Settings → Finance; expect a Polar account review before meaningful
   volume. Fees start at 5% + 50¢/transaction on the Starter plan — Polar is
   merchant of record and remits VAT/GST/sales tax for you.
5. **Smoke test in production** exactly like §5, using a real card and then
   refunding yourself from the dashboard.
6. **Rotate the sandbox token out of any shared env files.** Prod and dev
   tokens are different values; never reuse.

---

## 8. Optional extensions (not wired yet)

None of these exist in the code today. Listed so future work plugs in cleanly.

### 8.1 Webhooks (event-driven sync)

Current design polls Polar on demand; that's correct for this scale. If you
need push (e.g. provisioning on purchase, analytics, revoking access fast):

- Add `webhooks({ secret: process.env.POLAR_WEBHOOK_SECRET, onSubscriptionActive, onSubscriptionRevoked, ... })`
  to the `use:` array in `src/lib/auth.ts`.
- Endpoint becomes **`POST https://your-domain/api/auth/polar/webhooks`**
  (signature verification is handled by the plugin; add `POLAR_WEBHOOK_SECRET`
  to `env.ts` schema).
- Register the endpoint in Polar Settings → Webhooks. For local dev, forward
  with ngrok (`npm run ngrok:dev`) — same pattern as Stripe triggers.
- Useful events: `subscription.active`, `subscription.revoked`,
  `order.paid`, `customer.state_changed`.

### 8.2 Usage-based quotas (AF-M7-04)

The backlog task wires per-plan execution/AI-spend limits to Polar. The
pieces: `usage()` sub-plugin for `authClient.usage.*`, server-side
`polarClient.events.ingest({ name, externalCustomerId: user.id, metadata })`
called from the execution runner (never from the browser), a Polar Meter +
metered price on the Pro product. See Polar docs “Usage Based Billing”.

### 8.3 Customer deletion sync

If account deletion ships: extend `betterAuth({ user: { deleteUser: {
enabled: true, afterDelete: async (user) => {
  await polar.customers.deleteExternal({ externalId: user.id }); } } } })`.

### 8.4 Success page

There is no dedicated post-checkout page. A nice small task: build
`/workflows/billing/success`, support the `{CHECKOUT_ID}` placeholder in
`POLAR_SUCCESS_URL` (the plugin substitutes it), and reconcile state on
landing. Until then `/workflows` is the honest target.

---

## 9. Troubleshooting matrix

| Symptom | Likely cause | Fix |
|---|---|---|
| Signup returns HTTP 500; logs show Polar 401/403 | Missing/expired/wrong-environment token (prod token against pinned sandbox client) | Re-create sandbox OAT (§3.5); ensure it's a *sandbox* token; restart |
| Signup HTTP 500; log shows network/DNS error to `sandbox-api.polar.sh` | Egress blocked / transient | Retry; check firewall/proxy; the call happens synchronously during signup |
| Existing users can't sign up again / duplicate email errors | Earlier failed signup half-created the local user | Delete the orphan `user` row, retry |
| App refuses to boot: `AutoFlow cannot start: invalid environment configuration … POLAR_PRODUCT_ID: must be a UUID` | Typo in a `POLAR_*` var | Fix value per §4 validation rules |
| Upgrade button click does nothing visible | `POLAR_PRODUCT_ID` unset ⇒ empty server product map, or slug mismatch between `NEXT_PUBLIC_POLAR_PRODUCT_SLUG` and what you think it is | Check response payload of `POST /api/auth/checkout` in devtools; set both slug vars + product ID (§2.3, §4) |
| Checkout opens but completing it 500s / complains about beneficiary | Payout/beneficiary not configured in sandbox | §3.2 |
| Paid, redirected, but sidebar still shows “Upgrade to Pro” | React Query cache, or subscription still `pending` (rare) | Refetch/reload; confirm subscription is Active in dashboard |
| Premium actions throw `FORBIDDEN` despite paying | Different Polar org than the one the token points at, or subscription canceled in portal | Verify org ↔ token ↔ product all belong to the same sandbox org |
| `getStateExternal` 404 for some user | User signed up before `createCustomerOnSignUp` existed (or customer deleted) | Manually create the customer in the dashboard with External ID = user id |
| Everything worked, then broke at once | OAT expired (you set an expiration) or auto-revoked by GitHub secret scanning | Rotate token (§3.5), update host env, restart |
| Portal button opens a broken page | Customer record missing/mismatched external id, or wrong-env token | Same checks as above; portal mints a customer session first |

General debugging tip: every Polar interaction flows through
`/api/auth/*` (Better Auth) or `premiumProcedure` (tRPC). Watch those two
request paths in the Network tab and the server terminal — the failing hop
names itself.

---

## 10. Reference links

- Better Auth adapter (official): https://polar.sh/docs/integrate/sdk/adapters/better-auth
- Organization Access Tokens: https://polar.sh/docs/integrate/oat
- Sandbox guide: https://polar.sh/docs/integrate/sandbox
- Customer State concept: https://polar.sh/docs/integrate/customer-state
- Webhooks: https://polar.sh/docs/integrate/webhooks/endpoints
- Usage-based billing: https://polar.sh/docs/features/usage-based-billing/introduction
- Test cards: https://docs.stripe.com/testing
- Repo truth sources: `docs/operations/environment_setup.md` (§5.5, §8.4),
  `docs/planning/tasks.md` (AF-M0-03 residuals, AF-M7-04),
  `docs/architecture/overview.md` (integration diagram).
