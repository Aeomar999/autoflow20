# Summarize Illness node

Condenses an employee's **illness and sick-leave notes** into a concise factual
briefing and stores the result in the run context. Part of the leave flow (W3).

This node **composes the existing `ai/llm` node** (`src/nodes/ai/llm/`) — it
adds no model plumbing of its own. The notes you provide in `userPrompt` are
sent to the model followed by a fixed system prompt. It runs with `jsonMode`
off and returns plain text.

- **Type id** (persisted in `Node.type`): `ILLNESS_SUMMARY`
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
| `userPrompt` | string (template, ≤100k) | at run time | The employee's illness / sick-leave notes. Handlebars supported. |
| `model` | string (`provider:model`) | optional | Model to serve. Defaults to the run's default model. |
| `fallbackModels` | string (≤500) | optional | Additional `provider:model` ids to try when the primary fails. |
| `openaiCredentialId` / `anthropicCredentialId` / `geminiCredentialId` | string (cuid) | optional | Explicit credential override for the provider key. |
| `temperature` | number (0–2) | optional | Sampling temperature. Defaults to `0.7`. |
| `maxTokens` | number (1–16 384) | optional | Upper bound on output tokens. |
| `cacheTtlSeconds` | number | optional | When set, identical calls within the TTL reuse the cached result (zero tokens cost). |

The config schema is the single source of truth for the settings dialog and
the save boundary — see `src/nodes/people/illness-summary/definition.ts`.

## Result

The briefing is stored under `variableName` as:

```
{
  "text": "The employee reported flu-like symptoms starting 2026-09-02. They expect to be out for 5 working days and have asked to work from the office return-to-work plan…",
  "model": "openai:gpt-4o"
}
```

- `text` is the model's briefing (stated condition, reported symptoms, expected
  duration, accommodations / return-to-work notes).
- `model` is the model that actually served the request, after any fallback —
  so you can see which provider produced the result.

## Example

Summarize the notes passed from a sick-leave record:

- `variableName`: `briefing`
- `userPrompt`: `{{leave.notes}}`
- `model`: `openai:gpt-4o`

Read the briefing as `{{briefing.text}}`.

## Rules

- `userPrompt` is required at run time and must resolve to a non-empty value.
- The fixed system prompt instructs the model to stay factual and **not invent
  details**; edit its wording in `execute.ts` if the briefing shape must
  change.
- Output is plain text — do not expect structured JSON out of this node.
- Model responses and token usage land on the run's usage account, exactly as
  a native `ai/llm` step would.