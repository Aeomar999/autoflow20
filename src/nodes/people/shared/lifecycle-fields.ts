import { NonRetriableError } from "inngest";

import type { NodeRunParams } from "@/nodes/types";

/**
 * AF-M11-14. Field resolution shared by the five lifecycle handoff nodes
 * (`EMPLOYEE_HIRED` / `_ONBOARDING` / `_ACTIVE` / `_OFFBOARDING` /
 * `_OFFBOARDED`).
 *
 * **Why this is shared rather than copied.** Each node had its own inline
 * `resolvedField` / `requiredField` pair, and the copies diverged: two of them
 * passed an optional field whose expression resolved to nothing straight
 * through as `""`. An empty string is not "absent" to the contract —
 * `dateOnlySchema` and `z.string().email()` both reject it — so
 * `activeAt: "{{startDate}}"` on a run whose payload carried no `startDate`
 * failed the whole handoff, which is precisely the unknown-start-date case
 * AF-M11-05 was specified to tolerate. One helper, one rule.
 */

export interface LifecycleFields {
  /** Resolve a field that the handoff cannot proceed without. */
  required(value: string | undefined, label: string): string;
  /**
   * Resolve an optional field. An expression that resolves to nothing yields
   * `undefined` (the field is absent) — never `""`, which the contract's date
   * and email schemas reject.
   */
  optional(value: string | undefined): string | undefined;
}

export function lifecycleFields(
  resolve: NodeRunParams["resolve"],
  where: string,
): LifecycleFields {
  const resolved = (value: string | undefined) =>
    value === undefined ? undefined : resolve(value).trim();

  return {
    required(value, label) {
      const field = resolved(value);
      if (!field) {
        throw new NonRetriableError(
          `${where}: the ${label} expression resolved to nothing.`,
        );
      }
      return field;
    },
    optional(value) {
      const field = resolved(value);
      return field ? field : undefined;
    },
  };
}

/**
 * Guards every lifecycle node runs before touching the handoff layer: a
 * missing variable name would silently drop the outcome, and a run with no
 * tenant must never guess one.
 */
export function assertLifecycleContext(
  data: { variableName?: string },
  organizationId: string | undefined,
  where: string,
): { variableName: string; organizationId: string } {
  if (!data.variableName?.trim()) {
    throw new NonRetriableError(`${where}: Variable name is missing`);
  }
  if (!organizationId) {
    throw new NonRetriableError(
      `${where}: the run has no organizationId; it cannot scope the employee write.`,
    );
  }
  return { variableName: data.variableName, organizationId };
}
