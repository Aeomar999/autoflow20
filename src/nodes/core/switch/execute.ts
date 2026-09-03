import "server-only";
import { NonRetriableError } from "inngest";
import { manualTriggerChannel } from "@/inngest/channels/manual-trigger";
import { OUTPUT_PORT_KEY, UNMATCHED_OUTPUT_PORT } from "@/inngest/trace";
import type { NodeRun } from "@/nodes/types";
import type { SwitchData, SwitchOperator } from "./definition";

/**
 * Switch node: evaluates its rules IN ORDER against the resolved context and
 * routes to the output port named by the first matching rule's `outputKey`
 * (AF-M9-09).
 *
 * The engine reads `_outputPort` (AF-M2-04) to mark the corresponding
 * outgoing edge as taken. When no rule matches:
 *  - `fallback: "extra"` routes to the reserved "extra" port.
 *  - `fallback: "none"` emits the engine's UNMATCHED_OUTPUT_PORT sentinel so
 *    `markTakenEdges` marks nothing and every downstream branch is SKIPPED by
 *    reachability (the run still ends SUCCESS — deliberate no-op routing is not
 *    a failure).
 */
export const execute: NodeRun<SwitchData> = async ({
  data,
  nodeId,
  context,
  resolve,
  step,
  publish,
}) => {
  await publish(
    manualTriggerChannel().status({
      nodeId,
      status: "loading",
    }),
  );

  const result = await step.run("switch", async () => {
    const rules = data.rules ?? [];
    assertUniqueOutputKeys(rules);

    let outputPort: string = UNMATCHED_OUTPUT_PORT;
    let matchedKey: string | undefined;

    for (const rule of rules) {
      const left = resolve(rule.left);
      const right = resolve(rule.right);
      if (evaluate(left, rule.operator, right)) {
        matchedKey = rule.outputKey;
        break;
      }
    }

    if (matchedKey) {
      outputPort = matchedKey;
    } else if (data.fallback === "extra") {
      outputPort = "extra";
    }

    return {
      ...context,
      [OUTPUT_PORT_KEY]: outputPort,
      switchResult: matchedKey ?? null,
    };
  });

  await publish(
    manualTriggerChannel().status({
      nodeId,
      status: "success",
    }),
  );

  return result;
};

function assertUniqueOutputKeys(rules: { outputKey: string }[]): void {
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.outputKey)) {
      throw new NonRetriableError(
        `Switch node: duplicate rule output key "${rule.outputKey}". Each rule must route to a unique output port.`,
      );
    }
    seen.add(rule.outputKey);
  }
}

function evaluate(
  left: string,
  operator: SwitchOperator,
  right: string,
): boolean {
  const leftNum = Number.parseFloat(left);
  const rightNum = Number.parseFloat(right);
  const isNumeric = !Number.isNaN(leftNum) && !Number.isNaN(rightNum);

  switch (operator) {
    case "equals":
      return left === right;
    case "not_equals":
      return left !== right;
    case "contains":
      return left.includes(right);
    case "not_contains":
      return !left.includes(right);
    case "gt":
      return isNumeric && leftNum > rightNum;
    case "gte":
      return isNumeric && leftNum >= rightNum;
    case "lt":
      return isNumeric && leftNum < rightNum;
    case "lte":
      return isNumeric && leftNum <= rightNum;
    case "is_empty":
      return left.trim() === "";
    case "is_not_empty":
      return left.trim() !== "";
    default:
      return false;
  }
}
