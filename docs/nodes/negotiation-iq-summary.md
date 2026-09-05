# Summarize Negotiation & Candidate Fit node

Summarizes a candidate's **compensation expectations and leverage** into a
concise factual briefing and stores the result in the run context. Part of the
acquisition flow (W1), used before the offer letter is drafted.

This node **composes the existing `ai/llm` node** (`src/nodes/ai/llm/`) — it
adds no model plumbing of its own. The notes you provide in `userPrompt` are
sent to the model followed by a fixed system prompt. It runs with `jsonMode`
off and returns plain text.

- **Type id** (persisted in `Node.type`): `NEGOTIATION_IQ_SUMMARY`
- **Category**: AI
- **Icon**: `Sparkles` (lucide)
- **Credentials**: `openai.apiKey`, `anthropic.apiKey`, or `gemini.apiKey`
  (each optional — at least one resolvable credential is needed, or the
  delegate fails when the chosen model requires an API key)
- Since: AF-M11-03

## Config reference

| Field | Type | Required | Description |
|---|---|---|---|
| `variableName` | string | at run time | Key the result is stored under in the run context. |
| `userPrompt` | string (template, ≤100k) | at run time | The candidate's notes (expectations, priorities, constraints). Handlebars supported. |
| `model` | string (`provider:model`) | optional | Model to serve. Defaults to the run's default model. |
| `fallbackModels` | string (≤500) | optional | Additional `provider:model` ids to try when the primary fails. |
| `openaiCredentialId` / `anthropicCredentialId` / `geminiCredentialId` | string (cuid) | optional | Explicit credential override for the provider key. |
| `temperature` | number (0–2) | optional | Sampling temperature. Defaults to `0.7`. |
| `maxTokens` | number (1–16 384) | optional | Upper bound on output tokens. |
| `cacheTtlSeconds` | number | optional | When set, identical calls within the TTL reuse the cached result (zero tokens cost). |

The config schema is the single source of truth for the settings dialog and
the save boundary — see `src/nodes/people/negotiation-iq-summary/definition.ts`.

## Result

The briefing is stored under `variableName` as:

```
{
  "text": "The candidate is targeting £150k base. They value remote work and a clear career path; they would flex on bonus percentage if those hold. Expected competing offer at £160k…",
  "model": "anthropic:claude-sonnet"
}
```

- `text` is the model's briefing (compensation expectations, willingness to
  flex on non-compensation priorities, leverage points, deal-breakers).
- `model` is the model that actually served the request, after any fallback.

## Example

Summarize notes captured during screening before drafting the offer:

- `variableName`: `negotiq`
- `userPrompt`: `{{screen.notes}}`
- `model`: `anthropic:claude-sonnet`

Read the briefing as `{{negotiq.text}}`.

## Rules

- `userPrompt` is required at run time and must resolve to a non-empty value.
- The fixed system prompt instructs the model to stay factual and **not invent
  details**; edit its wording in `execute.ts` if the briefing shape must
  change.
- Output is plain text — do not expect structured JSON out of this node.
- Model responses and token usage land on the run's usage account, exactly as
  a native `ai/llm` step would.