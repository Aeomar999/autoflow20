import type { Realtime } from "@inngest/realtime";
import type { GetStepTools, Inngest } from "inngest";
import type { z } from "zod";

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
   * break. Currently the raw Prisma enum value ("MANUAL_TRIGGER"); M1-02
   * migrates these to namespaced ids ("core.manual-trigger").
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
  defaultRetry?: RetryPolicy;
  /** Wall-clock cap for one attempt (enforced by the runner, M2). */
  timeoutMs?: number;
  /** Migrate a saved config from an older typeVersion (runs on load/compile). */
  migrate?: (config: unknown, fromVersion: number) => TConfig;
  /** Docs link rendered in the config panel. */
  docsUrl?: string;
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
  context: WorkflowContext;
  step: StepTools;
  publish: Realtime.PublishFn;
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
