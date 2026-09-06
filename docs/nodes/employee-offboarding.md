# Start Offboarding node

Emits the **`employee.offboarding`** handoff when an exit is requested — moves
the org-scoped `Employee` row from `ACTIVE` to `OFFBOARDING`, recording the
exit date and reason. It is the entry point of the offboarding flow (W4), and
the phase every later W4 step assumes has already opened.

Applying the handoff is **idempotent and guarded** (AF-M11-02): a replay where
the employee is already `OFFBOARDING` is a no-op (`already-current`), and a
record that has not reached `ACTIVE` returns a `conflict` outcome — **as a
value, not an error** — so the workflow can route it to a human instead of
crashing the run.

- **Type id** (persisted in `Node.type`): `EMPLOYEE_OFFBOARDING`
- **Category**: ACTION
- **Icon**: `UserMinus` (lucide)
- Since: AF-M11-07

## Config reference

| Field | Type | Required | Description |
|---|---|---|---|
| `variableName` | string | at run time | Key the handoff outcome is stored under in the run context. |
| `employeeRef` | string (template, ≤200) | at run time | Stable reference that keys the employee row (e.g. `EMP-AMA-010`). |
| `exitDate` | string (template, ≤128) | optional | Last day, `YYYY-MM-DD` or a full ISO datetime. |
| `exitReason` | string (template, ≤500) | optional | Why the employee is leaving. |

An optional field whose expression resolves to nothing is treated as **absent**,
not as an empty string — an offboarding request that does not yet know the last
day still opens the phase rather than failing validation.

The config schema is the single source of truth for the settings dialog and
the save boundary — see `src/nodes/people/employee-offboarding/definition.ts`.

## Result

The handoff outcome is stored under `variableName` as a discriminated union
(from `src/features/employees/server/handoff.ts`):

| `outcome` | Meaning |
|---|---|
| `transitioned` | Record moved `ACTIVE → OFFBOARDING`; `exitDate`/`exitReason` written. |
| `already-current` | Already `OFFBOARDING` — at-least-once redelivery, no-op. |
| `conflict` | Record is not `ACTIVE` (or the `employeeRef` is unknown); not changed. Includes a `reason`. |

Read it as `{{offboarding.outcome}}` further down the graph.

## Example

From the "Run an exit from request to offboarded" template (AF-M11-07):

- `variableName`: `offboarding`
- `employeeRef`: `{{employeeRef}}`
- `exitDate`: `{{lastDay}}`
- `exitReason`: `{{exitReason}}`

## Rules

- The tenant comes from the run: if the execution carries no
  `organizationId`, the node fails loudly rather than guessing.
- Resolved input is validated at the boundary against the same
  `employeeOffboardingSchema` the router uses.
- Never route `conflict` by omission — it is returned deliberately so the
  graph decides.
- No employee data is ever logged by the node or the handoff layer.
