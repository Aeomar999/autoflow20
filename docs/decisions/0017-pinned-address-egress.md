# 0017 - Egress connects to the address the guard vetted, via undici

**Status:** Accepted (AF-M8-17).
**Supersedes the residual risk recorded in** ADR-0015 and `docs/architecture/security.md` §5.

## Context

`resolveSafeEndpoint` resolves a hostname and refuses the request when any
resolved address is loopback, private, link-local, CGNAT, or unspecified.
ADR-0015 then made the guard re-run on every redirect hop, closing the bypass
where a `302` reached cloud metadata.

One window stayed open, and it was written down rather than fixed: the guard
resolved the hostname, and then handed the **hostname** to `fetch`, which
resolved it *again* when opening the socket. A DNS record whose TTL expires
between those two resolutions can answer differently the second time. The guard
says "93.184.216.34, public, fine" and the connection opens to `127.0.0.1`.

That is DNS rebinding. It is narrower than the redirect hole - it needs an
attacker-controlled authoritative nameserver and a short TTL, rather than a
single `302` - but it defeats the entire IP blocklist when it lands, and the
blocklist is the control the whole guard exists to enforce.

## Decision

### 1. Connect to the address that was vetted

`pinnedDispatcher(hostname, addresses)` builds an undici `Agent` whose
connector-level DNS `lookup` is replaced with one that returns the addresses
`resolveSafeEndpoint` already approved. There is no second resolution, so
there is no window for the answer to change.

`assertSafeEndpoint` is kept as a thin wrapper returning just the URL, because
all six node call sites want that shape and none of them should have to know
about dispatchers.

### 2. Override the lookup, do not rewrite the URL to an IP

The obvious alternative - request `https://93.184.216.34/...` with a `Host`
header - breaks TLS. The certificate is validated against the name in the URL,
so an IP URL either fails validation or has to be told to skip it, and
"skip certificate validation" is not a change worth making inside a security
control. Virtual-hosted origins would also serve the wrong site.

Overriding the lookup leaves the request identical in every respect a server or
a CA can observe: SNI and the `Host` header still carry the hostname. Only the
socket's destination is fixed. A test asserts the origin still sees the
hostname, because that property is the reason for the design.

### 3. The dispatcher fails closed on an unexpected host

A dispatcher is built per request. If its lookup is asked about a different
hostname, a redirect reached the connector without being re-vetted, and it
errors rather than resolving normally. This should be unreachable - `safeFetch`
re-vets at the top of every hop - which is exactly why it is worth asserting.

### 4. undici becomes a direct dependency

`engineering_rules` and AGENTS.md DON'T-12 require justification for a new
dependency. This one is narrow:

- **Nothing in the existing stack can do it.** Pinning a connection needs
  control of the connector, and Node exposes no way to configure the fetch it
  ships with.
- **It is not a new runtime.** undici *is* Node's fetch implementation. Adding
  it as a direct dependency makes the client already in use configurable; it
  does not introduce a second HTTP stack.
- **It was already installed** - transitively, via `@ai-sdk/provider-utils` and
  `jsdom`. Depending on a transitive dependency is what we were doing
  implicitly; this makes it explicit and version-pinned.
- **Pinned to `^7`**, because undici 8 requires Node 22 and CI runs Node 20.

The alternative - rebuilding the egress path on `node:https`, which accepts a
`lookup` directly - avoids the dependency but requires reimplementing response
decompression, streaming, and the `Response` shape that `ky` and
`readCappedText` consume. More code, in the security-critical path, to avoid a
dependency that is already installed.

## Consequences

- **No connection reuse on the egress path.** The dispatcher is per request, so
  keep-alive does not span requests. Workflow node calls are not a hot loop and
  correctness beats pooling here, but it is a real cost and it is the first
  thing to revisit if egress latency ever matters.
- **A silent regression is possible in principle and tested against.** The
  failure mode that matters is not an exception - it is a Node or undici
  version that ignores the dispatcher, resolves the hostname again, and looks
  exactly like success while providing nothing. `egress-guard.test.ts` pins a
  hostname that can never resolve (`pinned.invalid`, RFC 6761) to a real local
  server: if the dispatcher is ever ignored, the lookup fails and the suite goes
  red on whatever Node version CI runs.
- **`security.md` §5 has no open items left.** Every bullet in that section is
  now enforced by code with a test behind it.
- Requests are resolved twice in the common path - once by the node call site's
  `assertSafeEndpoint`, once by `safeFetch` - because the call sites vet before
  they know they will use `safeFetch`. Harmless, and the second one is the one
  that gets pinned.
