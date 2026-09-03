import "server-only";
import { NonRetriableError } from "inngest";
import {
  DEFAULT_DEDUPE_WINDOW,
  dedupeFingerprint,
  MAX_DEDUPE_KEYS,
  recordSeenKeys,
} from "@/features/triggers/server/dedupe-store";
import { SEGMENT_DROP_ITEM_KEY } from "@/inngest/trace";
import { readPath, stringifyForCompare } from "@/nodes/shared/paths";
import type { NodeRun } from "@/nodes/types";

type DedupeData = {
  variableName?: string;
  items?: string;
  key?: string;
  mode?: "forever" | "window";
  windowSize?: number;
};

export const execute: NodeRun<DedupeData> = async ({
  data,
  nodeId,
  workflowId,
  organizationId,
  context,
  resolve,
  step,
  item,
}) =>
  step.run("dedupe", async () => {
    if (!data.key) {
      throw new NonRetriableError(
        "Dedupe node: no key configured. Without one there is nothing to compare, and every item would look new.",
      );
    }
    if (!workflowId || !organizationId) {
      // The window is stored per (workflow, node) and org-scoped. A run with
      // neither has nowhere to keep state, and silently deduplicating nothing
      // is the failure this node exists to prevent.
      throw new NonRetriableError(
        "Dedupe node: this run carries no workflow or organization, so the seen-key window cannot be read or written.",
      );
    }

    const mode = data.mode ?? "forever";
    const windowSize =
      mode === "window"
        ? (data.windowSize ?? DEFAULT_DEDUPE_WINDOW)
        : MAX_DEDUPE_KEYS;
    const fingerprint = dedupeFingerprint({
      keyExpression: data.key,
      mode,
    });

    // --- Inside a fan-out segment: one item at a time ---------------------
    if (item) {
      const key = resolve(data.key).trim();
      if (key === "") {
        throw new NonRetriableError(
          "Dedupe node: the key expression resolved to nothing for this item. An empty key would make every item collide with every other.",
        );
      }

      const { fresh } = await recordSeenKeys({
        workflowId,
        nodeId,
        organizationId,
        keys: [key],
        fingerprint,
        windowSize,
      });

      if (fresh.length === 1) {
        return { ...context };
      }
      // Seen before: drop the item. Not a failure — being a duplicate is the
      // answer this node exists to give.
      return { ...context, [SEGMENT_DROP_ITEM_KEY]: true };
    }

    // --- Outside a segment: filter an array -------------------------------
    if (!data.variableName) {
      throw new NonRetriableError(
        "Dedupe node: Variable name not configured (required outside a fan-out segment)",
      );
    }
    if (!data.items) {
      throw new NonRetriableError(
        "Dedupe node: no items expression configured. Point it at an array, or place this node inside a SPLIT_OUT segment to dedupe items one at a time.",
      );
    }

    const rendered = resolve(data.items);
    let parsed: unknown;
    try {
      parsed = JSON.parse(rendered);
    } catch {
      throw new NonRetriableError(
        `Dedupe node: the items expression resolved to "${rendered.slice(0, 120)}", which is not a JSON array.`,
      );
    }
    if (!Array.isArray(parsed)) {
      throw new NonRetriableError(
        "Dedupe node: the items expression resolved to a value that is not an array.",
      );
    }

    // Key by dot-path, for the same reason FILTER does: out here a template is
    // compiled against the node's context, not against each element.
    const keyed = parsed.map((element) => ({
      element,
      key: stringifyForCompare(readPath(element, data.key ?? "")).trim(),
    }));

    const blank = keyed.filter((entry) => entry.key === "");
    if (blank.length > 0) {
      throw new NonRetriableError(
        `Dedupe node: ${blank.length} of ${keyed.length} items have no value at "${data.key}". An empty key would make them all collide, so the run stopped instead.`,
      );
    }

    const { fresh, duplicates, reset } = await recordSeenKeys({
      workflowId,
      nodeId,
      organizationId,
      keys: keyed.map((entry) => entry.key),
      fingerprint,
      windowSize,
    });

    const freshKeys = new Set(fresh);
    const kept: unknown[] = [];
    // One pass, first occurrence wins: `recordSeenKeys` already collapsed
    // repeats within this batch, so a key appearing twice here is fresh once.
    const emitted = new Set<string>();
    for (const entry of keyed) {
      if (freshKeys.has(entry.key) && !emitted.has(entry.key)) {
        emitted.add(entry.key);
        kept.push(entry.element);
      }
    }

    return {
      ...context,
      [data.variableName]: {
        items: kept,
        kept: kept.length,
        duplicates: duplicates.length,
        total: keyed.length,
        // Surfaced so an operator can see why a run suddenly reprocessed
        // everything: the key expression changed and the window was cleared.
        windowReset: reset,
      },
    };
  });
