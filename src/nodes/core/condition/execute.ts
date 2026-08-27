import "server-only";
import { NonRetriableError } from "inngest";
import { compileTemplate } from "@/features/executions/template";
import { manualTriggerChannel } from "@/inngest/channels/manual-trigger";
import { OUTPUT_PORT_KEY } from "@/inngest/trace";
import type { NodeRun } from "@/nodes/types";
import type { ConditionData } from "./definition";

/**
 * Condition node: evaluates left <operator> right and routes to
 * "true" or "false" by setting `_outputPort` on the returned context.
 *
 * The engine reads `_outputPort` (AF-M2-04) to mark the corresponding
 * outgoing edge as taken, enabling branch-taken skip semantics.
 */
export const execute: NodeRun<ConditionData> = async ({
  data,
  nodeId,
  context,
  step,
  publish,
}) => {
  await publish(
    manualTriggerChannel().status({
      nodeId,
      status: "loading",
    }),
  );

  const result = await step.run("condition", async () => {
    const leftRaw = data.left ? compileTemplate(data.left)(context) : "";
    const rightRaw = data.right ? compileTemplate(data.right)(context) : "";

    if (!data.operator) {
      throw new NonRetriableError("Condition node: operator is required");
    }

    const matched = evaluate(leftRaw, data.operator, rightRaw);

    return {
      ...context,
      [OUTPUT_PORT_KEY]: matched ? "true" : "false",
      conditionResult: matched,
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

function evaluate(left: string, operator: string, right: string): boolean {
  // Try numeric comparison first for gt/gte/lt/lte.
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
