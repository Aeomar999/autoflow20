# Send Email node

Sends an **email through an SMTP relay** and stores the delivery result in the
run context. Used to notify users, alert operators, or drop an audit message
mid-flow.

- **Type id** (persisted in `Node.type`): `EMAIL_SEND`
- **Category**: ACTION
- **Icon**: `Mail` (lucide)
- **Credential**: `smtp` (host, port, username, password, TLS mode)
- Since: AF-M3-06

## Config reference

| Field | Type | Required | Description |
|---|---|---|---|
| `variableName` | string | at run time | Key the result is stored under in the run context. |
| `credentialId` | string | at run time | The SMTP credential to send through. Resolved server-side; secrets never reach the client or the run trace. |
| `from` | email | config time | Sender address. Validated as an email by the config schema. |
| `fromName` | string (≤256) | optional | Display name shown with the sender address. |
| `to` | string (template, ≤4096) | at run time | Recipients, comma-separated. Handlebars `{{variables}}` supported. |
| `cc` | string (template, ≤4096) | optional | Copy recipients, comma-separated. Templates supported. |
| `bcc` | string (template, ≤4096) | optional | Blind-copy recipients, comma-separated. |
| `subject` | string (template, ≤1024) | at run time | Subject line. Templates supported. |
| `body` | string (template, ≤100,000) | optional | Plain-text message. Templates supported. |

The config schema is the single source of truth for the settings dialog and
the save boundary — see `src/nodes/email/send/definition.ts`.

## TLS mapping

The SMTP credential's `tls` field (`none` | `starttls` | `ssl`) is mapped onto
the transport as:

- `ssl` → `secure: true` (implicit TLS, port 465)
- `starttls` (default) → `secure: false, requireTLS: true`
- `none` → `secure: false, requireTLS: false`

All connection, greeting, and socket timeouts are bounded at 30s so a dead
relay fails the run instead of hanging it.

## Result

The delivery outcome is stored under `variableName` as:

```
{
  "email": {
    "from": "no-reply@example.com",
    "to": "team@example.com",
    "subject": "Invoice AF-42",
    "messageId": "<...@smtp.relay>"
  }
}
```

Reference it downstream as `{{sentEmail.email.messageId}}`,
`{{sentEmail.email.to}}`, etc.

## Example

Email an operator when a workflow hits an error branch:

- `variableName`: `sentEmail`
- `credentialId`: the `ops relay` SMTP credential
- `from`: `no-reply@example.com` · `fromName`: `AutoFlow`
- `to`: `ops@example.com`
- `subject`: `Workflow failed for {{data.userId}}`
- `body`:
  ```
  Workflow {{data.workflowId}} failed on node {{data.nodeId}} at {{data.createdAt}}.
  ```

## Rules

- The SMTP username and password are read only inside the execute step and are
  never stored, logged, or traced (see `docs/architecture/security.md` §3).
- Recipients and subject are required at run time; a missing field is a
  non-retriable config error, not a retry candidate.
- `from` is validated at config time so a typo surfaces in the editor, not
  during a run.
- The email body is plain text; HTML and attachments are out of scope for this
  node.