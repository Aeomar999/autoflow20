# Submit Benefits Enrollment node

Submits a new hire's **benefits plan selection** and stores the enrollment
record in the run context. Part of the onboarding flow (W2), used after the
employee is `ONBOARDING`.

- **Type id** (persisted in `Node.type`): `BENEFITS_ENROLLMENT`
- **Category**: ACTION
- **Icon**: `FileText` (lucide)
- Since: AF-M11-03

## Config reference

| Field | Type | Required | Description |
|---|---|---|---|
| `variableName` | string | at run time | Key the enrollment record is stored under in the run context. |
| `employeeName` | string (template, ≤256) | at run time | The new hire's name. Handlebars `{{variables}}` supported. |
| `plan` | one of `medical` `dental` `vision` `life` `401k` | optional | Selected plan. Defaults to `medical`. |
| `dependentsCount` | number (0–99) | optional | Number of dependents covered. Defaults to `0`. |
| `notes` | string (≤2000) | optional | Additional enrollment notes. |

The config schema is the single source of truth for the settings dialog and
the save boundary — see `src/nodes/people/benefits-enrollment/definition.ts`.

## Result

The enrollment record is stored under `variableName` as:

```
{
  "employeeName": "Kofi Mensah",
  "plan": "medical",
  "dependentsCount": 2,
  "status": "SUBMITTED"
}
```

`notes` is included only when set.

## Example

Enroll a new hire in their chosen plan once onboarding starts:

- `variableName`: `benefits`
- `employeeName`: `{{onboarding.employeeName}}`
- `plan`: `medical`
- `dependentsCount`: `2`

## Rules

- `employeeName` is required at run time and must resolve to a non-empty
  value.
- `plan`, `dependentsCount`, and `notes` are validated at config time, so a
  typo surfaces in the editor, not during a run.
- This node records the selection only. Transmitting it to an HRIS or benefits
  broker is out of scope and left to an outbound step in W2.