# Filter, Dedupe, Wait, Extract Document Text

The four Phase A primitives added by M10. Grouped because the first two share a
rule that is easy to get wrong, and because reading them together is the only
way to see it.

---

## The rule the first two share: placement decides shape

`FILTER` and `DEDUPE` behave differently depending on where they sit, and the
node does **not** ask you which mode you want — it reads where it is.

| Placement | What it acts on | What "no" means |
|---|---|---|
| Inside a `SPLIT_OUT` → `AGGREGATE` segment | the current item | the item is **dropped**: the rest of the chain is skipped for it, and `AGGREGATE` does not collect it |
| Anywhere else | an array you point it at | the element is left out of the result |

Dropping an item is **not** a failure. It does not appear in `AGGREGATE`'s
`failed` list, it appears in `dropped`; the node's own trace row stays
`SUCCESS`, so the trace shows exactly where the item left. Dropping *every*
item produces `{ items: [], count: N, failed: [], dropped: [...] }` and the run
ends `SUCCESS` — filtering everything out is an answer, not an error.

**Expressions differ by placement, and this is the part people trip on.**
Inside a segment the engine puts `$item` in the template scope, so you write an
ordinary expression: `{{$item.status}}`. Outside a segment there is no such
scope — a template out there is compiled against the *node's* context, not
against each element — so you give a **dot-path** instead: `status`,
`customer.email`. The config panel labels them separately (`left` vs
`itemPath`, `key` for Dedupe) for that reason.

---

## `FILTER`

- **Type id**: `FILTER` · **Category**: TRANSFORM · Since AF-M10-10

| Field | Used | Description |
|---|---|---|
| `left` | in a segment | Template for the left-hand value, e.g. `{{$item.amount}}`. |
| `itemPath` | outside a segment | Dot-path into each element. Empty compares the element itself. |
| `operator` | always | `equals` `not_equals` `contains` `not_contains` `gt` `gte` `lt` `lte` `is_empty` `is_not_empty` `is_true` `is_false` |
| `right` | always | Template for the right-hand value. Ignored by the unary operators. |
| `valueType` | always | `string` (default) · `number` · `boolean` · `date` |
| `items` | outside a segment | Template resolving to a JSON array. |
| `variableName` | outside a segment | Where the result lands. |

### `valueType` is not optional thinking

`CONDITION` compares two rendered strings. That is right for routing on text
and wrong for filtering on data:

```
{{item.ok}}  where ok is the boolean false   →   renders as "false"
"false" is a non-empty string                →   "keep the ones where ok is true" keeps everything
```

Declaring `valueType: "boolean"` makes the comparison read the value as a
boolean and refuse anything that is not one. Same for numbers — `"9" > "10"` is
true as strings and false as numbers — and for dates.

The parse is **strict**, never coercing (the AF-M9-08 rule). A value that is
not the declared type fails the node, naming which side was wrong, rather than
comparing `NaN` and returning false for everything, which reads as "nothing
matched".

Two deliberate exceptions:

- **Ordering against an absent value is `false`, not an error.** "Keep rows
  whose amount is over 100" should skip a row with no amount, not fail the run
  on the first blank cell.
- **`contains` is always a string question**, whatever the declared type.
  "Does 12345 contain 234" is meaningless as arithmetic.

### Result (array mode)

```
{ "items": [...], "kept": 2, "removed": 1, "total": 3 }
```

`removed` is reported so a surprising result is visible: a filter that quietly
kept nothing looks identical to an empty upstream.

---

## `DEDUPE`

- **Type id**: `DEDUPE` · **Category**: TRANSFORM · Since AF-M10-10

Skips items this workflow has already handled, **remembering between runs**.

| Field | Description |
|---|---|
| `key` | What makes an item unique. A template (`{{$item.email}}`) in a segment; a dot-path (`email`) outside one. |
| `mode` | `forever` (default) remembers every key up to the ceiling; `window` remembers the most recent `windowSize`. |
| `windowSize` | Keys retained in `window` mode. Default 1,000. |
| `items` / `variableName` | Array mode only, as for `FILTER`. |

### Where the memory lives

In `TriggerState`, keyed by `(workflowId, nodeId)` — the same table and the
same window the polling framework uses (ADR-0024), because it is the same
question asked at a different point in the graph. Two `DEDUPE` nodes in one
workflow have separate windows; they are asking different questions.

**"Forever" has a stated ceiling of 10,000 keys.** `lastSeenIds` is read and
rewritten on every run, so an unbounded array is a row that grows until it is
too slow to load. Past the ceiling the oldest keys age out, which means a
repeat after 10,000 distinct keys will be treated as new. If that matters for
your data, key on something you can also check downstream.

### Two ways it refuses rather than guessing

- **An empty key fails the node.** An empty key makes every item collide with
  every other, which reads as "everything is a duplicate" and silently drops
  the whole batch. In array mode the error names how many items had no value
  at the path.
- **A run with no workflow or organization fails.** There is nowhere to keep
  the window, and silently deduplicating nothing is exactly the failure this
  node exists to prevent.

### Changing the key resets the window

The stored keys answer a question the node no longer asks, so changing `key`
or `mode` clears them — otherwise items the new key has never seen would be
suppressed, silently, and only the ones that happened to collide. The result
reports `windowReset: true` on the run where it happens, so "why did it
suddenly reprocess everything?" has an answer in the trace.

Changing something cosmetic (the node's name, an unrelated field) does **not**
reset it. Resetting on every edit would replay the backlog.

---

## `WAIT`

- **Type id**: `WAIT` · **Category**: LOGIC · Since AF-M10-08

| Field | Description |
|---|---|
| `mode` | `duration` (default) or `until`. |
| `seconds` | Seconds to wait in `duration` mode. |
| `until` | Template resolving to an ISO 8601 timestamp in `until` mode. |

Backed by Inngest's durable sleep — the worker is not held, and the run resumes
even if the worker that started it is long gone.

- **Maximum wait: 30 days**, enforced at **save** time for `duration` mode. A
  workflow that fails three days into a six-day wait has already burned three
  days and the author is not watching. `until` cannot be checked at save time
  (its target is computed at run time), so the executor carries the same
  ceiling and fails before sleeping.
- **A time already past resolves immediately.** Waking late is the honest
  outcome — the graph computed a time and the clock moved on — whereas failing
  the run would turn a slightly slow upstream node into an outage. The result
  carries `resolvedImmediately: true` so an `until` expression that is
  computing the past is visible.
- **The trace shows `WAITING`, not `RUNNING`.** A run legitimately parked for
  six days must not read as hung.
- **Cancellation works while parked.** The sleep is split into one-hour chunks
  with a cancellation check between them, so "cancel" on a parked run means
  cancel within the hour rather than cancel when it wakes.

### Result

```
{ "wait": { "mode": "until", "wakeAt": "2026-09-04T08:00:00.000Z", "resolvedImmediately": false } }
```

---

## `EXTRACT_DOCUMENT_TEXT`

- **Type id**: `EXTRACT_DOCUMENT_TEXT` · **Category**: DATA · Since AF-M10-11

Reads the text out of a file and passes it downstream. Takes a `FileRef` — the
thing `FILE_DOWNLOAD` and the Drive nodes produce — or a bare file id.

| Field | Description |
|---|---|
| `file` | Template resolving to a `FileRef` (`{{{json download.file}}}`) or a file id. |
| `maxCharacters` | Cap on the returned text. Default 200,000. |
| `variableName` | Where the result lands. |

Supported: **PDF, DOCX, HTML, plain text, Markdown, CSV, JSON.** Anything else
fails, naming the type — the underlying extractor decodes unknown types as
UTF-8, which would "succeed" on a PNG with a page of binary garbage and the
user would find out from the model's answer.

A PDF that cannot be parsed **fails**. It used to fall back to decoding the
bytes as text, which turns a corrupt or password-protected file into mojibake
that then gets summarised, indexed and answered from.

### Result

```
{
  "text": "...",
  "pageCount": 12,        // null for formats with no pages — never a fabricated 1
  "truncated": false,     // reported, never silently applied
  "characterCount": 48213,
  "filename": "contract.pdf",
  "mimeType": "application/pdf",
  "format": "PDF"
}
```

**`truncated` matters.** A contract analysed from its first half produces a
confident, wrong answer. Pass it into your prompt (`Truncated:
{{extracted.truncated}}`) so the model can say so.

Use `{{{json download.file}}}` — three braces — when passing a `FileRef`. Two
braces renders it as `[object Object]`, and the node names that mistake
specifically, because it looks like an id.
