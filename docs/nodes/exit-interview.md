# Schedule Exit Interview node

Schedules an **exit interview** for a departing employee and stores the
session record in the run context. Part of the offboarding flow (W4), used
after the employee is `OFFBOARDING`.

- **Type id** (persisted in `Node.type`): `EXIT_INTERVIEW`
- **Category**: ACTION
- **Icon**: `MessageSquare` (lucide)
- Since: AF-M11-03

## Config reference

| Field | Type | Required | Description |
|---|---|---|---|
| `variableName` | string | at run time | Key the session record is stored under in the run context. |
| `employeeName` | string (template, ≤256) | at run time | The departing employee's name. Handlebars `{{variables}}` supported. |
| `departureDate` | string (template, ≤128) | optional | The employee's last working day. Handlebars supported. |
| `interviewer` | string (template, ≤128) | optional | Who runs the session. Handlebars supported. |
| `format` | one of `video` `in_person` `written` | optional | Session format. Defaults to `video`. |
| `focusAreas` | list of rows (`area`, 1–200) | optional | Topics to cover. At most 10. |

The config schema is the single source of truth for the settings dialog and
the save boundary — see `src/nodes/people/exit-interview/definition.ts`.

## Result

The session record is stored under `variableName` as:

```
{
  "employeeName": "Dede Osei",
  "departureDate": "2026-11-30",
  "interviewer": "People Team",
  "format": "in_person",
  "focusAreas": ["Handoff of open work", "Reason for leaving"],
  "status": "SCHEDULED"
}
```

`departureDate`, `interviewer`, and `focusAreas` appear only when configured;
`focusAreas` is flattened to a list of strings.

## Example

Schedule a written exit interview for an `OFFBOARDING` employee:

- `variableName`: `exit`
- `employeeName`: `{{employee.name}}`
- `departureDate`: `{{employee.departureDate}}`
- `format`: `written`
- `focusAreas`: `[{ "area": "Handoff of open work" }]`

## Rules

- `employeeName` is required at run time and must resolve to a non-empty
  value.
- If the email is missing, a non-retriable config error surfaces — it does not
  silently skip the interview.
- This node records the session plan only. Sending the calendar invite or the
  questionnaire is out of scope and left to an outbound step in W4.