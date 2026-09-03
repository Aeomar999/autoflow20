import "server-only";
import { NonRetriableError } from "inngest";
import { SEGMENT_DROP_ITEM_KEY } from "@/inngest/trace";
import {
  type CompareOperator,
  type CompareValueType,
  ComparisonTypeError,
  compareTyped,
  UNARY_OPERATORS,
} from "@/nodes/shared/compare";
import { readPath, stringifyForCompare } from "@/nodes/shared/paths";
import type { NodeRun } from "@/nodes/types";

type FilterData = {
  variableName?: string;
  items?: string;
  itemPath?: string;
  left?: string;
  operator?: CompareOperator;
  right?: string;
  valueType?: CompareValueType;
};

export const execute: NodeRun<FilterData> = async ({
  data,
  context,
  resolve,
  step,
  item,
}) =>
  step.run("filter", async () => {
    if (!data.operator) {
      throw new NonRetriableError("Filter node: operator is required");
    }

    const operator = data.operator;
    const valueType = data.valueType ?? "string";

    const matches = (left: string, right: string): boolean => {
      try {
        return compareTyped({ left, operator, right, type: valueType });
      } catch (error) {
        if (error instanceof ComparisonTypeError) {
          // A type mismatch is a config error, not a transient one: retrying
          // compares the same two values again.
          throw new NonRetriableError(`Filter node: ${error.message}`);
        }
        throw error;
      }
    };

    const right = data.right ? resolve(data.right) : "";

    // --- Inside a fan-out segment: test THIS item -------------------------
    //
    // `$item` is in the resolver's scope here (AF-M9-14), so the author writes
    // an ordinary template and it addresses the current item.
    if (item) {
      if (!data.left && !UNARY_OPERATORS.has(operator)) {
        throw new NonRetriableError(
          "Filter node: the left-hand expression is required for this operator",
        );
      }
      const left = data.left ? resolve(data.left) : "";

      if (matches(left, right)) {
        // Pass the item through unchanged, so the rest of the chain sees what
        // it would have seen without the filter.
        return { ...context };
      }

      // Not an error and not a failure — the item was handled and simply does
      // not continue. The segment loop reads this key (AF-M10-10).
      return { ...context, [SEGMENT_DROP_ITEM_KEY]: true };
    }

    // --- Outside a segment: filter an array -------------------------------
    if (!data.variableName) {
      throw new NonRetriableError(
        "Filter node: Variable name not configured (required outside a fan-out segment)",
      );
    }
    if (!data.items) {
      throw new NonRetriableError(
        "Filter node: no items expression configured. Point it at an array, or place this node inside a SPLIT_OUT segment to filter items one at a time.",
      );
    }

    const rendered = resolve(data.items);
    let parsed: unknown;
    try {
      parsed = JSON.parse(rendered);
    } catch {
      throw new NonRetriableError(
        `Filter node: the items expression resolved to "${rendered.slice(0, 120)}", which is not a JSON array.`,
      );
    }
    if (!Array.isArray(parsed)) {
      throw new NonRetriableError(
        "Filter node: the items expression resolved to a value that is not an array.",
      );
    }

    // The left-hand side is a path into each element, not a template: a
    // template is compiled against the NODE's context, which has no
    // per-element scope out here.
    const kept = parsed.filter((element) =>
      matches(
        stringifyForCompare(readPath(element, data.itemPath ?? "")),
        right,
      ),
    );

    return {
      ...context,
      [data.variableName]: {
        items: kept,
        kept: kept.length,
        removed: parsed.length - kept.length,
        total: parsed.length,
      },
    };
  });
