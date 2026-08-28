# OpenAI-Compatible Chat node

Sends a chat completion to any provider that fronts OpenAI's
`/v1/chat/completions` contract — **OpenAI, Groq, Ollama, DeepSeek, Together,
or a local server (vLLM, LM Studio)** — and stores the reply in the run
context.

- **Type id** (persisted in `Node.type`): `OPENAI_COMPATIBLE_CHAT`
- **Category**: AI
- **Icon**: `Bot` (lucide)
- **Credential**: `openaiCompatible.apiKey` (`Bearer` token)
- Since: AF-M3-06

## Config reference

| Field | Type | Required | Description |
|---|---|---|---|
| `variableName` | string | at run time | Key the result is stored under in the run context. |
| `credentialId` | string | at run time | The OpenAI-compatible API-key credential to authenticate with. Resolved server-side; the token never reaches the client or the run trace. |
| `baseUrl` | string (≤2,048) | at run time | Base URL of the compatible API, e.g. `https://api.groq.com/openai/v1`. Supports `{{variables}}` and is checked by the egress guard before any request leaves the runner. |
| `model` | string (≤256) | at run time | Model id, e.g. `gpt-4o`, `llama-3.3-70b-versatile`, or `deepseek-chat`. |
| `systemPrompt` | string (≤100,000) | optional | Sets the tone or role of the model. Supports `{{variables}}`. |
| `userPrompt` | string (≤100,000) | at run time | The user message sent to the model. Supports `{{variables}}`. |

The config schema is the single source of truth for the settings dialog and
the save boundary — see `src/nodes/ai/compatible/definition.ts`.

## Result

The completion is stored under `variableName`:

```
{
  "id":              "chatcmpl-123",
  "model":           "llama-3.3-70b-versatile",
  "text":            "42",
  "usage": {
    "promptTokens":      11,
    "completionTokens":  2
  }
}
```

Reference the output downstream as `{{chatReply.text}}`,
`{{chatReply.model}}`, etc.

## Example

Summarize an HTTP response captured earlier in the workflow:

- `variableName`: `chatReply`
- `credentialId`: the `groq` OpenAI-compatible credential
- `baseUrl`: `https://api.groq.com/openai/v1`
- `model`: `llama-3.3-70b-versatile`
- `systemPrompt`: `You are a terse technical writer.`
- `userPrompt`: `Summarize: {{json httpResponse.data}}`

The downstream step can then read `{{chatReply.text}}` and pass it to the
next node.

## Rules

- The API key is read only inside the execute step and is never stored,
  logged, or traced (see `docs/architecture/security.md` §3).
- Variable name, credential, base URL, model, and prompt are required at run
  time; a missing field is a non-retriable config error, not a retry
  candidate.
- The rendered `baseUrl` must pass the egress guard's SSRF check
  (`assertSafeEndpoint`); a blocked endpoint fails the run before any request
  is issued.
- The outbound call is bounded at 30s; a network failure or timeout is
  retryable, while any non-2xx API status or a malformed response fails the
  run visibly.
- The system message is sent only when a `systemPrompt` is configured; the
  user message is always present.