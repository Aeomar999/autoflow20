# Webhook-out node

Sends a **templated POST request** to a webhook URL and stores the delivery
response in the run context. Used to notify external systems, push events to
custom endpoints, or fan out to third-party integrations.

- **Type id** (persisted in `Node.type`): `WEBHOOK_OUT`
- **Category**: ACTION
- **Icon**: `Webhook` (lucide)
- Since: AF-M3-06

## Config reference

| Field | Type | Required | Description |
|---|---|---|---|
| `variableName` | string | at run time | Key the result is stored under in the run context. |
| `url` | string (template, ≤2048) | at run time | Webhook endpoint. Handlebars `{{variables}}` supported. SSRF-checked at run time (fail-closed, see `docs/architecture/security.md`). |
| `headers` | object | optional | JSON object of request headers. Keys and values support templates. |
| `body` | string (≤65,536) | optional | JSON request body. Defaults to `{}`. Templates supported; must remain valid JSON after templating. |
| `timeoutMs` | integer | optional | Per-request timeout. Clamped by the outbound guard. |
| `failOnNon2xx` | boolean | optional | When `true`, a non-2xx response throws instead of being stored. Default `false`. |

The config schema is the single source of truth for the settings dialog and
the save boundary — see `src/nodes/webhook/out/definition.ts`.

## Result

The response is stored under `variableName` as:

```
{
  "webhookResponse": {
    "status": 200,
    "statusText": "OK",
    "data": { ... }       // parsed JSON body, or raw text for other content types
  }
}
```

Reference it downstream as `{{myWebhook.webhookResponse.status}}`,
`{{myWebhook.webhookResponse.data}}`, etc.

## Example

Notify a custom endpoint when a user signs up, passing the user id through:

- `variableName`: `delivery`
- `url`: `https://hooks.example.com/users/{{data.userId}}`
- `body`:
  ```json
  {
    "event": "user.created",
    "userId": "{{data.userId}}",
    "at": "{{data.createdAt}}"
  }
  ```

Downstream nodes read `{{delivery.webhookResponse.status}}` to branch on
delivery success.

## Rules

- Outbound HTTP is checked against SSRF rules (no link-local, no loopback, no
  internal ranges) unless the endpoint is explicitly allowlisted.
- The body is validated as JSON **after** templating; a malformed template is a
  non-retriable config error, not a retry candidate.
- This node has no credential requirement — secrets belong in the payload or
  headers you configure, and are never logged or traced.