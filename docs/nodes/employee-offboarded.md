# Complete Offboarding node

Emits the terminal **`employee.offboarded`** handoff once the exit checklist is
closed — moves the org-scoped `Employee` row from `OFFBOARDING` to
`OFFBOARDED`. It is the last node of the offboarding flow (W4) and the last
transition in the lifecycle: `EMPLOYEE_TRANSITIONS` leaves `OFFBOARDED` with no
successors.

Because the target status is also the end state, the guard's idempotent status
and its target are the same value: a replayed W4 run lands on
`already-current`, so **the exit completes exactly once**. A record that never
entered `OFFBOARDING` returns a `conflict` outcome — **as a value, not an
error** — rather than letting a run skip the offboarding phase entirely.

- **Type id** (persisted in `Node.type`): `EMPLOYEE_OFFBOARDED`
- **Category**: ACTION
- **Icon**: `UserRoundX` (lucide)
- Since: AF-M11-07

## Config reference

| Field | Type | Required | Description |
|---|---|---|---|
| `variableName` | string | at run time | Key the handoff outcome is stored under in the run context. |
| `employeeRef` | string (template, ≤200) | at run time | Stable reference that keys the employee row (e.g. `EMP-AMA-010`). |
| `exitDate` | string (template, ≤128) | optional | Confirmed last day, `YYYY-MM-DD` or a full ISO datetime. |

`exitDate` is normally already set by `EMPLOYEE_OFFBOARDING`; supplying it here
only overwrites it when the closing step carries a corrected last day. An
expression that resolves to nothing is treated as **absent**, so a date already
on the record is never blanked.

The config schema is the single source of truth for the settings dialog and
the save boundary — see `src/nodes/people/employee-offboarded/definition.ts`.

## Result

The handoff outcome is stored under `variableName` as a discriminated union
(from `src/features/employees/server/handoff.ts`):

| `outcome` | Meaning |
|---|---|
| `transitioned` | Record moved `OFFBOARDING → OFFBOARDED`. |
| `already-current` | Already `OFFBOARDED` — replay of a finished exit, no-op. |
| `conflict` | Record never entered `OFFBOARDING` (or the `employeeRef` is unknown); not changed. Includes a `reason`. |

Read it as `{{offboarded.outcome}}`.

## Example

From the "Run an exit from request to offboarded" template (AF-M11-07):

- `variableName`: `offboarded`
- `employeeRef`: `{{employeeRef}}`
- `exitDate`: `{{lastDay}}`

## Rules

- The tenant comes from the run: if the execution carries no
  `organizationId`, the node fails loudly rather than guessing.
- Resolved input is validated at the boundary against
  `employeeOffboardedSchema`.
- Never route `conflict` by omission — an exit that "completed" for an
  employee still marked `ACTIVE` is the silent failure this node prevents.
- No employee data is ever logged by the node or the handoff layer.
