# Build Onboarding Checklist node

Builds a role-aware **onboarding checklist** and stores the structured task
list in the run context. Part of the onboarding flow (W2), used after the
employee is `ACTIVE` to hand tasks to IT, People, and the hiring manager.

- **Type id** (persisted in `Node.type`): `ONBOARDING_CHECKLIST`
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
specified. `dueOffsetDays` is relative to the employee's start date.

The config schema is the single source of truth for the settings dialog and
the save boundary — see `src/nodes/people/onboarding-checklist/definition.ts`.

## Result

The checklist is stored under `variableName` as:

```
{
  "checklist": {
    "phase": "ONBOARDING",
    "role": "Account Executive",
    "items": [
      { "key": "laptop_issue",  "label": "Issue laptop",          "owner": "IT",        "dueOffsetDays": 0, "completed": false },
      { "key": "handbook_read", "label": "Read employee handbook", "owner": "Hiring Mgr", "dueOffsetDays": 3, "completed": false }
    ],
    "generatedAt": "2026-09-05T09:14:00.000Z"
  }
}
```

Reference downstream as `{{checklist.checklist.items}}` to fan out one task
per item.

## Example

A standard IT + People checklist for every new hire:

- `variableName`: `checklist`
- `roleTitle`: `{{employee.role}}`
- `items`: `[{ "key": "laptop_issue",  "label": "Issue laptop", "owner": "IT", "dueOffsetDays": 0 }, { "key": "slack_invite", "label": "Invite to Slack", "owner": "People Team", "dueOffsetDays": 0 }]`

## Rules

- At least one item is required at run time; `label` is the only required
  field per item.
- This node builds the plan only. Executing the tasks (sending the Slack
  invitations, provisioning access) is out of scope and left to downstream
  steps in W2.