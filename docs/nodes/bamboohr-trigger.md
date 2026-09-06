# BambooHR New Employee trigger

Starts a workflow when a person appears in your BambooHR **employee
directory** — the HRIS entry point for the employee lifecycle (W1 acquisition
→ W2 onboarding). It is the answer to "how does the chain open without someone
pressing Run", and it is a **polling** trigger because BambooHR has no outbound
webhook for directory changes.

- **Type id** (persisted in `Node.type`): `BAMBOOHR_TRIGGER`
- **Category**: TRIGGER
- **Icon**: `UserPlus` (lucide)
- **Credential**: `bamboohr.apiKey` (required)
- Since: AF-M11-10

## How the polling works

Nothing bespoke: this node registers a `PollingTrigger` on the AF-M10-05
framework (ADR-0024), so dispatch, dedupe, cursor persistence, backoff and the
never-replay-history rule all belong to the framework and its `TriggerState`
row. The connector answers exactly one question — *who is in the directory?* —
and gives each person an id.

- **Identity is the BambooHR employee id**, which is stable for the life of the
  record. A person is dispatched **once**, on the poll that first sees them; an
  edit to their row does not re-fire the chain. That is what you want when the
  downstream node creates an `Employee` and moves it to `OFFERED`.
- **Activating never replays your existing staff.** The framework suppresses
  dispatch on the first poll, so switching this on against a 400-person company
  starts zero runs and establishes the baseline.
- **Default interval is 900s** (15 minutes). A directory is not a message
  queue; polling it every minute buys nothing and spends the account's rate
  limit.

## Config reference

| Field | Type | Required | Description |
|---|---|---|---|
| `credentialId` | credential ref | yes | A `bamboohr.apiKey` credential (API key + company domain). |
| `department` | string (≤200) | optional | Only dispatch employees in this department, matched case-insensitively. Blank means every department. |
| `pollIntervalSeconds` | int 60–86400 | optional | Overrides the 900s default. Floored by the sweep's own minimum. |

## Item payload

Each dispatched run starts with:

```json
{
  "employee": {
    "employeeRef": "101",
    "email": "ada@example.com",
    "fullName": "Ada Boateng",
    "role": "Account Executive",
    "department": "Sales",
    "managerEmail": "grace@example.com",
    "startDate": "2026-11-01"
  },
  "source": "bamboohr"
}
```

plus the framework's own `trigger` root (`nodeId` / `itemId` / `polledAt`).

The shape drops straight into `EMPLOYEE_HIRED`: **`employeeRef` is the HRIS
employee id**, so the stable business key every handoff is addressed by is the
same identifier your HR system uses, and a re-poll can never duplicate the row.

## Rules

- An employee with **no work email is not dispatched**. `employeeHiredSchema`
  requires one, so a run started without it would be certain to fail at its
  second node — not starting it is the honest outcome, not a silent drop of a
  usable record.
- An employee with **no id is not dispatched** either: without a stable id the
  framework cannot deduplicate, and the person would re-run on every poll
  forever.
- A failed poll **throws**. Returning an empty list on a network error would be
  indistinguishable from "nothing new", and the trigger would look healthy while
  doing nothing (`engineering_rules.md` §2).
- The credential's company domain is charset-checked before it is put in the
  URL, and the request goes through the standard egress guard.
- No credential material is ever logged, returned, or placed in an error
  message.
