# Request Background Check node

Requests a **background or reference check** for a candidate and stores the
request record in the run context. Part of the acquisition flow (W1), where
vetting runs before an offer is approved.

- **Type id** (persisted in `Node.type`): `BACKGROUND_CHECK`
- **Category**: ACTION
- **Icon**: `ShieldCheck` (lucide)
- Since: AF-M11-03

## Config reference

| Field | Type | Required | Description |
|---|---|---|---|
| `variableName` | string | at run time | Key the request record is stored under in the run context. |
| `candidateName` | string (template, ≤256) | at run time | Candidate's full name. Handlebars `{{variables}}` supported. |
| `candidateEmail` | string (template, ≤512) | at run time | Candidate's email. Handlebars supported. |
| `checkType` | one of `standard` `enhanced` `reference` | optional | Depth of the check. Defaults to `standard`. |
| `notes` | string (≤2000) | optional | Memo or reviewer text attached to the request. |

The config schema is the single source of truth for the settings dialog and
the save boundary — see `src/nodes/people/background-check/definition.ts`.

## Result

The request record is stored under `variableName` as:

```
{
  "candidateName": "Ama Osei",
  "candidateEmail": "ama.osei@example.com",
  "checkType": "enhanced",
  "status": "REQUESTED",
  "requestId": "<server-generated id>"
}
```

`notes` is included only when set. Reference the record downstream as
`{{vetting.requestId}}`, `{{vetting.status}}`, etc.

## Example

Request a standard check for every successful candidate:

- `variableName`: `vetting`
- `candidateName`: `{{employee.name}}`
- `candidateEmail`: `{{employee.email}}`
- `checkType`: `standard`

## Rules

- `candidateName` and `candidateEmail` are required at run time and must
  resolve to a non-empty value — a blank expression is a non-retriable config
  error, not a retry candidate.
- The `requestId` is generated server-side; it is not configured in, and cannot
  be templated into, the config.
- This node emits the request record only. Submitting it to a screening vendor
  and handling the verdict are out of scope and left to outbound steps in the
  workflow (see AF-M11-04).