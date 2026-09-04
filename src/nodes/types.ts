import type { Realtime } from "@inngest/realtime";
import type { GetStepTools, Inngest } from "inngest";
import type { z } from "zod";
import type { CredentialSecret } from "@/features/credentials/server/vault";

/**
 * Node SDK types (AF-M1-01) — the contract for everything on the canvas.
 * Spec: docs/architecture/node_sdk.md.
 *
 * Environment split: `definition.ts` files are isomorphic (safe in the browser
 * bundle); `execute.ts` files are server-only. `manifest.ts` imports only
 * definitions; `registry.ts` imports full registrations. The bundler therefore
 * cannot pull an implementation into the client regardless of accidental
 * imports.
 */

export type NodeCategory =
  | "TRIGGER"
  | "ACTION"
  | "LOGIC"
  | "AI"
  | "DATA"
  | "TRANSFORM";

export interface PortDef {
  /** Stable id used as the React Flow handle id and Connection.fromOutput/toInput */
  id: string;
  label: string;
  /** A run fails validation if a required input port has no incoming connection */
  required?: boolean;
  description?: string;
}

export interface CredentialRequirement {
  /** Key in the node's resolved credential map */
  key: string;
  /** Credential type id from the credential registry (M3), e.g. "openai.api-key" */
  type: string;
  required: boolean;
  /**
   * OAuth scopes this node needs beyond merely holding a credential
   * (AF-M10-17).
   *
   * Declared per node rather than per credential type because one connection
   * serves several operations at different privilege levels: posting a Slack
   * message needs `chat:write`, creating a channel needs `channels:manage`,
   * and looking a person up by email needs `users:read.email` — a grant an
   * admin may well decline while allowing the other two.
   *
   * Surfaced in the config panel so a missing grant is visible before the run,
   * and passed to the executor so the provider's own code (`missing_scope`,
   * which is all Slack returns) becomes a sentence naming what to add.
   */
  scopes?: readonly string[];
}

export interface RetryPolicy {
  /** 1 = no retry */
  maxAttempts: number;
  /** Base for exponential backoff */
  backoffMs: number;
}

export interface NodeDefinition<TConfig = unknown> {
  /**
   * Stable, permanent, persisted in Node.type. Never rename — saved workflows
   * break. Plain string (enum dropped in AF-M1-02).
   */
  type: string;
  /** Bump when configSchema changes incompatibly; requires a migrate fn. */
  version: number;
  category: NodeCategory;
  label: string;
  description: string;
  /** lucide-react icon name (resolved by the palette/config panel). */
  icon: string;
  /**
   * (AF-M10-35) Path to a brand mark under `public/`, e.g.
   * `/logos/telegram.svg`. Mirrors `CredentialTypeDef.logo`. The palette,
   * canvas node and config panel render it in place of `icon`; `icon` stays
   * required and is the fallback for a node with no mark of its own, so a
   * broken or absent logo degrades to a glyph rather than an empty box.
   *
   * `registry.test.ts` asserts every path here resolves to a file on disk.
   */
  logo?: string;
  /** Palette search terms. */
  keywords?: string[];
  /** Zod schema — single source of truth for config. Drives form AND validation. */
  configSchema: z.ZodType<TConfig>;
  /** Must satisfy configSchema.parse(). */
  defaults: TConfig;
  /** [] for triggers. A config-dependent input set is resolved via `resolveInputs`. */
  inputs: PortDef[];
  /**
   * (AF-M9-11) Resolve this node's input ports from its config. Optional — when
   * absent, call sites use the static `inputs` array. Mirror of
   * `resolveOutputs` for nodes whose input ports are config-dependent (e.g.
   * MERGE v2, whose `input-0…input-n` count is set by `inputCount`). Must be
   * deterministic and side-effect free so the editor can call it on every
   * keystroke and the engine on every compile.
   */
  resolveInputs?: (config: TConfig) => PortDef[];
  /**
   * Static output ports (AF-M9-09). `[]` for triggers.
   *
   * A node with config-dependent outputs (e.g. SWITCH, whose ports are its
   * `rules[].outputKey`s, and fan-out nodes like SPLIT_OUT) MUST instead
   * implement `resolveOutputs(config)`; when it is present the engine, editor
   * and validator resolve ports through `resolveOutputs` and this static
   * `outputs` array is ignored.
   */
  outputs: PortDef[];
  /**
   * (AF-M9-09) Resolve this node's output ports from its config. Optional —
   * when absent, call sites use the static `outputs` array. Must be
   * deterministic and side-effect free so the editor can call it on every
   * keystroke and the engine on every compile.
   */
  resolveOutputs?: (config: TConfig) => PortDef[];
  credentials?: CredentialRequirement[];
  /**
   * True when this type honours a `cacheTtlSeconds` config field against the
   * workspace AI response cache (AF-M5-07). Declared here so reporting and the
   * editor can find cacheable types through the registry instead of
   * hard-coding a list of node ids.
   */
  supportsResponseCache?: boolean;
  defaultRetry?: RetryPolicy;
  /** Wall-clock cap for one attempt (enforced by the runner, M2). */
  timeoutMs?: number;
  /** Migrate a saved config from an older typeVersion (runs on load/compile). */
  migrate?: (config: unknown, fromVersion: number) => TConfig;
  /** Docs link rendered in the config panel. */
  docsUrl?: string;
  /**
   * A requirement of the PROVIDER ACCOUNT that no scope or credential can
   * satisfy (AF-M10-22).
   *
   * X's v2 write endpoints are not on the free tier; YouTube uploads need a
   * quota increase for an unverified project; LinkedIn's UGC posting needs the
   * app to be approved for a product. None of those are things a user can fix
   * by reconnecting, and every one of them surfaces as a 403 at run time that
   * looks like a permissions bug.
   *
   * Rendered in the config panel so it is read while the node is being
   * configured rather than discovered from a failed run.
   */
  accountRequirement?: string;
  /**
   * Retirement marker (AF-M5-09). A deprecated type stays registered and
   * executable — saved workflows and published versions must keep running —
   * but disappears from the palette, so no NEW instance can be created, and
   * the config panel tells the user what replaced it.
   *
   * Removal is a separate, later step, taken only once no persisted node of
   * this type remains. See ADR 0011.
   */
  deprecated?: NodeDeprecation;
}

export interface NodeDeprecation {
  /** ISO date the type stopped being offered. */
  since: string;
  /** `type` of the node that supersedes it. */
  replacedBy: string;
  /** One line the config panel shows the user, saying what to do instead. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Transitional execution contract (Decision A).
//
// The current engine passes raw node data + Inngest step tools and threads a
// free-form context between nodes. The spec's items-model
// (NodeExecutionContext/Item/NodeResult) lands with the M2 runner upgrades;
// until then every execute has this signature. Do not extend this shape —
// extend NodeDefinition instead.
// ---------------------------------------------------------------------------

export type WorkflowContext = Record<string, unknown>;

export type StepTools = GetStepTools<Inngest.Any>;

export interface NodeRunParams<TData = Record<string, unknown>> {
  /** Raw node config (validated at the save boundary by the type's configSchema). */
  data: TData;
  nodeId: string;
  /**
   * Workflow the run belongs to (AF-M10-10). Needed by nodes that keep state
   * across runs — `DEDUPE` scopes its seen-key window to
   * `(workflowId, nodeId)`, the same key the polling framework uses. Optional
   * for the same reason `organizationId` is: a legacy replay may not carry
   * one, and a node that needs it must fail loudly rather than guess.
   */
  workflowId?: string;
  /**
   * The run this invocation belongs to (AF-M10-08).
   *
   * Needed by nodes that must reason about their own run rather than only
   * about their data: `WAIT` marks its trace row `WAITING` and re-checks for
   * cancellation between sleep chunks, and `APPROVAL` links its
   * `ApprovalRequest` to the execution. Optional for the same reason
   * `organizationId` is — a node that needs it fails loudly rather than
   * guessing.
   */
  executionId?: string;
  userId: string;
  /**
   * Tenant that owns the run. Every tenant-scoped read or write an executor
   * makes — today the AF-M5-07 response cache — keys off this, never off
   * `userId` (engineering_rules §1.3). Optional only because legacy runs
   * created before the org backfill can still replay without one; an executor
   * that needs it must degrade, not guess.
   */
  organizationId?: string;
  /**
   * The accumulated output of upstream nodes — and nothing else.
   *
   * AF-M9-05: this used to be the *enriched* context, carrying `$json`,
   * `$node`, `$execution`, `$workflow` and `$now` alongside the real data.
   * Because every executor returns `{ ...context, … }`, that scaffolding was
   * persisted into `nodeOutputs`, `Execution.output` and every
   * `NodeExecution.input/output`, and `$json` (which self-references the
   * context) re-nested at each hop — so the stored payload grew
   * superlinearly with node count, against the ADR-0018 per-node byte cap.
   *
   * Executors must NOT compile templates against this. Use `resolve`.
   */
  context: WorkflowContext;
  /**
   * Resolve a Handlebars template against the enriched view of `context`
   * (`$json`, `$node`, `$execution`, `$workflow`, `$now` — see
   * `buildTemplateContext`). The enriched object exists only inside this
   * closure, so it can never be returned by an executor and persisted.
   */
  resolve: (template: string) => string;
  step: StepTools;
  publish: Realtime.PublishFn;
  /**
   * Resolved, decrypted credentials for this node, keyed by the
   * `CredentialRequirement.key` (i.e. the node-config field that holds the
   * credential id). Filled exactly once by the engine before the executor runs
   * (AF-M3-04) — executors MUST read from here, never query/openSecret
   * themselves. This map is never merged into `context`, `output`, or the
   * trace, so plaintext cannot reach `NodeExecution.input/output`.
   */
  credentials?: Record<string, CredentialSecret>;
  /**
   * The fan-out item this invocation is for (AF-M9-14), when the node is
   * inside a `SPLIT_OUT`/`AGGREGATE` segment.
   *
   * Templates already see `$item`/`$itemIndex` through `resolve`. This is the
   * same information as a *value*, for the nodes whose behaviour changes
   * rather than whose text does: `FILTER` and `DEDUPE` act on the current item
   * inside a segment and on an array outside one, and inferring which by
   * probing the resolver would be guesswork.
   */
  item?: { value: unknown; index: number };
}

export type NodeRun<TData = Record<string, unknown>> = (
  params: NodeRunParams<TData>,
) => Promise<WorkflowContext>;

// ---------------------------------------------------------------------------
// Polling triggers (AF-M10-05, ADR-0024).
//
// "When a new X appears" is the opening of 18 of the 35 reference automations.
// A poller's whole job is: given where we left off, what is new? It returns
// items and a resume point. It does NOT dispatch runs, does NOT deduplicate,
// and does NOT touch `TriggerState` — the framework owns all three, so those
// decisions have one implementation instead of one per connector.
// ---------------------------------------------------------------------------

export interface PollItem {
  /**
   * Stable identity of this item, unique within this trigger and durable
   * across polls. A row's sheet id, a message id, a file id — never an array
   * index, which changes the moment anything is inserted.
   */
  id: string;
  /** Payload handed to the run as its trigger data. */
  data: unknown;
}

export interface PollContext<TConfig = Record<string, unknown>> {
  /** Validated node config. */
  config: TConfig;
  /** Resolved credentials, keyed as in `NodeRunParams.credentials`. */
  credentials?: Record<string, CredentialSecret>;
  /** Whatever this poller returned as `cursor` last time; undefined on the first poll. */
  cursor: unknown;
  /**
   * True on the very first poll after a trigger is activated.
   *
   * A poller may use it to fetch a cheaper "just tell me where the end is"
   * response. It does NOT have to: the framework suppresses dispatch on the
   * first poll regardless, so activating a workflow against a 500-row sheet
   * starts 0 runs, not 500.
   */
  isFirstPoll: boolean;
  /** Upper bound on items to return. Returning more is trimmed by the framework. */
  limit: number;
}

export interface PollResult {
  items: PollItem[];
  /** Resume point for the next poll. Persisted verbatim; must be JSON-serializable. */
  cursor: unknown;
}

export interface PollingTrigger<TConfig = unknown> {
  /**
   * How often this trigger is swept, in seconds, when the node's config does
   * not say. Floored by the framework's minimum so a connector cannot ask to
   * be polled faster than the sweep runs.
   */
  defaultIntervalSeconds?: number;
  poll(ctx: PollContext<TConfig>): Promise<PollResult>;
}

/** A full registration: isomorphic metadata + server implementation.
 * Flattened so a node's `index.ts` can be `{ ...definition, execute }`.
 * Method-syntax on `execute` keeps parameter checking bivariant, so nodes
 * with narrower data types register against the general contract. */
export interface NodeRegistration<TConfig = unknown>
  extends NodeDefinition<TConfig> {
  execute(params: NodeRunParams): Promise<WorkflowContext>;
  /**
   * (AF-M10-05) Present on TRIGGER nodes that discover work by polling. The
   * sweep in `evaluate-schedules` finds them through the registry rather than
   * a hard-coded list, so a new poller is a node folder and nothing else.
   *
   * A polling trigger still has an `execute` — it is what runs when the
   * dispatched run reaches the trigger node — but that executor does no
   * fetching; the item is already in the run's initial data.
   */
  polling?: PollingTrigger<TConfig>;
}
