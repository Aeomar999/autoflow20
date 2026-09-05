import { z } from "zod";

/**
 * Typed comparison for filtering nodes (AF-M10-10).
 *
 * `CONDITION` compares two *rendered strings*, which is right for routing on
 * text and wrong for filtering on data: `{{item.ok}}` where `ok` is the
 * boolean `false` renders as `"false"`, and `"false" === "false"` is true, so
 * "keep the ones where ok is true" quietly keeps everything.
 *
 * The fix is AF-M9-08's rule applied to comparison: the author declares what
 * kind of value they are comparing, and the parse is strict rather than
 * coercing. `"42"` is only a number when the author says `number`; `"true"` is
 * only a boolean when the author says `boolean`.
 *
 * Isomorphic — the config panel needs the operator list and the executor needs
 * the evaluation.
 */

export const COMPARE_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "gt",
  "gte",
  "lt",
  "lte",
  "is_empty",
  "is_not_empty",
  "is_true",
  "is_false",
] as const;

export type CompareOperator = (typeof COMPARE_OPERATORS)[number];

export const COMPARE_VALUE_TYPES = [
  "string",
  "number",
  "boolean",
  "date",
] as const;

export type CompareValueType = (typeof COMPARE_VALUE_TYPES)[number];

export const compareOperatorSchema = z.enum(COMPARE_OPERATORS);
export const compareValueTypeSchema = z.enum(COMPARE_VALUE_TYPES);

/** Operators that ignore the right-hand side entirely. */
export const UNARY_OPERATORS: ReadonlySet<CompareOperator> = new Set([
  "is_empty",
  "is_not_empty",
  "is_true",
  "is_false",
]);

export class ComparisonTypeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComparisonTypeError";
  }
}

/**
 * Read a rendered string as the declared type.
 *
 * Returns `undefined` for an empty input rather than throwing: an absent field
 * is a normal thing to filter on (`is_empty`), and forcing every author to
 * special-case it would make the common expression unwriteable.
 */
function parse(
  value: string,
  type: CompareValueType,
  side: "left" | "right",
): string | number | boolean | Date | undefined {
  const trimmed = value.trim();
  if (trimmed === "") {
    return undefined;
  }

  switch (type) {
    case "string":
      return value;
    case "number": {
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        throw new ComparisonTypeError(
          `the ${side}-hand value "${value}" is not a number. Change the comparison type, or fix the expression.`,
        );
      }
      return parsed;
    }
    case "boolean": {
      const normalized = trimmed.toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
      throw new ComparisonTypeError(
        `the ${side}-hand value "${value}" is not a boolean (expected "true" or "false").`,
      );
    }
    case "date": {
      const parsed = new Date(trimmed);
      if (Number.isNaN(parsed.getTime())) {
        throw new ComparisonTypeError(
          `the ${side}-hand value "${value}" is not a date this node can read (use ISO 8601).`,
        );
      }
      return parsed;
    }
  }
}

const asComparable = (
  value: string | number | boolean | Date,
): number | string =>
  value instanceof Date
    ? value.getTime()
    : typeof value === "boolean"
      ? Number(value)
      : value;

/**
 * Evaluate `left <operator> right` under the declared type.
 *
 * Ordering comparisons against an absent value are **false**, never a throw:
 * "keep rows whose amount is over 100" should skip a row with no amount, not
 * fail the run on the first blank cell.
 */
export function compareTyped(args: {
  left: string;
  operator: CompareOperator;
  right: string;
  type: CompareValueType;
}): boolean {
  const { operator, type } = args;

  if (operator === "is_empty") return args.left.trim() === "";
  if (operator === "is_not_empty") return args.left.trim() !== "";

  const left = parse(args.left, type, "left");

  if (operator === "is_true")
    return left === true || args.left.trim() === "true";
  if (operator === "is_false")
    return left === false || args.left.trim() === "false";

  if (operator === "contains" || operator === "not_contains") {
    // Substring is a string question whatever the declared type; comparing
    // "does 12345 contain 234" as numbers is meaningless.
    const hit = args.left.includes(args.right);
    return operator === "contains" ? hit : !hit;
  }

  const right = parse(args.right, type, "right");

  if (operator === "equals" || operator === "not_equals") {
    const equal =
      left === undefined || right === undefined
        ? left === right
        : asComparable(left) === asComparable(right);
    return operator === "equals" ? equal : !equal;
  }

  if (left === undefined || right === undefined) {
    return false;
  }

  const l = asComparable(left);
  const r = asComparable(right);
  switch (operator) {
    case "gt":
      return l > r;
    case "gte":
      return l >= r;
    case "lt":
      return l < r;
    case "lte":
      return l <= r;
    default:
      return false;
  }
}
