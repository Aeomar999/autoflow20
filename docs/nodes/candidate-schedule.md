# Schedule Candidate node

Schedules an interview slot for a candidate and stores the **booking link**
in the run context. Part of the acquisition flow (W1), between screening and
the offer.

- **Type id** (persisted in `Node.type`): `CANDIDATE_SCHEDULE`
- **Category**: ACTION
- **Icon**: `CalendarClock` (lucide)
- Since: AF-M11-03

## Config reference

| Field | Type | Required | Description |
|---|---|---|---|
| `variableName` | string | at run time | Key the booking record is stored under in the run context. |
| `candidateName` | string (template, ≤256) | optional | Candidate's full name. Handlebars `{{variables}}` supported. |
| `candidateEmail` | string (template, ≤512) | at run time | Candidate's email — used to identify the booking. Handlebars supported. |
| `interviewType` | one of `recruiter` `technical` `panel` `final` | optional | Round being scheduled. Defaults to `recruiter`. |
| `bookingUrlTemplate` | URL template (≤4096) | at run time | The booking page (e.g. a Cal.com or scheduling-tool link), resolved through `resolve()`. |

The config schema is the single source of truth for the settings dialog and
the save boundary — see `src/nodes/people/candidate-schedule/definition.ts`.

## Result

The booking record is stored under `variableName` as:

```
{
  "candidateName": "Ada Boateng",
  "candidateEmail": "ada.boateng@example.com",
  "interviewType": "final",
  "bookingUrl": "https://cal.com/acme/final-round"
}
```

`bookingUrl` is the resolved template. Downstream steps can read it as
`{{schedule.bookingUrl}}`.

## Example

Schedule the final round before the offer letter is drafted:

- `variableName`: `schedule`
- `candidateName`: `{{employee.name}}`
- `candidateEmail`: `{{employee.email}}`
- `interviewType`: `final`
- `bookingUrlTemplate`: `{{workflows.scheduleUrl}}/final`

## Rules

- `candidateEmail` and `bookingUrlTemplate` are required at run time and must
  resolve to a non-empty value.
- The template is resolved with the run's variables — static URLs work too.
- This node records the booking intent only. Creating the calendar event or
  sending the invite is out of scope and left to an outbound step in W1.