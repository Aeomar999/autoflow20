# Build Offboarding Checklist node

Builds an **offboarding checklist** and stores the structured task list in the
run context. Part of the offboarding flow (W4), used once the employee is
`OFFBOARDING` to hand revocation and handoff tasks to IT, Security, and the
hiring manager.

- **Type id** (persisted in `Node.type`): `OFFBOARDING_CHECKLIST`
- **Category**: TRANSFORM
- **Icon**: `ClipboardList` (lucide)
- Since: AF-M11-03

## Config reference

| Field | Type | Required | Description |
|---|---|---|---|
| `variableName` | string | at run time | Key the checklist is stored under in the run context. |
| `roleTitle` | string (template, ≤128) | optional | Role the checklist is built for (drives which tasks apply). |
| `items` | list of rows (1–30) | at run time | Each row: `key` (variable-name style), `label` (1–200), `owner` (≤128, optional), `dueOffsetDays` (0–180, default `0`). |

Every item defaults to `completed: false` and `dueOffsetDays: 0` when not
specified. `dueOffsetDays` is relative to the employee's departure date.

The config schema is the single source of truth for the settings dialog and
the save boundary — see `src/nodes/people/offboarding-checklist/definition.ts`.

## Result

The checklist is stored under `variableName` as:

```
{
  "checklist": {
    "phase": "OFFBOARDING",
    "role": "Account Executive",
    "items": [
      { "key": "asset_return", "label": "Return company laptop", "owner": "IT", "dueOffsetDays": 0, "completed": false },
      { "key": "access_revoke", "label": "Revoke system access",  "owner": "IT", "dueOffsetDays": 0, "completed": false }
    ],
    "generatedAt": "2026-09-05T09:14:00.000Z"
  }
}
```

Reference downstream as `{{checklist.checklist.items}}` to fan out one task
per item.

## Example

The standard revocation list for every departing employee:

- `variableName`: `checklist`
- `roleTitle`: `{{employee.role}}`
- `items`: `[{ "key": "asset_return", "label": "Return company laptop", "owner": "IT", "dueOffsetDays": 0 }, { "key": "badge_handin", "label": "Hand in badge", "owner": "Security", "dueOffsetDays": 0 }]`

## Rules

- At least one item is required at run time; `label` is the only required
  field per item.
- This node builds the plan only. Executing the tasks (revoking access,
  collecting assets) is out of scope and left to downstream steps in W4.