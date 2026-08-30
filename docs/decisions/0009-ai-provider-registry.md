# ADR-0009: AI provider registry with capability + pricing data

**Status:** Accepted
**Date:** 2026-08-30
**Deciders:** Engineering
**Related:** ADR-0008 (credential model + registry + API), AF-M5-01, overview.md §5.4

## Context

AF-M5-01 is the data layer of the multi-model AI milestone (M5). Before any
`ai.llm` runner, cost capture, or editor estimate exists, the product needs a
single source of truth for: which model providers exist, what credential
registers each, what each model can do (capabilities), how big its context
window is, and what one million tokens costs per provider. Today that
knowledge is scattered — three hardcoded AI executor nodes with inline
decisions, no pricing data, no capability metadata, and no Ollama/Groq/
DeepSeek story beyond an OpenAI-compatible node preset.

Requirements for this ADR:

1. All model metadata is **data, not code**: adding a model or adjusting a
   price is a one-line change plus any capability edits, never a rewrite.
2. Mirrors the node registry and credential registry patterns: isomorphic,
   validated at module load, deriving everything from one definition list.
3. Providers reachable through existing adapters only. Groq, DeepSeek, and
   Ollama speak OpenAI's protocol (`/chat/completions`), so they are keyed to
   the existing OpenAI-compatible path — no new SDK or adapter.
4. Per-1M USD pricing is present in the registry so the editor (AF-M5-06)
   and the engine (AF-M5-05) derive estimates/capture from the same data.
5. Credential lockstep: every keyed provider's `credentialType` must exist in
   the credential registry (ADR-0008), or module load fails.

## Decision

`src/lib/ai/registry.ts` (isomorphic + pure) is introduced. It exports:

- **`AI_ADAPTERS`** = `["openai", "anthropic", "google"]` — the three native
  SDK adapters the app actually has. Composing providers (Groq, DeepSeek,
  Ollama) reuse the `openai` adapter over their own base URLs.
- **`aiProviderDefs`** — six providers:
  OpenAI (`openai.apiKey`), Anthropic (`anthropic.apiKey`), Google Gemini
  (`gemini.apiKey`), Groq (`groq.apiKey`, base `https://api.groq.com/openai/v1`),
  DeepSeek (`deepseek.apiKey`, base `https://api.deepseek.com`), and Ollama
  (keyless, base `http://localhost:11434/v1`).
- **`aiModelDefs`** — twelve models, each with `adapter`, `contextWindow`,
  `capabilities`, and `inputCostPer1M` / `outputCostPer1M`. Costs are static
  USD-per-1M-token tables as of 2026-08-30 (e.g. gpt-4o-mini \$0.15/\$0.60,
  claude-3-5-sonnet \$3/\$15, gemini-1.5-flash \$0.075/\$0.30,
  llama-3.3-70b-versatile \$0.59/\$0.79, deepseek-chat \$0.27/\$1.10; Ollama
  models are \$0). Keyed `provider:model`, never by bare name.
- **`resolveAiModel(provider, model?)`** — exact `provider:model` wins, else
  the provider's registered `defaultModel`, else `UnknownAiModelError`.
- **`estimateRunCostUsd(modelId, usage)`** — pre-run cost ceiling from the
  pricing data, rounded to micro-dollar precision.
- **`validateAiRegistry()`** runs at module load and fails the build on: dup
  provider/model ids, provider/credential drift (keyed provider referencing an
  unregistered credential type), unknown adapters, invalid context windows or
  negative prices, empty capabilities, unknown capabilities, and default
  models that are not registered. **A bad entry can never silently reach a
  runner.**

### Deviation from overview.md §5.4

`resolveAiModel` drops the spec's "first provider's default" fallback leg.
With every provider's default guaranteed registered by `validateAiRegistry`,
that leg could only fire for an **unregistered** provider — and silently
resolving it to another provider's model would be a silent wrong path for the
runner. It throws instead. `overview.md §5.4` remains the spec for the
fallback chain (AF-M5-04) and run-time selection ordering; this is the
resolution function's contract.

### Credential lockstep (ADR-0008 extension)

`groq.apiKey` and `deepseek.apiKey` are added to the credential registry in
the same change: `credential-types.ts` defs, the write and update variants in
`write-schema.ts`, and server-side connection testers (`GET /models` on each
base URL, `isTestable: true`). The existing registry-parity and
field-key-equality tests auto-cover the new types, so a future def that omits
a variant fails tests, not production.

## Consequences

**Buys us**
- One line changes a price; one def adds a model; the cost estimator, runner
  (M5-02+), and editor estimate (M5-06) all read the same tables.
- Model identity is unambiguous (`provider:model`), which is a precondition
  for AF-M5-04 (the trace records which model actually served).
- Keyed providers are provably tied to existing credential types; keyless
  Ollama needs no credential at all.

**Costs**
- Static pricing tables go stale as vendors price-shift; a refresh task is
  required (acceptable at this stage — pricing is a product input, and the
  structure makes it cheap to update).
- Groq/DeepSeek/Ollama funnel through the OpenAI-compatible adapter, so any
  model whose vendor supports an OpenAI-incompatible capability (e.g. native
  tool-calling differences) is not individually expressible until a new
  adapter exists.

## Alternatives considered

- **Add an SDK per provider** (e.g. `@groq/sdk`, `@deepseek/sdk`). Rejected:
  dependency bloat for the same REST protocol; the AI SDK compatibility layer
  already exists and the existing OpenAI-compatible node works.
- **Inline the metadata in each executor node**. Rejected: defeats this ADR's
  purpose — capability/pricing would live beside three (soon four) different
  executors with no single source of truth, and cost capture (M5-05) would
  have nowhere non-duplicated to read from.
- **Allow any `provider:model` string at runtime and look it up lazily.**
  Rejected: typos and unregistered models would fail mid-run instead of at
  build time; `validateAiRegistry` exists specifically to prevent that.