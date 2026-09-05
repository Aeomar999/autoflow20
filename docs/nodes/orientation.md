# Build Orientation Session node

Plans a new-hire **orientation session** — logistics and agenda — and stores
the plan in the run context. Part of the onboarding flow (W2), used once the
employee is `ONBOARDING`.

- **Type id** (persisted in `Node.type`): `ORIENTATION`
- **Category**: ACTION
- **Icon**: `UserPlus` (lucide)
- Since: AF-M11-03

## Config reference

| Field | Type | Required | Description |
|---|---|---|---|
| `variableName` | string | at run time | Key the session plan is stored under in the run context. |
| `sessionName` | string (template, ≤256) | optional | Name of the session. Handlebars `{{variables}}` supported. |
| `startDate` | string (template, ≤128) | optional | Proposed session date. Handlebars supported. |
| `locationOrMode` | string (template, ≤256) | optional | Location or mode (e.g. "Hybrid HQ", "Remote"). Handlebars supported. |
| `durationMinutes` | number (15–480) | optional | Planned length. Defaults to `60`. |
| `agendaItems` | list of rows (≤20) | optional | Each row: `time` (≤64, optional), `topic` (1–200), `owner` (≤128, optional). |

The config schema is the single source of truth for the settings dialog and
the save boundary — see `src/nodes/people/orientation/definition.ts`.

## Result

The session plan is stored under `variableName` as:

```
{
  "orientation": {
    "sessionName": "New-hire orientation",
    "startDate": "2026-10-05",
    "locationOrMode": "Hybrid HQ",
    "durationMinutes": 120,
    "agenda": [
      { "time": "09:00", "topic": "Company culture walkthrough", "owner": "People Team" },
      { "time": "10:30", "topic": "Team intro",                 "owner": "Hiring Manager" }
    ]
  }
}
```

Reference downstream as `{{orientation.orientation.agenda}}` to fan out one
session block per agenda row.

## Example

A two-hour hybrid session for a new hire:

- `variableName`: `orientation`
- `sessionName`: `New-hire orientation`
- `startDate`: `{{onboarding.startDate}}`
- `locationOrMode`: `Hybrid HQ`
- `durationMinutes`: `120`

## Rules

- `sessionName`, `startDate`, and `locationOrMode` are optional in config;
  when an agenda is provided each `topic` must be present.
- Fields marked template are resolved with the run's variables — static values
  work too.
- This node builds the plan only. Sending the calendar invite or reserving the
  room is out of scope and left to an outbound step in W2.