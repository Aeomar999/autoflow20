# HubSpot Create Contact node

Creates a contact in **HubSpot** using a private app access token credential
and stores the returned contact object (id + properties) in the run context.

- **Type id** (persisted in `Node.type`): `HUBSPOT_CREATE_CONTACT`
- **Category**: ACTION
- **Icon**: `Contact` (lucide)
- **Credential**: `hubspot.apiKey` (private app access token · `Bearer` token)
- Since: AF-M3-06

## Config reference

| Field | Type | Required | Description |
|---|---|---|---|
| `variableName` | string | at run time | Key the result is stored under in the run context. |
| `credentialId` | string | at run time | The HubSpot API-key credential to authenticate with. Resolved server-side; the token never reaches the client or the run trace. |
| `properties` | string (≤65,536) | optional | JSON object of contact property name to value (e.g. `email`, `firstname`, `lastname`, `company`, `phone`). String values are template-compiled at run time; numbers, booleans, null, and arrays pass through. |

The config schema is the single source of truth for the settings dialog and
the save boundary — see `src/nodes/hubspot/create-contact/definition.ts`.

## Result

The created contact is stored under `variableName`:

```
{
  "id":         "1001",
  "properties": {
    "email":     "jane@example.com",
    "firstname": "Jane",
    "lastname":  "Doe",
    "createdate": "2026-08-28T12:00:00.000Z"
  },
  "createdAt": "2026-08-28T12:00:00.000Z",
  "updatedAt": "2026-08-28T12:00:00.000Z",
  "archived":  false
}
```

Reference the output downstream as `{{hubspotResult.id}}`,
`{{hubspotResult.properties.email}}`, etc.

## Example

Create a lead contact from the run's payload:

- `variableName`: `hubspotResult`
- `credentialId`: the `crm` HubSpot credential
- `properties`:
  ```
  {"email": "{{data.email}}", "firstname": "{{data.firstName}}", "lastname": "{{data.lastName}}", "company": "Acme"}
  ```

The downstream step can then read `{{hubspotResult.properties.email}}`.

## Rules

- The API key is read only inside the execute step and is never stored,
  logged, or traced (see `docs/architecture/security.md` §3).
- Variable name and credential are required at run time; a missing field is a
  non-retriable config error, not a retry candidate.
- `properties` must be a JSON object (not an array or null); anything else is
  rejected before the API is contacted.
- The outbound call is bounded at 30s; a network failure or timeout is
  retryable, while any API status error fails the run visibly.