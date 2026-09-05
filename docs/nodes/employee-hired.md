# Record New Hire node

Emits the **`employee.hired`** handoff for a signed candidate — creates the
org-scoped `Employee` row in `OFFERED` state, keyed by the stable
`employeeRef`. Part of the acquisition flow (W1), placed after the
`core.approval` gate resolves **accepted** and the offer letter has been
drafted.

Applying the handoff is **idempotent and guarded** (AF-M11-02): a replay where
the employee is already `OFFERED` is a no-op (`already-current`), while an
out-of-sequence event for a record that has moved past `OFFERED` returns a
`conflict` outcome — **as a value, not an error** — so the workflow can route
it to a human instead of crashing the run. A re-run of the same workflow never
creates a duplicate hire.

- **Type id** (persisted in `Node.type`): `EMPLOYEE_HIRED`
- **Category**: ACTION
- **Icon**: `UserPlus` (lucide)
- Since: AF-M11-04

## Config reference

| Field | Type | Required | Description |
|---|---|---|---|
| `variableName` | string | at run time | Key the handoff outcome is stored under in the run context. |
| `employeeRef` | string (template, ≤200) | at run time | Stable reference that keys the employee row (e.g. `EMP-ADA-009`). |
| `email` | string (template, ≤512) | at run time | Work email the employee is created with. |
| `fullName` | string (template, ≤300) | at run time | Full name. |
| `role` | string (template, ≤200) | at run time | Role title. |
| `department` | string (template, ≤200) | optional | Department. |
| `managerEmail` | string (template, ≤512) | optional | Manager's email. |
| `personalEmail` | string (template, ≤512) | optional | Personal email. |
| `startDate` | string (template) | optional | `YYYY-MM-DD` start date. |

The config schema is the single source of truth for the settings dialog and
the save boundary — see `src/nodes/people/employee-hired/definition.ts`.

## Result

The handoff outcome is stored under `variableName` as a discriminated union
(from `src/features/employees/server/handoff.ts`):

```
{ "outcome": "created", "employee": { "id": "…", "employeeRef": "EMP-ADA-009", "status": "OFFERED", … }, "status": "OFFERED" }
```

Outcome values:

| `outcome` | Meaning |
|---|---|
| `created` | Employee row created as `OFFERED` for this `employeeRef`. |
| `already-current` | Already `OFFERED` — at-least-once redelivery, no-op. |
| `transitioned` | Record moved forward into `OFFERED` from `CANDIDATE`. |
| `conflict` | Record is past `OFFERED`; not changed. Includes a `reason`. |

Read it as `{{hire.outcome}}` further down the graph — e.g. route `conflict`
to a human-in-the-loop step rather than treating the hire as recorded.

## Example

From the "Screen, score, approve and record a hire" template (AF-M11-04):

- `variableName`: `hire`
- `employeeRef`: `{{employeeRef}}`
- `email`: `{{candidateEmail}}`
- `fullName`: `{{candidateName}}`
- `role`: `{{roleTitle}}`
- `department`: `{{department}}`
- `startDate`: `{{startDate}}`

## Rules

- The tenant comes from the run: if the execution carries no
  `organizationId`, the node fails loudly rather than guessing.
- Resolved input is validated at the boundary against the same
  `employeeHiredSchema` the router and public API use.
- Never route `conflict` by omission — it is returned deliberately so the
  graph decides; silence is the failure mode this node exists to prevent.
- No employee data is ever logged by the node or the handoff layer.