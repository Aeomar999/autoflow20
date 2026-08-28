# Google Sheets Append node

Appends rows to a **Google Sheets** spreadsheet using an OAuth2 credential and
stores where the rows landed (range + update counts) in the run context.

- **Type id** (persisted in `Node.type`): `GOOGLE_SHEETS_APPEND`
- **Category**: ACTION
- **Icon**: `Table2` (lucide)
- **Credential**: `google.oauth2` (OAuth access token)
- Since: AF-M3-06

## Config reference

| Field | Type | Required | Description |
|---|---|---|---|
| `variableName` | string | at run time | Key the result is stored under in the run context. |
| `credentialId` | string | at run time | The Google OAuth2 credential to authenticate with. Resolved server-side; the access token never reaches the client or the run trace. |
| `spreadsheetId` | string (≤1,024) | at run time | The spreadsheet's id, taken from its shareable URL. Supports `{{variables}}`. |
| `sheetName` | string (≤1,024) | at run time | Tab name or **A1-style range** to append after, e.g. `Sheet1` or `Leads!A2:C`. Supports `{{variables}}`. |
| `values` | string (≤65,536) | optional | JSON array of rows to append. String cells are template-compiled at run time; numbers, booleans, and null pass through; object cells serialize to JSON. |

The config schema is the single source of truth for the settings dialog and
the save boundary — see `src/nodes/google-sheets/append/definition.ts`.

## OAuth note

Authentication uses the access token stored on the `google.oauth2` credential.
The node does **not** refresh tokens server-side: when the token expires, the
API returns `401` and the run fails with a visible non-retriable error. The
credential must be granted OAuth scopes covering the target spreadsheet (the
spreadsheets scope), which is a per-credential concern set at connect time.

## Result

The append outcome is stored under `variableName`:

```
{
  "spreadsheetId": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
  "tableRange":  "Sheet1!A1:C4",
  "updates": {
    "updatedRange":  "Sheet1!A5:C5",
    "updatedRows":     1,
    "updatedColumns":  3,
    "updatedCells":    3
  }
}
```

Reference the output downstream as `{{appendResult.updates.updatedRange}}`,
`{{appendResult.updates.updatedRows}}`, etc.

## Example

Append a row from the run's payload to the `Leads` tab:

- `variableName`: `appendResult`
- `credentialId`: the `marketing` Google credential
- `spreadsheetId`: `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms`
- `sheetName`: `Leads!A2:C`
- `values`:
  ```
  [["{{data.email}}", "{{data.name}}", {{data.score}}]]
  ```

The downstream step can then read `{{appendResult.updates.updatedCells}}`.

## Rules

- The access token is read only inside the execute step and is never stored,
  logged, or traced (see `docs/architecture/security.md` §3).
- Variable name, credential, spreadsheet id, and sheet are required at run
  time; a missing field is a non-retriable config error, not a retry
  candidate.
- `values` must be a non-empty JSON array of arrays; anything else is rejected
  before the API is contacted.
- The spreadsheet id is percent-encoded into the request path; the sheet range
  is interpolated as-is because it can contain `:`, `!`, and quotes.
- The outbound call is bounded at 30s; a network failure or timeout is
  retryable, while any API status error fails the run visibly.