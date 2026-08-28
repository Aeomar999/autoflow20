# Slack send-message node

Posts a **templated message** to a Slack channel through an **incoming
webhook** and stores the delivered message in the run context. Used to notify
channels, route messages into a workspace, or drive downstream branching from a
chat event.

- **Type id** (persisted in `Node.type`): `SLACK`
- **Category**: ACTION
- **Icon**: `Hash` (lucide)
- Since: AF-M3-06

## Config reference

| Field | Type | Required | Description |
|---|---|---|---|
| `variableName` | string | at run time | Key the result is stored under in the run context. |
| `webhookUrl` | string (≤2048) | at run time | Slack incoming-webhook URL (the `https://hooks.slack.com/services/...` endpoint). SSRF-checked at run time (fail-closed, see `docs/architecture/security.md`). |
| `content` | string (≤4000) | at run time | Markdown message body. Handlebars `{{variables}}` and HTML entities supported; the stored copy is capped at 2000 characters. |

The config schema is the single source of truth for the settings dialog and
the save boundary — see `src/nodes/slack/send-message/definition.ts`.

## Result

The delivered message is stored under `variableName` as:

```
{
  "messageContent": "Hello usr_123"   // decoded, template-rendered, ≤2000 chars
}
```

Reference it downstream as `{{mySlack.messageContent}}`.

## Example

Notify a channel when a user signs up, passing the user id through:

- `variableName`: `signupAlert`
- `webhookUrl`: the incoming webhook on the target channel
- `content`:
  ```
  New signup: *{{data.userName}}* (<{{data.userEmail}}>) at {{data.createdAt}}
  ```

Content is rendered with Handlebars against the run context before posting, so
`{{signupAlert.messageContent}}` is available to downstream nodes.

## Rules

- The webhook URL is checked against SSRF rules (no link-local, no loopback, no
  internal ranges) unless the endpoint is explicitly allowlisted.
- The message must be non-empty at run time; missing `variableName` or
  `webhookUrl` are non-retriable config errors, not retry candidates.
- No secret material is ever logged or traced. Prefer an incoming webhook scoped
  to a single channel over a bot token.
- Known limitation: `webhookUrl` itself does not support templates today — only
  `content` renders against the run context.