import {
  BadgeCheckIcon,
  DoorOpenIcon,
  FileSignatureIcon,
  UserPlusIcon,
  UserRoundCheckIcon,
  UserRoundXIcon,
} from "lucide-react";

import {
  StatusPill,
  type StatusTone,
} from "@/components/dashboard/status-pill";
import type { EmployeeStatus } from "@/features/employees/lib/employee";
import { isEmployeeStatus } from "@/features/employees/lib/status-chain";

/**
 * One description of a lifecycle status, shared by the employees list, the
 * detail header and the status-chain timeline — so the same `OFFBOARDING`
 * record never reads amber in one place and grey in another.
 *
 * Keyed by the same `EMPLOYEE_STATUSES` tuple the contract and the guard use:
 * a status added there without a description here fails to type-check.
 */
export const EMPLOYEE_STATUS_META: Record<
  EmployeeStatus,
  { label: string; tone: StatusTone; icon: React.ReactNode }
> = {
  CANDIDATE: {
    label: "Candidate",
    tone: "neutral",
    icon: <UserPlusIcon />,
  },
  OFFERED: {
    label: "Offered",
    tone: "info",
    icon: <FileSignatureIcon />,
  },
  ONBOARDING: {
    label: "Onboarding",
    tone: "accent",
    icon: <UserRoundCheckIcon />,
  },
  ACTIVE: {
    label: "Active",
    tone: "success",
    icon: <BadgeCheckIcon />,
  },
  OFFBOARDING: {
    label: "Offboarding",
    tone: "warning",
    icon: <DoorOpenIcon />,
  },
  OFFBOARDED: {
    label: "Offboarded",
    tone: "neutral",
    icon: <UserRoundXIcon />,
  },
};

/**
 * `Employee.status` is an open-set String column (the `NodeType` lesson), so a
 * row can legitimately carry a value this build does not know. Render it as
 * itself rather than swallowing it into a generic "Unknown" — a status we
 * cannot name is information, not a rendering error.
 */
export const employeeStatusMeta = (status: string) =>
  isEmployeeStatus(status)
    ? EMPLOYEE_STATUS_META[status]
    : { label: status, tone: "neutral" as StatusTone, icon: undefined };

export const EmployeeStatusPill = ({ status }: { status: string }) => {
  const meta = employeeStatusMeta(status);
  return (
    <StatusPill tone={meta.tone} icon={meta.icon}>
      {meta.label}
    </StatusPill>
  );
};
