# Score & Rank Candidates node

Scores a JSON list of candidates against a **weighted rubric** and ranks them
from best to worst fit. Part of the acquisition flow (W1), used to shortlist
before an offer.

- **Type id** (persisted in `Node.type`): `CANDIDATE_SCORE_RANK`
- **Category**: TRANSFORM
- **Icon**: `UserSearch` (lucide)
- Since: AF-M11-03

## Config reference

| Field | Type | Required | Description |
|---|---|---|---|
| `variableName` | string | at run time | Key the ranking result is stored under in the run context. |
| `candidatesJson` | string (template, ≤100k) | at run time | A JSON array of candidates, each `{ "name": string, "scores": { <criterionKey>: number } }`. |
| `rubric` | list of criteria (1–20) | at run time | Each row: `key` (≤64), `label` (≤200), `weight` (0–1). At least one weight must be non-zero. |

The config schema is the single source of truth for the settings dialog and
the save boundary — see `src/nodes/people/candidate-score-rank/definition.ts`.

## Result

The named ranking is stored under `variableName` as:

```
{
  "ranking": [
    { "name": "Ada Boateng", "scores": { "skills": 9, "culture": 7 }, "totalScore": 8.6, "rank": 1 },
    { "name": "Kofi Mensah", "scores": { "skills": 7,  "culture": 8 }, "totalScore": 7.4, "rank": 2 }
  ],
  "rubric": [
    { "key": "skills",  "label": "Relevant skills",  "weight": 0.6 },
    { "key": "culture", "label": "Culture fit",      "weight": 0.4 }
  ]
}
```

The result is stored *under the `variableName` key itself*, so read it as
`{{ranking.ranking}}` for the ordered list and `{{ranking.rubric}}` for the
rubric used.

## Scoring

- `totalScore` is `Σ(rawScore × weight) / Σweight`, rounded to two decimals,
  so weights do **not** need to sum to 1 — they are normalized.
- Rows sort by `totalScore` descending; ties break by `name` ascending.
- `rank` is 1-based position in the sorted list.

## Rules

- `candidatesJson` must parse to an array of at most 1000 objects, each with a
  non-empty `name` and a `scores` object whose keys match the rubric.
- Compare with `{{json rank.ranking}}` when passing the ordered list into a
  downstream step.