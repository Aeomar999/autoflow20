"use client";

import { PlayIcon, SparklesIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  baseFieldClass,
  NodeConfigForm,
} from "@/features/editor/components/node-config-form";
import {
  estimateNodeCost,
  formatUsdCost,
} from "@/features/editor/lib/cost-estimate";
import type { EditorNode } from "@/features/editor/store/atoms";
import { useSuspenseWorkflow } from "@/features/workflows/hooks/use-workflows";
import { findManifestEntry } from "@/nodes/manifest";
import { RUN_POLICY_KEY, resolveRunPolicy } from "@/nodes/shared/run-policy";
import type { NodeDefinition } from "@/nodes/types";

/**
 * Mirror of the runner's `ENGINE_RUN_DEFAULTS` (AF-M9-06). Duplicated rather
 * than imported because the runner's copy reads `ENGINE_RETRIES` from
 * `process.env` in a server-only module; these values only ever fill in a
 * placeholder, so drifting would mislead the user, not break a run.
 */
const EDITOR_RUN_DEFAULTS = {
  maxAttempts: 3,
  backoffMs: 1000,
  timeoutMs: 60_000,
};

export function NodeConfigPanel({
  workflowId,
  node,
  definition,
  onNodeChange,
}: {
  workflowId: string;
  node: EditorNode;
  definition: NodeDefinition;
  onNodeChange: (patch: Partial<EditorNode>) => void;
}) {
  const uid = useId();
  const enabled = !node.disabled;
  const costEstimate = useMemo(() => estimateNodeCost(node), [node]);

  return (
    <aside
      role="dialog"
      aria-label="Node configuration"
      className="absolute right-4 top-16 z-50 flex max-h-[calc(100%-5rem)] w-[360px] flex-col gap-4 overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-xl"
    >
      {definition.deprecated ? (
        <output className="block rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          <p className="font-medium text-foreground">
            Deprecated since {definition.deprecated.since}
          </p>
          <p className="mt-1 text-muted-foreground">
            {definition.deprecated.reason}
          </p>
          <p className="mt-1 text-muted-foreground">
            This node still runs, but it can no longer be added to a workflow.
            Replace it with{" "}
            <span className="font-mono">
              {findManifestEntry(definition.deprecated.replacedBy)?.label ??
                definition.deprecated.replacedBy}
            </span>
            .
          </p>
        </output>
      ) : null}

      {definition.accountRequirement ? (
        // AF-M10-22: a requirement of the provider ACCOUNT, which no amount of
        // reconnecting fixes. X's v2 write endpoints are not on the free tier;
        // YouTube uploads need a quota increase. Both surface at run time as a
        // 403 that reads like a permissions bug, so they are said here — while
        // the node is being configured — instead.
        <output className="block rounded-lg border border-info/40 bg-info/10 px-3 py-2 text-xs">
          <p className="font-medium text-foreground">Account requirement</p>
          <p className="mt-1 text-muted-foreground">
            {definition.accountRequirement}
          </p>
        </output>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${uid}-name`} className="text-xs font-medium">
          Name
        </label>
        <input
          id={`${uid}-name`}
          type="text"
          className={baseFieldClass()}
          placeholder={definition.label}
          value={node.name ?? ""}
          onChange={(e) => onNodeChange({ name: e.target.value })}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`${uid}-enabled`} className="text-sm font-medium">
          Enabled
        </label>
        <input
          id={`${uid}-enabled`}
          type="checkbox"
          className="size-4 rounded border-border"
          checked={enabled}
          onChange={(e) => onNodeChange({ disabled: !e.target.checked })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${uid}-notes`} className="text-xs font-medium">
          Notes
        </label>
        <textarea
          id={`${uid}-notes`}
          rows={2}
          className={baseFieldClass()}
          placeholder="What does this node do?"
          value={node.notes ?? ""}
          onChange={(e) =>
            onNodeChange({
              notes: e.target.value.trim() ? e.target.value : undefined,
            })
          }
        />
      </div>

      {costEstimate ? (
        <div className="flex items-center justify-between rounded-lg border border-warning/25 bg-warning/8 px-3 py-2 text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <SparklesIcon className="size-3.5 text-warning" />
            <span>Est. run cost:</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-mono font-semibold text-foreground">
              ~{formatUsdCost(costEstimate.costUsd)}
            </span>
            <span className="text-[10px] text-muted-foreground">
              (~{costEstimate.inputTokens + costEstimate.outputTokens} tok)
            </span>
          </div>
        </div>
      ) : null}

      <div className="border-t border-border pt-3">
        <NodeConfigForm
          key={node.id}
          definition={definition}
          data={node.data}
          onDataChange={(data) => onNodeChange({ data })}
        />
      </div>

      <RunSettings
        definition={definition}
        data={node.data}
        onDataChange={(data) => onNodeChange({ data })}
      />

      {node.type === "WEBHOOK_TRIGGER" && (
        <WebhookTester workflowId={workflowId} />
      )}
    </aside>
  );
}

/**
 * Per-node run policy (AF-M9-06).
 *
 * Collapsed by default: retries and timeouts matter to a handful of nodes and
 * would otherwise push the node's actual configuration below the fold on every
 * one of them. Placeholders show the value the node would inherit — the
 * definition's own policy, or the engine default — so leaving a field empty is
 * an informed choice rather than a blank.
 */
function RunSettings({
  definition,
  data,
  onDataChange,
}: {
  definition: NodeDefinition;
  data: Record<string, unknown>;
  onDataChange: (next: Record<string, unknown>) => void;
}) {
  const uid = useId();
  const policy = (data?.[RUN_POLICY_KEY] ?? {}) as Record<string, unknown>;

  const inherited = resolveRunPolicy(
    // Resolve what this node WOULD get with no policy of its own, so the
    // placeholders describe the fallback rather than echoing the value.
    Object.fromEntries(
      Object.entries(data ?? {}).filter(([k]) => k !== RUN_POLICY_KEY),
    ),
    definition,
    EDITOR_RUN_DEFAULTS,
  );

  const setField = (key: string, value: number | boolean | undefined) => {
    const next = { ...policy };
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
    const nextData = { ...data };
    if (Object.keys(next).length === 0) {
      delete nextData[RUN_POLICY_KEY];
    } else {
      nextData[RUN_POLICY_KEY] = next;
    }
    onDataChange(nextData);
  };

  /** Empty input clears the override rather than writing 0. */
  const numberField = (
    key: "maxAttempts" | "backoffMs" | "timeoutMs",
    label: string,
    placeholder: number,
    hint: string,
  ) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${uid}-${key}`} className="text-xs font-medium">
        {label}
      </label>
      <input
        id={`${uid}-${key}`}
        type="number"
        className={baseFieldClass()}
        placeholder={`Inherits ${placeholder}`}
        value={typeof policy[key] === "number" ? String(policy[key]) : ""}
        onChange={(e) => {
          const raw = e.target.value.trim();
          setField(key, raw === "" ? undefined : Number(raw));
        }}
      />
      <p className="text-[10px] text-muted-foreground">{hint}</p>
    </div>
  );

  return (
    <details className="border-t border-border pt-3">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
        Run settings
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        {numberField(
          "maxAttempts",
          "Max attempts",
          inherited.maxAttempts,
          "Total tries including the first. 1 disables retries.",
        )}
        {numberField(
          "backoffMs",
          "Retry backoff (ms)",
          inherited.backoffMs,
          "Doubles after each failed attempt.",
        )}
        {/* "Attempt timeout", not "Timeout": several nodes (HTTP Request,
            Webhook) declare their own `timeoutMs` for the outbound request,
            and two fields labelled "Timeout" on one panel would be a coin
            flip. This one is the engine's wall clock for one attempt of the
            whole node. */}
        {numberField(
          "timeoutMs",
          "Attempt timeout (ms)",
          inherited.timeoutMs,
          "Engine wall clock for one attempt of this node — separate from any request timeout the node itself configures.",
        )}

        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor={`${uid}-continueOnFail`}
            className="text-sm font-medium"
          >
            Continue on fail
          </label>
          <input
            id={`${uid}-continueOnFail`}
            type="checkbox"
            className="size-4 rounded border-border"
            checked={policy.continueOnFail === true}
            onChange={(e) =>
              setField("continueOnFail", e.target.checked ? true : undefined)
            }
          />
        </div>
        <p className="-mt-1 text-[10px] text-muted-foreground">
          The run keeps going when this node fails. The node is still recorded
          as failed.
        </p>
      </div>
    </details>
  );
}

function WebhookTester({ workflowId }: { workflowId: string }) {
  const { data: workflow } = useSuspenseWorkflow(workflowId);
  const [payload, setPayload] = useState(
    '{\n  "domain": "stripe.com",\n  "email": "contact@stripe.com"\n}',
  );
  const [isLoading, setIsLoading] = useState(false);

  if (!workflow.webhookSecret) {
    return (
      <div className="border-t border-border pt-3 mt-4">
        <p className="text-xs text-muted-foreground">
          Save and publish this workflow to test webhooks.
        </p>
      </div>
    );
  }

  const handleRun = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/webhooks/${workflowId}/inbound`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-secret": workflow.webhookSecret!,
        },
        body: payload,
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Webhook triggered successfully!");
      } else {
        toast.error(`Webhook failed: ${data.error || "Unknown error"}`);
      }
    } catch (e: any) {
      toast.error(`Request failed: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="border-t border-border pt-4 mt-4">
      <h3 className="text-sm font-medium mb-2">Test Webhook Payload</h3>
      <p className="text-xs text-muted-foreground mb-3">
        Paste a JSON payload below and click Run to trigger this workflow
        directly.
      </p>
      <textarea
        className="w-full flex min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 font-mono text-xs mb-3"
        rows={5}
        value={payload}
        onChange={(e) => setPayload(e.target.value)}
      />
      <button
        type="button"
        onClick={handleRun}
        disabled={isLoading}
        className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2 w-full"
      >
        {isLoading ? (
          "Running..."
        ) : (
          <>
            <PlayIcon className="mr-2 h-4 w-4" /> Run Webhook
          </>
        )}
      </button>
    </div>
  );
}
