# HTTP Request node

Calls any HTTP endpoint and stores the response in the run context. Since
AF-M10-01 it can authenticate with **any** stored credential, which is what
makes most of the automation library reachable without a bespoke node per
service.

- **Type id** (persisted in `Node.type`): `HTTP_REQUEST`
- **Category**: ACTION
- **Icon**: `Globe` (lucide)
- **Credential**: any registered type (`"*"`), optional
- Since: AF-A-04 · auth added AF-M10-01 (ADR-0022)

## Config reference

| Field | Type | Required | Description |
|---|---|---|---|
| `variableName` | string | at run time | Key the result is stored under in the run context. |
| `endpoint` | string (≤2,048) | at run time | Absolute `http(s)` URL. Supports `{{variables}}`. Vetted by the egress guard after rendering. |
| `method` | `GET`/`POST`/`PUT`/`PATCH`/`DELETE` | at run time | HTTP method. |
| `body` | string (≤65,536) | optional | JSON string body for `POST`/`PUT`/`PATCH`. Template-compiled, then parsed — a body that is not valid JSON after rendering fails the node. |
| `headers` | record<string,string> | optional | Request headers. Values support templates. **Do not put secrets here** — see below. |
| `queryParams` | record<string,string> | optional | URL query parameters. Values support templates. |
| `credentialId` | string | optional | The credential to authenticate with. Any registered type. |
| `authMode` | enum | optional | `none` (default) · `bearer` · `header` · `basic` · `queryParam` · `oauth2`. |
| `authHeaderName` | string (≤128) | optional | Header name for `authMode: "header"`. Defaults to the credential's own `name` field. |
| `authQueryParam` | string (≤128) | optional | Query parameter name for `authMode: "queryParam"`. Defaults to the credential's `name`, then `key`. |
| `timeoutMs` | number 250–60,000 | optional | Per-request timeout. Clamped by the egress guard. |
| `failOnNon2xx` | boolean | optional | When true, a non-2xx response fails the node instead of being stored. |

The config schema in `src/nodes/http/request/definition.ts` is the single source
of truth for the config panel and the save boundary.

## Authentication

Pick a credential and an auth mode. The secret is decrypted once by the engine
(AF-M3-04) and handed to the executor out of band; it is never read from node
config and never written to a trace row.

| `authMode` | What is sent | Credential fields read (in order) |
|---|---|---|
| `none` | nothing | — |
| `bearer` | `Authorization: Bearer <token>` | `token`, `accessToken`, `apiKey`, `value` |
| `oauth2` | `Authorization: Bearer <accessToken>` | `accessToken` only |
| `basic` | `Authorization: Basic base64(user:pass)` | `username`/`user`/`email` + `password`/`apiKey`/`token` |
| `header` | `<name>: <value>` | name from `authHeaderName` then `name`; value from `value`, `apiKey`, `token`, `accessToken` |
| `queryParam` | `?<name>=<value>` | name from `authQueryParam` then `name`/`param` then `key`; value from `apiKey`, `value`, `token`, `accessToken` |

`oauth2` deliberately does **not** fall back to an API key. Sending the wrong
kind of secret to an OAuth endpoint produces a 401 that reads like a
permissions problem, and users lose hours to it.

Token freshness is handled by the existing refresh job: `refresh-oauth-tokens`
rewrites `accessToken` in place every 15 minutes for credentials inside their
expiry window. The node reads the field; it never refreshes inline.

### Never put a secret in `headers`

Node config is persisted verbatim as `NodeExecution.input`. A token typed into
the `headers` map is in the run trace *before* the request is made — readable
by anyone who can view the run. Use a credential and an `authMode`; that path
keeps plaintext out of the trace entirely.

## Redirects and auth — the cross-origin rule

The egress guard re-vets **every** redirect hop: the destination is resolved,
checked against the private/metadata blocklist, and the socket is pinned to the
address that was approved (ADR-0015, ADR-0017).

On top of that, **a credential does not follow a redirect that leaves the
origin**:

- `Authorization`, `Cookie` and `Proxy-Authorization` are dropped cross-origin —
  the fetch spec's rule.
- **The header this node authenticated with is dropped too, whatever it is
  called.** A custom `X-API-Key` is not in the spec's list, so without this a
  server could answer `302 Location: https://attacker.example/` and collect the
  key. `buildHttpAuth` reports the header names it set and the executor hands
  them to the guard.

A **same-origin** redirect keeps the auth. That is the ordinary
`/v1/thing` → `/v1/thing/` case; dropping it there breaks real APIs and buys
nothing.

`queryParam` auth is not carried across a redirect at all — a `Location` header
is a new URL, and the original query string is not merged into it. If a target
redirects, `queryParam` auth will simply be absent on the next hop.

## Result

Stored under `variableName`:

```
{
  "httpResponse": {
    "status":     200,
    "statusText": "OK",
    "data":       { ... }        // parsed when content-type is JSON, else the raw text
  }
}
```

Reference it downstream as `{{myApi.httpResponse.data.id}}`.

**Echoed secrets are redacted.** If the endpoint returns the request back to
you — debug services, API gateways, test fixtures — every secret this request
sent is replaced with `[redacted]` before the payload leaves the node, so it
cannot reach `NodeExecution.output`. For `basic` auth both the password and the
base64 blob are redacted, since the blob is trivially reversible.

## Limits

- Response body is read through a 5 MiB cap and aborts past it.
- Node output is bounded by ADR-0018; a response that is large but under the
  read cap can still fail the node at the output boundary.
- Maximum 5 redirect hops.
- Endpoints resolving to loopback, private, link-local (including cloud
  metadata), CGNAT or unique-local addresses are refused.
- The per-node retry policy (AF-M9-06) applies as it does to every node.

## Example — an authenticated GET

- `variableName`: `contacts`
- `endpoint`: `https://api.hubapi.com/crm/v3/objects/contacts`
- `method`: `GET`
- `queryParams`: `{ "limit": "10" }`
- `credentialId`: the HubSpot private-app credential
- `authMode`: `bearer`

Downstream: `{{contacts.httpResponse.data.results.[0].properties.email}}`.

## Example — a Google API keyed by query parameter

- `endpoint`: `https://www.googleapis.com/customsearch/v1`
- `method`: `GET`
- `queryParams`: `{ "q": "{{trigger.body.query}}", "cx": "..." }`
- `credentialId`: the `googleCustomSearch.apiKey` credential
- `authMode`: `queryParam`
- `authQueryParam`: `key`
