# n8n — Implementation-Grade Research Notes

Study target: **n8n** (workflow automation / agent orchestration platform, open source, MIT-freemium).
Verification date: **2026-09**. Version line verified: **2.x** (release notes 2.23 → 2.34; latest GitHub release ~2026-09-05).

This is a **raw, dense research corpus** — notes, not a report. Every claim was either read from an
actually-fetched page or is explicitly tagged `[INFERRED]`. Use it to synthesize docs, compare platform
architecture, or derive requirements. Re-verify anything you quote, using the re-verification recipe below.

## How to re-verify (docs mechanics, learned the hard way)

- Append `.md` to any docs.n8n.io URL to get Markdown: `https://docs.n8n.io/<path>.md`. Index: `https://docs.n8n.io/llms.txt` (one line per page, URL + description). Also `sitemap.md` and `llms-full.txt`.
- Some pages are served differently via `.md` (occasionally truncated in one fetch — re-fetch or consult `<page>.md` subpages, e.g. `expression-reference/{array,item,string,...}.md`).
- Get the exact same page in the GitBook renderer at the non-`.md` URL; `?ask=<question>&goal=<end_goal>` only works on short valid pages.
- Landing page table of contents (`node-types.md` index) is not sufficient — individual node pages are the source of truth for node behavior.
- `node_modules`-level truth check for n8n internals: `github.com/n8n-io/n8n` (monorepo; `packages/nodes-base/nodes/*`, `packages/workflow`, `packages/core`).

---

## 1. Version rail & recent changes (2026)

- Current major line is **2.x** (there is no 3.x yet). Releases 2.23 through 2.34 all within 2026 (latest ~2026-09-05). n8n ships roughly weekly.
- Verified release-note highlights:
  - **2.34** — OIDC logout is opt-in (session management change).
  - **2.32** — MCP (Model Context Protocol) OAuth scope selection for servers.
  - **2.31** — Notion node overhaul (breaking changes for existing Notion nodes).
  - **2.29 / 2.30** — Microsoft Entra ID **Service Principal** authentication support (alongside OAuth2/API keys).
  - **2.27.4** — Google Ads API **v21** support.
  - **2.27** — Variables and **data tables** are insertable via the **+ Add table / + Add variable** menu in the code editor.
  - **2.26** — AWS **Assume Role** (cross-account) for the Bedrock provider (AI nodes, LangChain).
  - **2.25.1** — **Web search** for agents (agent/tool node tier, see §5/§7 flags).
- Geometric release cadence note `[INFERRED]`: features land in minor bumps; breaking changes to existing
  node configs are documented per release (e.g. Notion 2.31, and n8n packages serialization).

[SOURCES]
- https://docs.n8n.io/changelog/release-notes.md
- https://github.com/n8n-io/n8n/releases

---

## 2. Node taxonomy

- Node types are organized as **core nodes** (bundled, but split into trigger/action/…), **cluster nodes** (a root node + sub-nodes, e.g. Agent → sub-nodes for model/tools/memory), **credentials**, and **community nodes**. See `integrations/builtin/node-types.md`; the `node-types` index page is a category index, not a flat list of every node.
- **Trigger vs Action**: Triggers start a workflow (Webhook, Schedule, manual run, Error), Actions do work on data. Every node can be run manually; only triggers activate workflows automatically.
- Core node base folder: `integrations/builtin/core-nodes/`, files `n8n-nodes-base.<name>.md`. App nodes (SaaS): `integrations/builtin/app-nodes/`. `integrations/builtin/core-nodes.md` is an **empty index page** — do not rely on it.

### Verified behavior of the core nodes that matter for a workflow engine

- **If** — branch by conditions. Comparison is on the **data type** of the field (Number/Date/Time/String/Boolean/Array/Object/File/…), operators per type (Number: is/not/after/before/less/greater; String: contains/not contains/equal/not equal/starts with/ends with/matches/wildcard; Boolean: true/false; File: exists/not exists; Object/Array: contains/not contains key or value). AND/OR toggle governs all conditions combined. "Add condition" adds more rows.
- **Switch** — two modes: **Rules** (with *Routing Rules*, *Rename Output* for those rules, and *Fallback Output*: None | Extra Output) and **Expression** (programmatic output index). Sends each item to the *first matching* rule, or to the (optional) fallback output if no rule matches.
- **Merge** — two modes since the 0.194.0 overhaul: **Append** (with *Number of Inputs*; waits for all connected inputs) and **Combine** (with *Combine By* → *Matching Fields*, *All Fields*, *All Possible Combinations*, *SQL Query*). From **n8n 1.49.0**: Merge supports **3+ inputs** in Append, and *Combine By: SQL Query* mode (runs actual SQL over the streaming inputs; database-backed — unsupported in some old versions). Multiple inputs execute in the order they connect.
- **Split In Batches / Loop Over Items** — processes incoming items N-at-a-time. Saves the *original* input on the node; each iteration emits one item via the **loop** output; after the final iteration the **done** output is emitted so downstream nodes run once with the *original input*. Key params: *Batch Size*, *Option: Reset*. Classic use: rate-limit avoidance on external APIs, manual looping, "run once per input but batch the calls".
- **Aggregate** — two modes: **Individual Fields** (*Input field*, *Rename Field* → *Output Field Name*) and **All Item Data** (*Put Output in Field* on/off; *Include*: All Fields | Specified Fields | All Fields Except). For *Individual Fields* + Return (n8n behavior): aggregated values get delivered to the output in per-input order.
- **Code** — replaces **Function** and **Function Item** nodes (since **0.198.0**). Runs plain JavaScript (or, since 1.x, Python via task runners) against the item array; output shape varies by selected mode automatically wrapping with `json`. The code executes against **native Luxon**, not the n8n expression engine — entries tagged "Custom n8n functionality" (e.g. `DateTime.format()`) may not exist in Code node; use native JS/Luxon `toFormat()`. `DateTime.plus()` signature differs (n8n `(amount, unit)` vs Luxon `{days: 7}`). `$if()`, `$jmespath()` are **expression-editor-only**, not available in the Code node. (See §5 sandbox, §7 task runners.)
- **Set / Edit Fields (Set)** — *Manual Mapping* where each field is Fixed or an Expression (field-level `type: string|number|boolean|object|array|dateTime|time`), *JSON Output* (raw JSON object to set), plus toggles **Keep Only Set Fields** (default true) and **Include in Output**. The docs and pin-and-mock page now call it "**Edit Fields (Set)**".
- **Remove Duplicates** — *Remove Items Repeated Within Current Input* (by *Fields to Compare* or *Compare All Fields*, case sensitivity) and *Remove Items Processed in Previous Executions* (dedupes against previously-executed items; keyed by fields). Overhauled at **1.64.0**.
- **Execute Sub-workflow** — *Source*: **Database** (choose from a dropdown, `.../workflow/<id>` fragments accepted) | **Local File** | **Parameter JSON** | **URL**. For *Database* + *From list* the workflow's input fields auto-populate in the node editor; input items not copied to the sub-workflow receive `null` in their fields.
- **Execute Sub-workflow Trigger** — a trigger node placed at the start of a sub-workflow (pairs with Execute Sub-workflow).
- **Error Trigger** — the trigger that starts an **error workflow**; receives the failed workflow's error event. It is the first node of an error workflow; by default the *workflow itself uses itself* as error workflow. Can't be tested in manual runs — it only fires on **automatic** workflow failures. Error workflows don't need publishing (they're used by the instance, not directly triggered).
- **Wait** — states: *After Time Interval* (Wait Amount + Unit: Seconds/Minutes/Hours/Days) | *At Specified Time* (DateTime) | *On Webhook Call* | *On Form Submitted*; toggles *Resume* vs cancel. Pauses the execution; scheduling data is offloaded to DB/scheduler and the in-memory runner frees (see §5).
- **Stop And Error** — *Error Type*: **Error Message** (string) or **Error Object** (JSON). Stops the execution and marks it failed, feeding the Error Trigger/error workflow.
- **Manual Trigger**, **Schedule Trigger** (cron/interval/intervals), **Webhook** (see §5 quotas), **Customer Datastore** (fake test dataset for mocking), **Static Data**, **NoOp** `[INFERRED]` each have dedicated pages under `integrations/builtin/core-nodes/n8n-nodes-base.<name>.md`.
- **Debug Helper** (see §7) publishes **Saved Input / Saved Output / Set in Workflow / item count** etc. `[INFERRED detail]` — location confirmed, content not re-fetched.

[SOURCES]
- https://docs.n8n.io/integrations/builtin/node-types.md
- https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.if.md
- https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.switch.md
- https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.merge.md
- https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.splitinbatches.md
- https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.aggregate.md
- https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.code.md
- https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.set.md
- https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.removeduplicates.md
- https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow.md
- https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.errortrigger.md
- https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.stopanderror.md
- https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.wait.md
- https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.debughelper.md (path confirmed)

---

## 3. Node anatomy / SDK

### The base file (`*.node.ts`, one file per node)

- Standard top-level fields (RFC-style object/class in TS): `description` object with `displayName`, `name` (internal, `kebab-case`, matches filename; must be unique), `icon` (`file:logo.svg` or `{ "light": ..., "dark": ... }`; SVG recommended (icons render best), PNG 60x60 minimum), `group` (e.g. `['transform']`), and a `version` / `defaultVersion`. (Standard-parameters page verified.)
- Node **properties** are declarative UI schema: `{ displayName, name, type, typeOptions, default, required, description, options, ... }` where `type` ∈ `string | number | boolean | options | multiOptions | dateTime | time | stringCollection | stringFixedCollection | object | json | color | hidden | notice | ...`. `node-ui-elements.md` is the canonical reference (fixed collection vs collection; `loadOptionsMethod`; `displayOptions` show/hide; `validateType`; `typeOptions`).
- Versioning:
  - Add `version: [1, 2]` (number[] in node description) for a multi-version exported class.
  - Use `defaultVersion` to pick which the UI loads by default (programmatic style).
  - Inside parameters, conditions use `@version: [{ _cnd: { gte: 2 } }]` (or `lt/lte/gt`) to show fields only for certain versions; `@feature: 'v2'` gates a field behind `this.isNodeFeatureEnabled('v2')`.
  - At runtime, `this.getNode().typeVersion` (number) tells current behavior. UI shows a badge; upgrades applied per node are manual in the editor.
- Code standards (`code-standards.md`): TypeScript strict, `type` imports, no `any` where typed, config-merge patterns, property-name casing.

### Declarative style vs programmatic style (choose-a-node-building-style)

| | Declarative (JSON `routing`) | Programmatic (`execute()`) |
|---|---|---|
| Recommended | Most nodes w/ REST APIs (future-proof, less code) | Trigger nodes, non-REST (GraphQL, gRPC, use raw libs), nodes transforming data, full versioning |
| Response handling | `routing.output.postReceive` (`rootProperty`, `setKeyValue`) | manual `this.helpers.httpRequest` / `fetch` |
| Item linking | automatic (`pairedItem` set for you) | must set `pairedItem` manually (else wrong linking) |

- Declarative details: `routing.request` (url/method/qs/headers/body/ignoreHttpStatusErrors), `routing.output.postReceive[].type`: `rootProperty` (pick a field as the array) and `setKeyValue` (rename/map fields); dynamic option loading via `methods.loadOptions` + `loadOptionsMethod: 'getXyzOptions'`.
- Programmatic details: `defaultVersion`; `execute()` returns `INodeExecutionData[]` (`{ json, binary? }`) or `[{ json: { ... } }]` with `pairedItem` when applicable; `this.getNodeParameter(name, itemIndex, fallback, options)`; `this.helpers.httpRequestWithAuthentication`; trigger nodes use `this.helpers.createTrigger` returning an `off` cleanup; Node API versioning via `nodeTypeVersion` passed in the node description and `getNode().typeVersion`.
- `credentials-files.md` (`*.credentials.ts`): see §6.

### Item linking contract (for node authors — `item-linking-for-node-creators.md`)

- Every returned `{ json }` element may carry `pairedItem: { item: <index>, input: <inputNumber> }` (number-only shorthand also allowed when single input). Programmatic nodes **must** set it when item order ≠ input order; declarative nodes get it automatically.
- If a node filters/reorders, `pairedItem.index` of each output item must point to its source input item so upstream display and per-item data access work. Multiple output items may reference the same input item.

[SOURCES]
- https://docs.n8n.io/connect/create-nodes/plan-your-node/choose-a-node-building-style.md
- https://docs.n8n.io/connect/create-nodes/build-your-node/reference/base-files/structure.md
- https://docs.n8n.io/connect/create-nodes/build-your-node/reference/base-files/standard-parameters.md
- https://docs.n8n.io/connect/create-nodes/build-your-node/reference/base-files/declarative-style-parameters.md
- https://docs.n8n.io/connect/create-nodes/build-your-node/reference/base-files/programmatic-style-parameters.md
- https://docs.n8n.io/connect/create-nodes/build-your-node/reference/base-files/programmatic-style-execute-method.md
- https://docs.n8n.io/connect/create-nodes/build-your-node/reference/node-ui-elements.md
- https://docs.n8n.io/connect/create-nodes/build-your-node/reference/code-standards.md
- https://docs.n8n.io/build/work-with-data/reference-data/link-data-items/item-linking-for-node-creators.md

---

## 4. Expressions & items model

### Runtime data structure (understand-n8ns-data-structure)

- Every node exchanges an **array of items** `[{ "json": {...}, "binary": {...}? }, ...]`.
- Since **0.166.0**, Code (Function/Function Item) outputs automatically wrap in `{json}` and return an array; older behavior returned `{json, binary?, pairedItem?}` shape.
- Binary data rides alongside in the same object (`{"json":..., "binary": {"data": <base64>, "mimeType":...}}`), which is why **data pinning is blocked for binary outputs** (see §7).

### Item linking (how-items-link-through-workflows / reference-previous-nodes)

- `$json` → current item's `json` of the node actually executing (e.g. `$json.fieldName`, brackets with spaces/dots: `$json['field name']`).
- `$('<node-name>').item.json` → the item linked to the current item *at that node* (upstream data); `.item.binary`.
- `$input` methods: `$input.item`, `$input.first()`, `$input.last()`, `$input.all()`, `$input.all()[i].json`.
- `$('node')` chain methods: `$('nodes.Set').first()`, `.last()`, `.all()`, `.item`, `.context`.
- **Automatic linking rules**: single input → single output, each output item links back to the single input; single input → multiple outputs, all output items link to that input; multiple inputs → multiple outputs, auto-link when order is preserved; otherwise item linking is `[INFERRED]` handled by `pairedItem`.
- `$('<name>').item` between anything other than strict linear paths (e.g. cycled loops) can be `null`/not-linked.
- All the above is replicated by `pairedItem` in the engine; the editor visualizes links via the "NDV" (node detail view).

### Shortcuts & built-ins (use-built-in-shortcuts / expression-reference)

- Categories (`expression-reference.md` + subpages): `Array` `BinaryFile` `Boolean` `CustomData` `Date` `DateTime` `ExecData` `HTTPResponse` `Item` `NodeInputData` `NodeOutputData` `Number` `Object` `PrevNodeData` `Root` `String` `WorkflowData`.
- `Root` (`$`) — the `root.md` page is the entry point: `$node`, `$json`, `$workflow`, `$now`, `$today`, `$execution`, `$jmespath()`, `$if()`, `$getWorkflowStaticData`, `$prevNode` etc. `[INFERRED — root.md re-fetch truncated; individual variable pages carry the rows]`.
- `$workflow.*` (WorkflowData — verified): `$workflow.active` (bool), `$workflow.id` (string), `$workflow.name` (string). `[INFERRED]` `$workflow.staticData`, `$workflow.settings`, `$workflow.connections` exist per n8n source but weren't on the truncated fetch.
- `ExecData`: `$execution.id`, `$execution.mode`, `$execution.resumeUrl` (for Wait-on-webhook), and `$('node').context` / `$('node').scope` for node-local runtime data passed between executions. `[INFERRED detail]`.
- Method examples (verified rows via expression-reference grep):
  - `Array.find(callback)`, `Array.findIndex`, uses callback functions (not strings), returns `undefined` / `-1`; `Array.filter`, `Array.map`, `Array.removeDuplicates(keys?)`, `Array.renameKeys(from1,to1,from2,to2)`, `Array.first()/last()`, `Array.pluck('field')`, `Array.pluckAll('field')`.
  - `String.match(regexp)` (returns array of first match or all w/ `g` flag, `null` if none), `slice`, `toLowerCase`, `toNumber`, `urlEncode(allChars?)`, `hash`, `base64Encode/Decode`, `extractDomain`, `extractEmail`, `extractUrl`, `extractUrlPath`, `includes`, `indexOf`, `length`, `padStart/padEnd`, `prepend`, `replace`, `removeDuplicates`, `smartSplit`, `split`, `startsWith/endsWith`, `stripHtml`, `substring`, `trim`, `toUpperCase`.
  - `Object.urlEncode()`, `Object.removeKeysMatching(value)` (string-ish partial, case-sensitive; non-strings always removed), `Object.keys/values/entries` `[INFERRED]`.
  - `Number.*` — `toFixed(digits)`, `toFormat(...)` using Luxon? flag `[INFERRED]`; `Boolean.toNumber()`, `Boolean.toString()`.
  - `DateTime.format({format:'dd.MM.yyyy'})`, `DateTime.plus(...)` — as §2 note, these are **expression-native** conveniences layered over Luxon.
- Where the reference is truncated in one fetch, the **subpages** (`expression-reference/{array,binaryfile,boolean,customdata,date,datetime,execdata,httpresponse,item,nodeinputdata,nodeoutputdata,number,object,prevnodedata,root,string,workflowdata}.md`) are the full per-class reference and were used to fill category lists.

### Expression editor behaviors

- Expressions are entered in `=...` fields (`={{ 1+1 }}` `={{ $json.name }}`), can use JS operators, ternary, string templates, plus n8n methods & variables.
- **Expression editor is for expressions, Code node is for JS programs** — the two are separate surfaces.

[SOURCES]
- https://docs.n8n.io/build/work-with-data/understand-n8ns-data-structure.md
- https://docs.n8n.io/build/work-with-data/reference-data/reference-previous-nodes.md
- https://docs.n8n.io/build/work-with-data/reference-data/link-data-items/how-items-link-through-workflows.md
- https://docs.n8n.io/build/code-in-n8n/use-built-in-shortcuts.md
- https://docs.n8n.io/build/work-with-data/transform-data/expression-reference.md
- https://docs.n8n.io/build/work-with-data/transform-data/expression-reference/{array,boolean,string,object,workflowdata,nodeinputdata,nodeoutputdata,execdata}.md (subpage catalog)

---

## 5. Execution model internals

### Execution lifecycle

- An **execution = one run of a workflow**. Tracked by status (running/success/error/cancelled/waiting), persisted (configurable), and viewable in **Executions** pages (filter by workflow, dates, custom data). Understand executions supports manual → bulk replay `[INFERRED]`.
- **Types of executions**: *manual* (In editor, "Execute node"/"Execute workflow", reverts no data), *partial* (a single node run mid-workflow), *automatic* (trigger-based, production). Manual executions can run partial subgraphs by selecting a node.
- **Dirty nodes** (`understand-dirty-nodes`): after you edit a workflow, nodes whose upstream or params changed but which haven't re-run show a **yellow triangle / "dirty"**. Causes: inserting/deleting a node, changing a parameter, connecting a new connector, deactivating a node. Running "Execute workflow" re-runs all dirty nodes; dirty nodes' stale outputs are shown but flagged.

### Execution order (understand-execution-order + configure-workflow-settings)

- **v0** (workflows created before n8n 1.0, or explicitly set): n8n executes the **first node of each branch first**, then the second node of each branch, etc.
- **v1** (default for workflows created on 1.0+): executes **branch-by-branch**, ordering branches by **canvas position — topmost branch first, leftmost tiebreak**.
- Branch + If/Merge "special branch execution" for v0 workflows (≤0.236.0 behavior) was **removed in n8n 1.0 for v0 workflows**.
- You can override per workflow in **Workflow Settings → Execution order** (v1 | v0). (Verified.)

### Execution quotas (types-of-executions)

- Only **production (automatic) executions** consume quota. Rules (verified from executions docs):
  - **Schedule Trigger**: 1 execution per schedule fire, regardless of outcome (incl. failures/empty runs).
  - **Polling trigger** (e.g. Google Drive, Gmail, a "watch" node): 1 execution **only when new data is found**; poll cycles that find nothing cost 0.
  - **Webhook Trigger**: 1 per inbound request that activates the trigger (including a `{}` empty body); requests that fail validation before the workflow starts don't count.
- Quota counters decrement per execution; limits scale by plan tier. `[INFERRED — exact tier limits not captured]`.

### Queue mode / scaling (enable-queue-mode)

- **Queue mode** decouples the main process from execution workers:
  - Main handles **timers + webhooks**, **generates execution IDs**, pushes `start` events to **Redis**-backed Bull queue.
  - **Workers** pull jobs, **fetch the workflow definition from the database** (no config shipping needed), run nodes, write results + status back to the database, and post `finish` to Redis.
  - Redis notifies the main process for end-of-execution bookkeeping.
- **Binary data / files do NOT write to shared filesystem storage** on queue mode — use external (S3) storage. Workers can be scaled horizontally; main stays a scheduler+API.
- Log streaming warns explicitly about shared-volume event log corruptions in queue mode (see §7).

### Wait / resume (flow-logic/wait)

- Wait node pauses mid-execution; the in-flight execution is persisted (waiting + resume URL/data), the runner frees resources, and the workflow resumes on the awaited signal (time / webhook / form). Resume data (`$execution.resumeUrl`, Wait on webhook) is exposed to expressions after resume. `[INFERRED]` the resume mechanism stores partially-returned data in the DB row.

### Error handling (handle-errors-gracefully + configure-workflow-settings + errortrigger)

- Per workflow: **Workflow Settings → Error Workflow** = another workflow that runs when this one fails (must start with an **Error Trigger**).
- Error Trigger receives: original workflow name/id, failing node, error message/Traceback, execution id, timestamp. Error workflows are themselves reusable across many workflows.
- **Stop And Error** node intentionally fails an execution into the error workflow path (custom message or error object).
- Investigate failures: Executions page → Debug/copy, Load data from previous execution, log streaming (§7); Stream real-time responses (SSE) `[INFERRED flags — page exists but not re-fetched]`.

### Sandboxing & runner isolation (SECURITY-FLAG)

- n8n Code node historically did **NOT** use `vm2`; it used a custom sandbox. In 2025 the engine moved to **`isolated-vm`** (`IvmSandbox`) — see PR #32965 (`n8n-io/n8n`). `NODE_FUNCTION_ALLOW_BUILTIN` / `NODE_FUNCTION_ALLOW_EXTERNAL` env vars restrict which builtins/npm modules the Code node can import.
- SSRF guard: `isPrivateIp` blocking outbound HTTP to private ranges from **HTTP Request** and code — `[INFERRED]` IPv6 private-range gaps were flagged in the same PR authoring pass (treat IPv6 SSRF as partially hardening).
- **Task runners** (set-up-task-runners): generic mechanism to execute user JS/Python (used by Code node on 1.x). Components: *task runner* (executes code in an isolated process), *task broker* (connection hub), *task requester* (n8n asks for a task). Runner ↔ broker over a **WebSocket**. Two modes:
  - **Internal**: n8n spawns the runner process.
  - **External**: you run the runner yourself (recommended for production). Docs: task runners are **the isolation layer between (untrusted) user code and n8n**; internal mode means a workflow editor *could* read DB connection strings, the encryption key, stored credentials, and env vars from the n8n machine. External runners keep user code away from that surface. Harden: `deploy/host-n8n/configure-n8n/security/harden-task-runners.md`.

[SOURCES]
- https://docs.n8n.io/build/understand-workflows/understand-executions.md
- https://docs.n8n.io/build/understand-workflows/understand-executions/types-of-executions.md
- https://docs.n8n.io/build/understand-workflows/understand-executions/understand-dirty-nodes.md
- https://docs.n8n.io/build/flow-logic/understand-execution-order.md
- https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/enable-queue-mode.md
- https://docs.n8n.io/build/flow-logic/loop.md
- https://docs.n8n.io/build/flow-logic/wait.md
- https://docs.n8n.io/build/flow-logic/handle-errors-gracefully.md
- https://docs.n8n.io/deploy/host-n8n/configure-n8n/set-up-task-runners.md
- https://github.com/n8n-io/n8n/pull/32965 (snippet-level; re-verify before quoting)

---

## 6. Credentials

### End-user CX (create-and-edit-credentials)

- **Create** button: left side menu (upper-left) on computer, or **Overview / project page upper-right**; or create inline from a node's credential dropdown. Then choose scope:
  - **Personal space** (always in Community) or a **project** (paid tiers) — credentials are *owned* by that space and shared via project membership; listing is scoped (you see what you can use).
- Credential editors render per `properties` (`ICredentialType`) with **Test** button (`test` block).
- On **n8n Cloud**, AI model/service calls can use **Gateway credits** instead of your own API keys (`use-gateway-credits.md`).
- Credential types come from community packages AND built-ins; changing a credential re-tests affected nodes.
- Sharing: personal/space ACL; Community = personal only. No raw-secret read path for end users.

### Builder-side (credentials-files.md)

`*.credentials.ts` files implement `ICredentialType`:

```ts
export class GoogleApi implements ICredentialType {
  name = 'googleApi';                       // kebab; filename-agnostic unique key
  displayName = 'Google API';
  documentationUrl = 'https://...';
  icon = 'file:google.svg';
  properties: INodeProperties[] = [ /* standard fields; can reuse node-ui-elements */ ];

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: { headers: { Authorization: '={{$credentials.accessToken}}' } },
  };

  test: ICredentialTestRequest = {
    request: { baseURL: '={{$credentials?.domain}}', url: '/api/test' },
  };
}
```

- `authenticate` types: `IAuthenticateGeneric` (header/qs/body), `IAuthenticateBasic`, `IAuthenticateBearer`, plus `signature`/OAuth helpers. Auth expressions use `$credentials.<field>` (value from the credential properties).
- `test`: runs an HTTP request to verify validity; optional `rules: [{ type: 'hasKeys', properties: { keys: ['accessToken'] } }]`.
- n8n **encrypts stored credential data** (AES-GCM with `N8N_ENCRYPTION_KEY`); at runtime they're decrypted only server-side by the node request helper (`this.helpers.httpRequestWithAuthentication`). Never log/render them.
- Credential UI-scoping: `displayOptions` only show fields that apply (e.g. OAuth vs API-key flows).

### Audit & lifecycle events (from log-streaming taxonomy — §7)

- Credential events: created / shared / updated / deleted. Execution-data reveals: `Execution data revealed` / `Execution data reveal failed` (these are security-observable events).

[SOURCES]
- https://docs.n8n.io/build/understand-workflows/create-and-edit-credentials.md
- https://docs.n8n.io/connect/create-nodes/build-your-node/reference/credentials-files.md
- https://docs.n8n.io/integrations/builtin/credentials/httprequest.md
- https://docs.n8n.io/build/understand-workflows/use-gateway-credits.md

---

## 7. Testing, debugging, observability

### Data mocking & pinning (pin-and-mock-data) — dev only

- **Mocking** = synthesize input without external systems: Code node (any shape), **Edit Fields (Set)** node with Add Fields (small datasets), or **Customer Datastore** node (fake dataset to explore n8n).
- **Pinning** = save a node's output and reuse it on future executions instead of fetching fresh data. Only on nodes with a **single main output** (error outputs don't count). **Cannot pin data when output contains binary data.**
- Interaction: run node → **OUTPUT** view → **Pin data**; banner "This data is pinned"; **Unpin** link restores live fetch. **Edit pinned data**: OUTPUT → JSON → Edit → Save (saves + pins). Copy data from *past executions*: Executions → Open Past Execution → double-click node → copy JSON (Copy Item Path / Copy Parameter Path / Copy Value) → paste into target node → Save → pinned.
- Production executions ignore pinning (dev-only). Combine mocking → editing → pinning for deterministic edge-case tests.

### Debug execution data (debug-executions)

- **Executions** tab per workflow: failed runs show **Debug in editor** (loads props & data), successful runs show **Copy to editor**; either copies the execution's node data into the current workflow and **pins it into the first node** — so you can iterate without re-triggering the source system.
- Availability: n8n Cloud all plans; self-hosted Registered Community / Business / Enterprise. Need enough **execution data persistence** — depends on Workflow Settings (how much execution data to save; "Save successful production executions" etc.).

### Debug Helper node (n8n-nodes-base.debughelper)

- Helpers to print runtime values into your own saved output for inspection/pinning; ex. *Save input* default `'{{ $json }}'` with type options to echo the runner payload and node version. `[INFERRED detail — page path confirmed, not re-fetched]`.

### Log streaming & observability (stream-logs-to-external-systems / logs) — Enterprise

- **Settings → Log Streaming → Add new destination** (webhook | syslog | Sentry) → choose events. n8n **persists every event to a local event log file** before forwarding: default `<n8n-user-folder>/n8nEventLog.log` (+ `-worker` / `-webhook-processor` suffixes). **Warning**: shared writable volumes (NFS/EFS for queue-mode workers) can corrupt the file — set per-process `N8N_EVENTBUS_LOGWRITER_LOGFULLPATH` to a unique absolute `.log` path (no auto-suffix), and bound recovery with `N8N_EVENTBUS_LOGWRITER_MAXTOTALMESSAGESPERFILE`.
- **Event taxonomy** (verified, ready to re-use):
  - Workflow: Started / Success / Failed / Cancelled
  - Node executions: Started / Finished
  - Audit: ~50 events incl. user auth (login success/failed, signup, MFA on/off, reset, invite, email failed), credentials lifecycle, API-token created/deleted, executions deleted/revealed/reveal-failed, packages installed/updated/deleted, (portable) n8n-package import/export (+failures), workflow CRUD/archive/activate/publish, variables, external-secrets provider, instance settings and security toggles, token-exchange (embed) lifecycle, role mapping.
  - Worker: Started / Stopped; Queue: Job enqueued/dequeued/completed/failed/stalled; Runner: Task requested / Response received
  - AI-node logs: LLM generated / error, Tool called, Vector store searched/populated/updated, Memory operations, Retriever, Embeddings, Document processed, Text splitter split, Output parser parsed
- **Destinations** (env-managed since **2.19.0**): `N8N_LOG_STREAMING_MANAGED_BY_ENV=true` + `N8N_LOG_STREAMING_DESTINATIONS='[{...}]'` (locks UI read-only; reapplies each startup). Common fields: `type`, `label`, `enabled`, `subscribedEvents` (e.g. `n8n.audit`, `n8n.workflow`), `anonymizeAuditMessages`, `circuitBreaker` (`{maxFailures:5, failureWindow:60000}`). Webhook: `url, method, sendQuery/specifyQuery, sendHeaders/specifyHeaders, options{allowUnauthorizedCerts, queryParameterArrays, redirect{followRedirects,maxRedirects:21}, proxy{host:127.0.0.1,port:9000}, timeout:5000, socket{keepAlive:true,maxSockets:50}}`. Syslog: `host, port:514, protocol(udp|tcp|tls), tlsCa, facility (0–23), app_name` (RFC3164). Sentry: `dsn`.
- Related observability pages (paths confirmed): `set-up-logging.md`, `logs.md` (env vars), `use-environment-variables` ref, `view-executions-for-a-single-workflow.md`, `view-all-executions.md`, `customize-executions-data.md` (add custom fields to executions for filtered views), `stream-real-time-responses.md` (SSE).

[SOURCES]
- https://docs.n8n.io/build/work-with-data/pin-and-mock-data.md
- https://docs.n8n.io/build/understand-workflows/understand-executions/debug-executions.md
- https://docs.n8n.io/administer/observe-and-log/stream-logs-to-external-systems.md
- https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.debughelper.md
- https://docs.n8n.io/build/manage-workflows/configure-workflow-settings.md

---

## 8. Extensibility (building nodes & community packages)

### The `n8n-node` CLI tool (using-the-n8n-node-tool / building-community-nodes)

- Scaffold: `npm create @n8n/node@latest` OR global `npm install --global @n8n/node-cli` → `n8n-node` commands: `new` (interactive scaffold), `build`, `dev`/`start`. Check `n8n-node --version`.
- The scaffold includes: `src/nodes/<Name>/<Name>.node.ts`, `src/credentials/<Name>.credentials.ts`, `*.test.ts`, `package.json`, `jsconfig/tsconfig`, `.vscode/`, `eslint.config.mjs` **provided by `@n8n/node-cli` (do not hand-edit)**.
- Package shape per community rules (`building-community-nodes` + `submit-community-nodes`):
  - Name must start `n8n-nodes-` or `@<scope>/n8n-nodes-` (`n8n-nodes-weather`, `@weatherPlugins/n8n-nodes-weather`).
  - Must include keyword `n8n-community-node-package`.
  - `package.json` `n8n` attribute lists the node+credential files, e.g.:
    ```json
    "n8n": { "n8nNodesApiVersion": 1, "nodes": ["n8n-nodes-base.node.js ..."], "credentials": ["..."] }
    ```
- Lint & dev-check before publishing: `npm run lint`, `npm run dev` (local n8n loads the package).

### Reference impls to copy from

- n8n's own node library: `github.com/n8n-io/n8n/tree/master/packages/nodes-base/nodes/<Vendor>` (e.g. **Mattermost** = complex versioned programmatic node, use ZapsLike patterns; HTTP Request uses declarative `http.v1`/`v2` variants).
- Starter: `github.com/n8n-io/n8n-nodes-starter` (incl. `.github/workflows/publish.yml`).

### Editor integration points (for platform mirroring `[INFERRED where unverified]`)

- Nodes registered client-side via `src/nodes` registry equivalents in n8n are enumerated from the server's `nodeTypes` (types registry); community packages provide an in-canvas **nodes panel** group; colors/group drive the palette.
- Version badge, NDV (node detail view) = parameter form + INPUT/OUTPUT tabs with Run/pin/JSON-to-table. Dirty flag + execution data tied to `pairedItem` linking.

[SOURCES]
- https://docs.n8n.io/connect/create-nodes/build-your-node/using-the-n8n-node-tool.md
- https://docs.n8n.io/integrations/community-nodes/building-community-nodes.md
- https://docs.n8n.io/connect/create-nodes/test-your-node/node-linter.md
- https://docs.n8n.io/connect/create-nodes/deploy-your-node/submit-community-nodes.md
- https://github.com/n8n-io/n8n-nodes-starter
- https://github.com/n8n-io/n8n/tree/master/packages/nodes-base/nodes/Mattermost

---

## 9. Marketplace / community ecosystem

- Distribution = **npm registry**; discoverability = n8n UI nodes panel lists verified community nodes; install = Server settings → Community nodes (owner-only in self-hosted) `[INFERRED]`.
- **Verified nodes** = vetted by n8n through the **Creator Portal** (`https://creators.n8n.io/nodes`). Requirements:
  - Build with `n8n-node` tool scaffold (strongly suggested; automated checks run).
  - Follow technical guidelines `reference/verification-guidelines.md` (→ **no runtime dependencies** allowed for verified nodes) and UX guidelines `reference/ux-guidelines.md`; include a README.
  - After **May 1, 2026**: verification requires **publishing via GitHub Actions with npm provenance** (OIDC-signed; attest that a specific repo/commit built the package). Locally-published nodes won't be verified. Scaffold ships a ready `publish.yml`; existing repos add the one from n8n-nodes-starter; needs `@n8n/node-cli ≥ 0.23.0` devDep. npm **Trusted Publishers** (no long-lived tokens) or `NPM_TOKEN` secret.
  - n8n reserves the right to reject nodes competing with n8n's paid/enterprise features.
- **Cluster/root+sub-node** construction is part of the paid AI "agent" tier (Agent node with sub-nodes for LLM, Tools, Memory), and LangChain-based. Marketplace of *agent tools* exists in the product UI but isn't a public API contract `[INFERRED]`.
- Administrative hooks observed via audit events: personal publishing restricted (instance security toggle when self-host disallows community installs), package install/update/delete, n8n-package (portable workflow archive) import/export.

[SOURCES]
- https://docs.n8n.io/connect/create-nodes/deploy-your-node/submit-community-nodes.md
- https://docs.n8n.io/integrations/community-nodes/building-community-nodes.md
- https://docs.n8n.io/administer/observe-and-log/stream-logs-to-external-systems.md (event taxonomy)

---

## 10. Matrix node (data)

- Node: `integrations/builtin/app-nodes/n8n-nodes-base.matrix.md`; credentials: `integrations/builtin/credentials/matrix.md`.
- Operations (verified):
  - **Account** — Get current user's account information.
  - **Event** — Get a single event (in a room) by event ID.
  - **Media** — Send a media file to a chat room (mxc URI or upload).
  - **Message** — Send a message to a room; Get all messages from a room (with pagination params).
  - **Room** — New chat room (creation with settings incl. room name/topic, invite list, preset options), Invite a user, Join a new room, Kick a user, Leave a room.
  - **Room Member** — Get all members of a room.
- Auth: Matrix access token + homeserver URL (`credentials/matrix.md`). `[INFERRED]` matrix credentials = homeserver base URL + access token fields; test request hits `/_matrix/client/versions` or `/account/whoami` per generic Matrix homeserver API.

[SOURCES]
- https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.matrix.md
- https://docs.n8n.io/integrations/builtin/credentials/matrix.md

---

## Cross-cutting flags for the synthesis

1. **Breaking-change cadence**: Merge (0.194.0, 1.49.0), RemoveDuplicates (1.64.0), Set→"Edit Fields", Function nodes removed at 0.198.0, Execution-order v0→v1 at 1.0 — expect ongoing renames; don't hardcode surface names in any derived spec.
2. **Security posture**: external task runners in production; `isolated-vm` not `vm2`; SSRF IPv6 gaps flagged; dependency-free verified community nodes; no credential read path — mirrors the platform's own threat model (see `docs/architecture/security.md`).
3. **Data-flow semantics**: `{json, binary, pairedItem}` item model + branch/top-down execution order + auto vs manual item linking is the contract every node honors; keep it central in any design.
4. **Sources honesty**: the outline in §4 subpage rows (e.g. full per-class method lists) was reconstructed from the reference index + grep of the saved fetch; rows marked `[INFERRED]` need a subpage fetch before quoting.