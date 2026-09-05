# Draft Offer Letter node

Drafts a candidate **offer letter** from template fields and stores the letter
text in the run context. Part of the acquisition flow (W1), after screening
and scheduling.

The generated letter is a **draft**. Its body states that the offer is
contingent on the successful completion of applicable background and reference
checks and that it must be reviewed and approved by the People Team before
signature. In the acquisition workflow (AF-M11-04) this node belongs on the
**accepted branch of a `core.approval` gate** so a human approves the offer
before the letter is emitted downstream — never on the rejected branch.

- **Type id** (persisted in `Node.type`): `OFFER_LETTER`
- **Category**: ACTION
- **Icon**: `FileText` (lucide)
- Since: AF-M11-03

## Config reference

| Field | Type | Required | Description |
|---|---|---|---|
| `variableName` | string | at run time | Key the letter record is stored under in the run context. |
| `companyName` | string (template, ≤256) | at run time | Company offering the role. |
| `roleTitle` | string (template, ≤256) | at run time | Title of the offered position. |
| `candidateName` | string (template, ≤256) | at run time | Candidate's full name. |
| `startDate` | string (template, ≤128) | at run time | Proposed start date. |
| `workLocation` | string (template, ≤256) | at run time | Where the role sits. |
| `compensationText` | string (template, ≤1024) | at run time | Compensation package (multi-line). |
| `employmentType` | one of `full_time` `part_time` `contract` | optional | Rendered as "full-time employment" / "part-time employment" / "contract engagement". Defaults to `full_time`. |
| `extraTerms` | string (≤4000) | optional | Rendered as a trailing "Additional terms" block when set. |

The config schema is the single source of truth for the settings dialog and
the save boundary — see `src/nodes/people/offer-letter/definition.ts`.

## Result

The letter record is stored under `variableName` as:

```
{
  "candidateName": "Ada Boateng",
  "roleTitle": "Account Executive",
  "companyName": "Acme",
  "startDate": "2026-11-01",
  "workLocation": "London",
  "employmentType": "full_time",
  "compensationText": "£150,000 base salary\nSign-on bonus of £10,000",
  "letter": "Dear Ada Boateng,\n\nWe are pleased to offer you…",
  "generatedAt": "2026-09-05T09:14:00.000Z"
}
```

Read the letter text as `{{offer.letter}}` to pass into an outbound email or
document step.

## Example

Draft a letter from screening data, gated on approval:

- `variableName`: `offer`
- `companyName`: `Acme`
- `roleTitle`: `{{shortlist.bestRole}}`
- `candidateName`: `{{employee.name}}`
- `startDate`: `{{workflows.startDate}}`
- `workLocation`: `London`
- `compensationText`: `£150,000 base salary`

## Rules

- `companyName`, `roleTitle`, `candidateName`, `startDate`, `workLocation`,
  and `compensationText` are required at run time and must resolve to a
  non-empty value.
- The letter is a draft — send it only after the `core.approval` accepted
  branch resolves; the rejected branch should notify the hiring team instead.
- This node drafts text only. Sending the letter is out of scope and left to
  an outbound step in W1.