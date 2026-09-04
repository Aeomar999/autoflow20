# Media generation

Four nodes for generating images and video (AF-M10-23), plus OpenRouter,
which needed no node at all.

| Node | Credential | Priced |
|---|---|---|
| `OPENAI_IMAGE` | `openai.apiKey` | per image |
| `POLLINATIONS_IMAGE` | **none** | free |
| `VEO_GENERATE` | `google.oauth2` | per second of output |
| `CREATOMATE_RENDER` | `creatomate.apiKey` | per second of output |

Every one stores its result as a run file, so a Drive upload, a LinkedIn post,
a YouTube upload or an email attachment can take it directly.

---

## OpenRouter is not a node

The acceptance asked for it "through the existing `AI_COMPATIBLE` path rather
than as a new provider — reuse, don't duplicate", and that is exactly right:
OpenRouter speaks OpenAI's Chat Completions shape, so a second implementation
would be a copy that drifts.

So use **`OPENAI_COMPATIBLE_CHAT`**:

- `baseUrl` → `https://openrouter.ai/api/v1`
- `model` → an OpenRouter model id, e.g. `meta-llama/llama-3.3-70b-instruct`
- credential → an OpenRouter key **or** a generic OpenAI-compatible key; the
  requirement accepts either, because an OpenRouter key *is* an
  OpenAI-compatible key and making users re-enter it under a second type would
  be paperwork rather than a distinction.

---

## Cost lands in the same pipeline as tokens

Image and video generation is priced **per unit**, not per token, so it cannot
live in `AiModelDef` — `inputCostPer1M` has no meaning for a model that charges
four cents an image. It lives in the same file all the same, as
`aiMediaModels`, because the cost pipeline is the same one: each node returns
`__usage.costUsd`, the engine writes it to `NodeExecution.costUsd`, and a
workflow that renders a video and then summarises it shows **one** bill rather
than two systems' worth.

Two deliberate choices:

- **A free provider records zero, not nothing.** A cost report should say a step
  was free rather than be silent about it.
- **An unpriced model costs 0 rather than throwing.** A missing price is a
  reporting gap; refusing to run would be a worse one.

Prices are published list prices at the time of writing and will drift. This is
an estimate surfaced in the trace and the editor, not a billing record.

---

## Long-running renders

Veo and Creatomate are both submit-then-poll jobs that routinely run for
minutes, and both meter by output. `src/features/media/server/job-poller.ts`
is the shared wait — the same shape `APIFY_RUN` needed, so it exists once
rather than twice more.

**Each poll and each sleep is its own durable step.** A wait parked inside one
long `step.run` cannot notice it was cancelled until that step returns, so
"cancel" on a ten-minute render would mean "cancel in ten minutes". It also
frees the worker and survives a redeploy.

**Progress reaches the trace.** The node is marked `WAITING` while parked, so a
ten-minute render does not read as a hung node — the same treatment `WAIT`
gets, for the same reason.

**The loop is bounded by a count computed up front**, not only by the clock: an
exit that depends on wall-clock progress spins forever if a sleep ever returns
early — on a replay, a clock adjustment, or under a test double.

**Every path that stops waiting asks the provider to stop.** A job nobody will
read still finishes and still bills.

Both nodes submit in their own step, so a retry of the *wait* cannot start a
second render.

---

## Provider specifics

### OpenAI

Both models are asked for **base64** rather than a URL. `dall-e-3` returns a URL
by default and that URL expires within the hour, so taking bytes means one code
path and no second request against a dead link.

`dall-e-3` **rewrites prompts**, and the node reports `revisedPrompt` — the
difference between "the image is wrong" and "the model changed the brief".

A **content-filter refusal is permanent**. Retrying sends the same prompt to the
same filter and pays again to be told no again, so it fails rather than
retrying.

### Pollinations

Keyless and free, which is what makes it the one media node a credential-free
template can use. The trade is that there is no envelope to check: under load
it answers **200 with an HTML error page**, and storing that would produce a
successful-looking run whose output is a corrupt file — discovered later, when
a downstream upload fails. The node checks the content type and retries.

Setting a `seed` makes a prompt reproduce the same image.

### Veo (Vertex AI)

Vertex is addressed **per project and per region** — there is no global
endpoint, and neither is inferable from the token, so the credential must carry
a project id.

A finished operation can still be a **failed** one: `done: true` with an `error`
is how Vertex reports a refused or crashed generation, and treating `done` as
success would hand an empty result downstream.

The node reads **inline bytes**. A request configured to write to a Cloud
Storage bucket is not supported, and the node says so rather than
null-pointering.

### Creatomate

The submit endpoint answers with an **array** of renders — one per output format
the template defines — so reading it as an object gives `undefined`.

`succeeded` and `failed` are **both terminal**, and only one is success; polling
for "not rendering" would call a failure done.

Modification keys must match the template's element names **exactly**, which is
what its 400 means.

The output URL is a CDN link tied to the render, so the node **stores the file**
rather than passing the URL on to something that will find it dead.

---

## Related

- [X, LinkedIn, YouTube and Upload-Post](social-publishing.md) — where the
  generated media usually goes
- [Apify, Apollo and Google Search/Maps](data-acquisition.md)
