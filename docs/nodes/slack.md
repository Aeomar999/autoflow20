# Slack nodes

Five nodes on the Slack Web API (AF-M10-17), superseding the incoming-webhook
node.

| Node | Kind | Scopes |
|---|---|---|
| `SLACK_POST` | action | `chat:write`, `chat:write.public` |
| `SLACK_LIST_CHANNELS` | data | `channels:read`, `groups:read` |
| `SLACK_CREATE_CHANNEL` | action | `channels:manage` |
| `SLACK_INVITE` | action | `channels:manage` |
| `SLACK_DM_BY_EMAIL` | action | `users:read.email`, `im:write`, `chat:write` |

All five use the `slack.oauth2` credential.

---

## Slack does not use HTTP status codes to report failure

This is the single most important thing to know about the API, and the reason
the client exists.

Nearly every Slack error arrives as **`HTTP 200`** with a body of
`{"ok": false, "error": "channel_not_found"}`. A client that checks
`response.ok` — the obvious thing to write — treats a failed post as a
success, stores a junk result, and lets the workflow continue as though the
message had been delivered. `slackFetch` throws unless `ok` is exactly `true`;
a missing `ok` is failure too, because absent is not the same as true.

The exceptions, where Slack *does* use a status code:

| Status | Treated as |
|---|---|
| `429` | retriable, honouring `Retry-After` (Slack's tiered limits are strict) |
| `5xx` | retriable |

Everything else is decided by the `error` string. Retriable codes are
`ratelimited`, `internal_error`, `service_unavailable`, `fatal_error`,
`request_timeout`. Everything else is permanent — a channel that does not
exist will not exist on the third attempt.

## Scopes are declared per node

One Slack connection serves operations at very different privilege levels:
posting a message needs `chat:write`, creating a channel needs
`channels:manage`, and looking a person up by email needs `users:read.email` —
a grant an admin may well decline while allowing the other two.

So `CredentialRequirement` gained a `scopes` field. It does two jobs:

- The config panel shows what a node needs **before** the run, so "you have
  Slack connected" is not mistaken for "this node can run".
- The executor passes the declaration to the client, so Slack's answer for a
  missing grant — the bare token `missing_scope` — becomes a sentence naming
  the scope and telling you to reconnect.

Slack sometimes sends a `needed` field and sometimes does not; the node's own
declaration is used when it doesn't.

---

## Posting

`SLACK_POST` takes a channel per run, which is the whole point of superseding
the webhook node. Use the channel **ID** (`C0123ABCD`) rather than the display
name where you can — an ID survives a rename.

**Block Kit:** set `blocks` to a JSON array and `text` as well. Slack's API
technically allows blocks with no text, and then shows an empty string in the
sidebar, in the channel list, and in the push notification. The node refuses
that combination rather than shipping a message that reads as empty everywhere
except the channel itself.

Use three braces for the blocks expression — `{{{json message.blocks}}}`. Two
braces HTML-escape the quotes, and the node names that specific mistake rather
than reporting a JSON parse error.

Set `threadTs` to the `ts` of an earlier post to reply in-thread. Every post
returns its `ts`, which doubles as the message id.

## Creating channels

`SLACK_CREATE_CHANNEL` normalises the name to Slack's rules first —
lowercase, no spaces, only letters, digits, hyphens and underscores, 80
characters. A name from a template like `Acme Corp — Q3!` would otherwise
either be silently mangled or rejected outright depending on the characters.
Apostrophes are dropped rather than turned into separators, so `O'Brien deal`
becomes `obrien-deal` and not `o-brien-deal`.

**`name_taken` returns the existing channel rather than failing.** That is the
expected answer when the workflow already ran or when a person made the
channel first, so a create-if-absent flow needs no branch and a retried step is
idempotent. The output's `created` flag says which happened, so a welcome post
can fire only on a real creation.

If Slack says the name is taken but no visible channel has it — an archived
channel, or a private one the bot is not in — the node says exactly that
rather than reporting a phantom success.

## Inviting

`SLACK_INVITE` takes Slack **user IDs** (`U0123ABCD`), comma-separated — not
emails, not `@names`. Slack caps it at 1000 per call.

`already_in_channel` is treated as success. It is the goal state, and Slack
sends that code even when only *some* of the named users were already members,
so failing would break any flow that re-runs.

## DMs by email

`SLACK_DM_BY_EMAIL` resolves `users.lookupByEmail` and then posts. The address
must match the one on the person's **Slack profile**, which is frequently not
their work address — that is the near-universal cause of `users_not_found`, and
nothing in Slack's response says so, which is why the node's error does.

Set `skipIfNotFound` when running over a guest list: an external attendee has
no Slack account, and failing the run would stop everyone else being messaged.
The output reports `found` and `skipped` so a downstream step can tell the
difference between "messaged" and "nobody to message".

`chat.postMessage` accepts a user id directly as the channel and opens the DM
itself, so there is no separate `conversations.open` round trip.

---

## The retired webhook node

`SLACK` (type unchanged) is **deprecated**, not removed. Per
[ADR-0011](../decisions/0011-node-type-deprecation-lifecycle.md) it stays registered and
executable so saved workflows and published versions keep running; it is
dropped from the palette, so no new instance can be created. Removal is a
separate step, once no persisted node of that type remains.

Why it was retired:

- **An incoming-webhook URL is pinned to one channel** at creation time. Posting
  to a channel chosen at run time, creating a channel, and DMing a person are
  all impossible — which is four of the reference automations.
- **Its secret lived in plain node config.** `webhookUrl` is a bearer
  credential, and it landed in `NodeExecution.input` like any other config
  field.

Worth noting for anyone reading the gallery's "credential-free" count: the
webhook node made templates *look* zero-setup while still requiring the user to
create a Slack app, enable incoming webhooks, mint a channel-specific URL and
paste it in. Connecting Slack once through OAuth is less work, not more.

**Migrating a saved workflow:** replace the node with `SLACK_POST`, bind a
Slack credential, and move `content` → `text` and the webhook's channel →
`channel` (an ID is best). The 16 catalogue templates that used it were
migrated in AF-M10-17.

---

## Related

- [ADR-0011 — node type deprecation](../decisions/0011-node-type-deprecation-lifecycle.md)
- [OAuth connector setup manual](../operations/oauth_connectors_setup.md)
