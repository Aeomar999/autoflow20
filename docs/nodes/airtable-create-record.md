# Airtable Create Record node

Creates a record in an **Airtable** table using a personal access token (PAT)
credential and stores the created record (id + returned fields) in the run
context.

- **Type id** (persisted in `Node.type`): `AIRTABLE_CREATE_RECORD`
- **Category**: ACTION
- **Icon**: `Table` (lucide)
- **Credential**: `airtable.apiKey` (PAT · `Bearer` token)
- Since: AF-M3-06

## Config reference

| Field | Type | Required | Description |
|---|---|---|---|
| `variableName` | string | at run time | Key the result is stored under in the run context. |
| `credentialId` | string | at run time | The Airtable API-key credential to authenticate with. Resolved server-side; the token never reaches the client or the run trace. |
| `baseId` | string (≤2,048) | at run time | The base (app) id, e.g. `appXXXXXXXXXXXXXX`, or its URL-encoded name. Supports `{{variables}}`. |
| `tableId` | string (≤2,048) | at run time | The table id (`tblXXXXXXXXXXXXXX`) or table name. Supports `{{variables}}`. |
| `fields` | string (≤65,536) | optional | JSON object of field name to value for the new record. String values are template-compiled at run time; numbers, booleans, null, and arrays pass through. |

The config schema is the single source of truth for the settings dialog and
the save boundary — see `src/nodes/airtable/create-record/definition.ts`.

## Result

The created record is stored under `variableName`:

```
{
  "id":          "recXXXXXX",
  "createdTime": "2026-08-28T12:00:00.000Z",
  "fields": {
    "Name":  "Jane Doe",
    "Email": "jane@example.com",
    "Score": 42
  }
}
```

Reference the output downstream as `{{airtableResult.id}}`,
`{{airtableResult.fields.Name}}`, etc.

## Example

Create a lead record from the run's payload:

- `variableName`: `airtableResult`
- `credentialId`: the `crm` Airtable credential
- `baseId`: `appXXXXXXXXXXXXXXXX`
- `tableId`: `tblLeads`
- `fields`:
  ```
  {"Name": "{{data.name}}", "Email": "{{data.email}}", "Score": {{data.score}}}
  ```

The downstream step can then read `{{airtableResult.fields.Email}}`.

## Rules

- The API key is read only inside the execute step and is never stored,
  logged, or traced (see `docs/architecture/security.md` §3).
- Variable name, credential, base id, and table are required at run time; a
  missing field is a non-retriable config error, not a retry candidate.
- `fields` must be a JSON object (not an array or null); anything else is
  rejected before the API is contacted.
- Both the base id and the table id are percent-encoded into the request path,
  so URL-safe table names work as-is.
- The outbound call is bounded at 30s; a network failure or timeout is
  retryable, while any API status error fails the run visibly.