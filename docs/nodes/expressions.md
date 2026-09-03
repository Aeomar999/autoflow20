# Expressions: from n8n to AutoFlow (AF-M9-07)

Node config strings are Handlebars templates compiled at run time through
`src/features/executions/template.ts` (see ADR-0007). This page is the porting
map for expressions you bring over from n8n, plus the one sanctioned way to
emit raw JSON.

## The mapping

| n8n | AutoFlow | Notes |
|---|---|---|
| `{{$json.body.x}}` | `{{webhook.body.x}}` | The incoming webhook payload lives under the `webhook` root, not a flat `body` root. A bare `{{body.x}}`/`{{$json.body.x}}` is an **unknown-root warning** at save time. |
| `{{$json.x}}` | `{{x}}` | The accumulated context is flat; a bare top-level key resolves directly. |
| `{{$node["N"].json.x}}` | `{{$node.N.x}}` | Bracket-quoted names become dot paths: `{{$node.[N].x}}` also works. Keyed by the node's canvas display name. |
| `{{ a \|\| b }}` | `{{default a b}}` | Loose fallback: `a` when present and non-empty, else `b`. |
| `{{ a?.b }}` | `{{get a "b"}}` | Safe path access; missing resolves to `""`. |
| `{{ n/100 }}` | `{{div n 100}}` | Arithmetic is helper-based: `add`/`sub`/`mul`/`div`. |
| `{{ a > b }}` | `{{gt a b}}` | Comparisons: `eq`/`ne`/`gt`/`gte`/`lt`/`lte`. |
| `{{ a && b }}` | `{{and a b}}` | Logic: `and`/`or`/`not`. |
| `{{ a.length }}` | `{{len a}}` | Array/string length, or object key count. |
| `{{ a.toUpperCase() }}` | `{{upper a}}` | Also `lower`. |
| `{{ $now }}` | `{{formatDate $now "yyyy-MM-dd HH:mm:ss"}}` | date-fns pattern; also accepts an ISO string, a `Date`, or epoch ms/s. |
| `{{ $json }}` | `{{{json $json}}}` | See the escaping rule below. |

## Always-present context keys

`$json` (alias of the flat bag), `$node.<Name>`, `$execution.id`,
`$workflow.id`, and `$now` exist in every context regardless of the graph
(ADR-0007, AF-M2-03). The webhook trigger adds `webhook` (and `query`,
`headers`, `params`, `method` under it); the manual trigger adds `trigger`.

## Emitting unescaped JSON

Handlebars HTML-escapes output by default, so `{{json obj}}` mangles quotes and
commas into `&quot;`/`&#x2F;`. The **only** supported way to emit raw,
unescaped JSON is the triple-stache + `json` helper:

```
{{{json $json}}}
```

Always use `{{{json …}}}` when the template feeds a JSON body (e.g. the HTTP
request node's `body`, or `webhook-out`'s `body` — see
`docs/nodes/webhook-out.md`). Every JSON-body node re-validates the compiled
result as JSON before it is sent, so a malformed template is a config error,
not a silent body substitution.

## Unknown roots fail loudly

At save time the graph validator (`checkTemplateRoots` in
`src/engine/validate.ts`) infers every root your workflow can produce and
warns on any root a config template references that the workflow cannot.
Porting a stale n8n expression like `{{$json.body}}` or `{{items.length}}`
therefore surfaces a warning in the editor instead of silently rendering `""`
at run time. To fix, re-map it per the table above.

Full helper reference and failure behavior: `EXPRESSION_HELPERS` +
`getTemplateRoots` in `src/features/executions/template.ts`; implementation and
rationale in ADR-0007.
