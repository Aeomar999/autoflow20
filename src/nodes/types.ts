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
  /** Palette search terms. */
  keywords?: string[];
  /** Zod schema — single source of truth for config. Drives form AND validation. */
  configSchema: z.ZodType<TConfig>;
  /** Must satisfy configSchema.parse(). */
  defaults: TConfig;
  /** [] for triggers. */
  inputs: PortDef[];
  outputs: PortDef[];
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
}

export type NodeRun<TData = Record<string, unknown>> = (
  params: NodeRunParams<TData>,
) => Promise<WorkflowContext>;

/** A full registration: isomorphic metadata + server implementation.
 * Flattened so a node's `index.ts` can be `{ ...definition, execute }`.
 * Method-syntax on `execute` keeps parameter checking bivariant, so nodes
 * with narrower data types register against the general contract. */
export interface NodeRegistration<TConfig = unknown>
  extends NodeDefinition<TConfig> {
  execute(params: NodeRunParams): Promise<WorkflowContext>;
}
