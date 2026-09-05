# GitHub, Jira and Notion nodes

Ten nodes across three services (AF-M10-18).

| Node | Kind | Credential |
|---|---|---|
| `GITHUB_TRIGGER` | trigger | `github.oauth2` (optional) |
| `GITHUB_CREATE_PR` | action | `github.oauth2` |
| `GITHUB_LIST_COMMITS` | data | `github.oauth2` |
| `GITHUB_SEARCH_PRS` | data | `github.oauth2` |
| `JIRA_CREATE_ISSUE` | action | `atlassian.oauth2` |
| `JIRA_TRANSITION` | action | `atlassian.oauth2` |
| `JIRA_SEARCH` | data | `atlassian.oauth2` |
| `JIRA_ADD_ATTACHMENT` | action | `atlassian.oauth2` |
| `NOTION_CREATE_PAGE` | action | `notion.oauth2` |
| `NOTION_QUERY_DATABASE` | data | `notion.oauth2` |

---

## One signature verifier, not three

Every provider signs a webhook the same way — HMAC of the raw body under a
shared secret — and differs only in cosmetics: Intuit sends base64, GitHub
sends hex behind a `sha256=` prefix. Writing that comparison once per provider
is how one of them ends up using `===`, and `===` on a signature is a
vulnerability rather than a style problem.

So `src/lib/server/webhook-signature.ts` holds the codebase's only constant-time
signature comparison. The per-provider modules describe their header format and
delegate. The QuickBooks verifier from AF-M10-16 was moved onto it.

It fails closed on every path: absent header, absent secret, wrong prefix,
undecodable digest, wrong length, wrong value. Two are worth calling out:

- **An empty secret is refused.** HMAC with `""` is a perfectly valid digest, so
  a route whose env var is unset would otherwise verify signatures an attacker
  can compute.
- **A short decode is refused.** `Buffer.from` is lenient — it drops invalid
  characters rather than throwing — so garbage decodes to a short buffer. The
  length check is what rejects it, not an optimisation.

---

## GitHub

### Rate limits look like permission errors

GitHub runs **two** limiters and reports both as `403`:

| Signal | Meaning | Handling |
|---|---|---|
| `x-ratelimit-remaining: 0` + `x-ratelimit-reset` | primary limit | retry at the reset time |
| `retry-after`, no remaining counter | secondary ("abuse") limit | retry after that many seconds |
| neither | a real permission problem | permanent failure |

A bare `status === 403 → permanent` turns a wait-and-succeed into a failed run.

### 404 does not mean "not found"

GitHub answers **404, not 403**, for a private repository the token cannot see —
deliberately, so you cannot probe for existence. The node's error says so,
because "repository not found" sends people hunting for a typo when the cause is
a missing `repo` scope or an organisation that has not approved the OAuth app.

### The trigger

`GITHUB_TRIGGER` receives from one app-wide endpoint at `/api/webhooks/github`,
the same shape as the Intuit route: no secret in the URL, the signature is the
only proof, and routing happens after verification by matching the payload's
repository to a published trigger. Set `GITHUB_WEBHOOK_SECRET` and point your
repository webhooks at it.

**A trigger that names no repository is skipped, not treated as a wildcard.**
On a single shared endpoint a blank repo would fire one workspace's workflow on
every other workspace's repositories.

The event name comes from the `X-GitHub-Event` header, not the body — a `push`
body and a `pull_request` body share almost no top-level keys, so code that
sniffs the shape works until it doesn't. The action filter is ignored for events
that have no action, so a trigger listening for pushes *and* opened PRs does not
silently drop every push.

Only `X-Hub-Signature-256` is accepted. GitHub still sends the SHA-1
`X-Hub-Signature` for pre-2019 consumers; accepting it would let anyone who can
forge the weaker digest through the same door.

### Creating a pull request

`GITHUB_CREATE_PR` returns the **existing** open PR when GitHub reports one for
the same branches, so a re-run is idempotent; `created` says which happened. A
blank `base` means the repository's default branch, which is not always `main`.
"No commits between" is reported as an empty branch rather than as an API fault.

---

## Jira

### Transitions are per-project — use the name

This is the one that breaks ported automations. Transition **ids** are assigned
per workflow scheme, so `31` is *Done* in the project it was copied from and
something else — or nothing — anywhere else. Every published automation that
hardcodes an id is broken for everyone but its author.

`JIRA_TRANSITION` takes a **name**. At run time it asks that issue what
transitions it currently has, matches case-insensitively, and falls back to the
destination **status** name — because people say "move it to Done" when the
transition is called *Finish Work* and *Done* is what it lands on. A name that
does not match produces an error listing what *is* available, which is usually
enough to see that the issue is already in the target status.

### Rich text is ADF, not a string

The v3 API takes descriptions and comments as an Atlassian Document Format
tree. Passing a plain string — which every v2 example does — is rejected with a
message about "operation value must be an object" that never mentions ADF.
`textToAdf` wraps plain text: blank lines become paragraphs, single newlines
become hard breaks so a pasted list keeps its shape.

### The base URL lives in the credential

Jira Cloud is reached at `api.atlassian.com/ex/jira/{cloudId}`, not at the
site's own `*.atlassian.net` domain. The cloud id is resolved once during the
OAuth exchange. A credential without one predates that and needs reconnecting —
the node says so rather than failing on a malformed URL.

### Attachments need a header nothing else does

`X-Atlassian-Token: no-check` is **mandatory** on an attachment upload. Without
it Jira rejects it as suspected XSRF and answers with an HTML error page, so a
client that assumes JSON reports a parse failure and buries the cause. The
multipart field name must be exactly `file`.

`JIRA_SEARCH` requests named fields only. The default response carries every
custom field on every issue, which on a mature site is tens of kilobytes a row.

---

## Notion

### Permission is per-object, not per-scope

Notion has no OAuth scope strings. A connection sees only the pages and
databases a person explicitly shared with the integration, and an unshared
database returns the same `object_not_found` as one that does not exist — with
the second being far more common. So "you have Notion connected" says nothing
about whether a given database is reachable, and the node's error names sharing
as the first thing to check.

### `Notion-Version` is required

Every request carries `Notion-Version: 2022-06-28`. Omitting it is a hard 400,
and pinning it stops a future Notion default from changing response shapes under
a running workflow.

### Property values are a tagged union

A `select` column will not accept a `rich_text` value, and the error says "body
failed validation" without naming the column. `NOTION_CREATE_PAGE` reads the
database schema first and wraps each plain string the way its column declares,
so you author `{"Status": "Draft"}` rather than Notion's union.

- A column name that does not exist **fails loudly** and lists the real ones.
  Notion is case-sensitive about property names, so this is nearly always a
  capitalisation mismatch — and creating a row with columns silently missing is
  worse than not creating it.
- Computed columns (`formula`, `rollup`, `created_time`) cannot be written and
  are reported as skipped rather than sent.
- A date Notion cannot parse is skipped, because an unparseable date is rejected
  for the *whole page* and one bad value would lose every other column.

### Ids

Paste a URL or an id, dashed or not. The query string is dropped **before** the
id is extracted: a database URL carries its view id in `?v=`, after the object
id, so scanning the whole string and taking the last match returns the view —
which is not a database the API will find.

---

## Related

- [Slack nodes](slack.md) — the same client-boundary and scope patterns
- [QuickBooks nodes](quickbooks.md)
