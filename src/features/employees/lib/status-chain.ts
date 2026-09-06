import {
  EMPLOYEE_STATUSES,
  type EmployeeStatus,
} from "@/features/employees/lib/employee";

/**
 * Pure helpers over the lifecycle chain, kept out of the components so the
 * rules are unit-testable without rendering anything.
 */

export const isEmployeeStatus = (value: string): value is EmployeeStatus =>
  (EMPLOYEE_STATUSES as readonly string[]).includes(value);

/**
 * Index of a status in the chain, or `-1` for one this build does not know.
 *
 * `Employee.status` is an open-set String column (the `NodeType` lesson), so
 * an unknown value is possible and must not be silently mapped onto a real
 * position — a record showing the wrong phase is worse than one showing none.
 */
export const statusChainPosition = (status: string): number =>
  (EMPLOYEE_STATUSES as readonly string[]).indexOf(status);

export type ChainStep = {
  status: EmployeeStatus;
  state: "past" | "current" | "upcoming";
};

/**
 * The whole chain with the record's position marked, so the detail view shows
 * the phases still ahead as well as the ones behind. An unknown status leaves
 * every step "upcoming" rather than guessing.
 */
export const buildStatusChain = (status: string): ChainStep[] => {
  const reached = statusChainPosition(status);
  return EMPLOYEE_STATUSES.map((step, index) => ({
    status: step,
    state:
      index === reached
        ? ("current" as const)
        : reached >= 0 && index < reached
          ? ("past" as const)
          : ("upcoming" as const),
  }));
};
