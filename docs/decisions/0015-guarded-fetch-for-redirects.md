# 0015 - The SSRF guard owns redirect following, via a `fetch` given to the client

**Status:** Accepted (AF-M8-16, found during the AF-M8-08 security review).

## Context

`assertSafeEndpoint` (in
`src/features/executions/components/http-request/egress-guard.ts`) resolves a
hostname and refuses the request when any resolved address is loopback,
private, link-local, CGNAT, or unspecified — the address families
`docs/architecture/security.md` §5 requires be unreachable from workflow nodes.
Every node that talks to a user-supplied URL called it: HTTP Request,
webhook-out, Slack, Discord, the OpenAI-compatible AI node, and knowledge URL
ingestion.

It validated exactly one URL: the first one.

Each call site then passed that URL to `ky`, which delegates redirect following
to `fetch`, whose default is `redirect: "follow"` for up to 20 hops. Nothing
re-entered the guard on a hop. So the check the guard exists to perform was
skipped for every URL after the first:

```
user configures  https://attacker.example/webhook   → guard resolves a public IP, passes
attacker replies 302 Location: http://169.254.169.254/latest/meta-data/
fetch follows                                       → the guarded address is reached
```

security.md §5 already listed "redirects that land on any of the above
(**re-check after every hop** — checking only the initial URL is the classic
bypass)" as a requirement. This was a spec that no code implemented, and the
guard's own docstring recorded following redirects as accepted residual risk.

The same section also named the module `src/lib/ssrf.ts`, which has never
existed.

## Decision

### 1. The guard follows redirects itself

`safeFetch(input, init)` performs the request with `redirect: "manual"` and
walks the chain in a loop, calling `assertSafeEndpoint` on every hop before
issuing it. `MAX_REDIRECT_HOPS` (5) bounds the chain; a 3xx with no `Location`
is returned as an ordinary response rather than followed.

### 2. It is handed to the HTTP client, not called instead of it

`ky` accepts a `fetch` implementation. Call sites pass
`{ ...options, fetch: safeFetch }` rather than replacing their `ky` call. This
matters: each site has its own timeout, retry, and `throwHttpErrors`
configuration (the AI node reads non-2xx bodies deliberately; the HTTP Request
node has a `failOnNon2xx` flag). Wrapping `ky` would have meant reimplementing
those semantics — including constructing `ky`'s own `HTTPError` — in the
guard. Supplying the transport leaves every one of them untouched and puts the
policy in a single function.

The one non-`ky` caller, knowledge URL ingestion, calls `safeFetch` directly in
place of global `fetch`.

### 3. Credential headers do not cross an origin boundary

On a redirect to a different origin, `authorization`, `cookie`, and
`proxy-authorization` are dropped, matching browser and `curl` behaviour.
Without this, a redirect is not only a way to reach an internal address but a
way to harvest the bearer token the node was configured with. Method rewriting
follows the fetch spec: 303 becomes `GET`, 301/302 become `GET` when the
original was `POST`, 307/308 preserve method and body.

## Consequences

- Redirect chains cost one round trip per hop rather than being handled inside
  `fetch`. Bounded at 5.
- A workflow that relied on a chain longer than five hops now fails with a
  `NonRetriableError` naming the limit. No such workflow is known to exist.
- **Not closed by this decision:** DNS rebinding. The guard resolves a hostname
  and then hands the hostname (not the vetted address) to `fetch`, which
  resolves it again; a record whose TTL expires in between can differ. Closing
  it needs a pinned-address connection — an `undici` custom dispatcher or
  connecting to the checked IP with the `Host` header preserved. Filed as
  **AF-M8-17**; it is a materially narrower window than an unchecked redirect,
  which was a single 302 away.
- `src/lib/ssrf.ts` still does not exist. security.md §5 now names the module
  that does.
