/**
 * AF-M11-02. Applies a phase-to-phase handoff to the org-scoped `Employee`
 * row. Pure, DB-facing, tenant-scoped: every lookup and mutation is keyed by
 * `organizationId` — the caller passes the tenant, never the row owner.
 *
 * Idempotent (keyed by `employeeRef`) and guarded (single-step forward
 * transitions). Out-of-sequence or unknown-record handoffs return a `conflict`
 * outcome and are logged — never swallowed, so the calling workflow can route
 * them to the human-in-the-loop instead of silently passing.
 */

import type {
  EmployeeActiveInput,
  EmployeeHandoffInput,
  EmployeeHiredInput,
  EmployeeOffboardingInput,
  EmployeeStatus,
} from "@/features/employees/lib/employee";
import type { Prisma } from "@/generated/prisma/client";
import { logAuditEvent } from "@/lib/audit";
import prisma from "@/lib/db";
import { logger } from "@/lib/logger";

type EmployeeRow = Prisma.EmployeeGetPayload<object>;

export type HandoffOutcome =
  | { outcome: "created"; employee: EmployeeRow; status: EmployeeStatus }
  | {
      outcome: "transitioned";
      employee: EmployeeRow;
      from: EmployeeStatus;
      to: EmployeeStatus;
    }
  | {
      outcome: "already-current";
      employee: EmployeeRow;
      status: EmployeeStatus;
    }
  | {
      outcome: "conflict";
      employee: EmployeeRow | null;
      from: EmployeeStatus | null;
      to: EmployeeStatus;
      reason: string;
    };

interface TransitionGuard {
  /** Statuses the row may legitimately move forward from. */
  allowedFrom: readonly EmployeeStatus[];
  /** Status that makes the handoff a no-op (at-least-once redelivery). */
  idempotentAt: EmployeeStatus;
  /** Status to move to. */
  to: EmployeeStatus;
}

type GuardStep =
  | { kind: "transition" }
  | { kind: "idempotent" }
  | { kind: "conflict"; reason: string };

function evalGuard(current: EmployeeStatus, guard: TransitionGuard): GuardStep {
  if (current === guard.idempotentAt) {
    return { kind: "idempotent" };
  }
  if (guard.allowedFrom.includes(current)) {
    return { kind: "transition" };
  }
  return {
    kind: "conflict",
    reason: `Expected ${[...guard.allowedFrom, guard.idempotentAt].join("/")}, was ${current}`,
  };
}

function conflictOutcome(
  to: EmployeeStatus,
  employeeRef: string,
  row: EmployeeRow | null,
  step: GuardStep,
): HandoffOutcome {
  const outcome: HandoffOutcome = {
    outcome: "conflict",
    employee: row,
    from: row ? (row.status as EmployeeStatus) : null,
    to,
    reason: step.kind === "conflict" ? step.reason : "unknown employee",
  };
  logger.warn("employee.handoff.conflict", {
    employeeRef,
    to,
    from: outcome.from,
    reason: outcome.reason,
  });
  return outcome;
}

function resolveDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  // Date-only payload strings are local midnight, matching how the canvas
  // serialized them; everything else is a full ISO datetime.
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
}

function pickDate(
  input: EmployeeActiveInput,
  value: "activeAt",
): Date | undefined;
function pickDate(
  input: EmployeeOffboardingInput,
  value: "exitDate",
): Date | undefined;
function pickDate(
  input: EmployeeHiredInput,
  value: "startDate",
): Date | undefined;
function pickDate(
  input: { activeAt?: string; exitDate?: string; startDate?: string },
  key: "activeAt" | "exitDate" | "startDate",
): Date | undefined {
  return resolveDate(input[key]);
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}

async function audit(
  organizationId: string,
  action: string,
  employee: EmployeeRow,
  after: Record<string, unknown>,
): Promise<void> {
  await logAuditEvent({
    organizationId,
    actorType: "SYSTEM",
    action,
    resourceType: "employee",
    resourceId: employee.id,
    after: { employeeRef: employee.employeeRef, ...after },
  });
}

async function applyTransition(
  organizationId: string,
  existing: EmployeeRow,
  to: EmployeeStatus,
  data: Omit<Prisma.EmployeeUpdateInput, "status">,
): Promise<HandoffOutcome> {
  const updated = await prisma.employee.update({
    where: { id: existing.id },
    data: { ...data, status: to },
  });
  await audit(organizationId, "employee.status_changed", updated, {
    from: existing.status,
    to,
  });
  return {
    outcome: "transitioned",
    employee: updated,
    from: existing.status as EmployeeStatus,
    to,
  };
}

async function handleHired(
  organizationId: string,
  input: EmployeeHiredInput,
): Promise<HandoffOutcome> {
  const existing = await prisma.employee.findFirst({
    where: { organizationId, employeeRef: input.employeeRef },
  });

  if (existing) {
    const guard: TransitionGuard = {
      allowedFrom: ["CANDIDATE"],
      idempotentAt: "OFFERED",
      to: "OFFERED",
    };
    const step = evalGuard(existing.status as EmployeeStatus, guard);
    if (step.kind === "idempotent") {
      return {
        outcome: "already-current",
        employee: existing,
        status: "OFFERED",
      };
    }
    if (step.kind === "conflict") {
      return conflictOutcome("OFFERED", input.employeeRef, existing, step);
    }
    return applyTransition(organizationId, existing, "OFFERED", {
      offerSignedAt: new Date(),
      department: input.department ?? null,
      managerEmail: input.managerEmail ?? null,
      personalEmail: input.personalEmail ?? null,
    });
  }

  const data: Prisma.EmployeeCreateInput = {
    organization: { connect: { id: organizationId } },
    employeeRef: input.employeeRef,
    email: input.email,
    fullName: input.fullName,
    role: input.role,
    department: input.department ?? null,
    managerEmail: input.managerEmail ?? null,
    personalEmail: input.personalEmail ?? null,
    startDate: pickDate(input, "startDate"),
    status: "OFFERED",
    source: "ACQUISITION",
    offerSignedAt: new Date(),
  };

  try {
    const created = await prisma.employee.create({ data });
    await audit(organizationId, "employee.created", created, {
      status: created.status,
      source: created.source,
    });
    return { outcome: "created", employee: created, status: "OFFERED" };
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Concurrent at-least-once redelivery; the unique
      // (organizationId, employeeRef) pair makes the second create a no-op.
      const record = await prisma.employee.findFirst({
        where: { organizationId, employeeRef: input.employeeRef },
      });
      if (record) {
        return {
          outcome: "already-current",
          employee: record,
          status: "OFFERED",
        };
      }
    }
    throw err;
  }
}

async function handleActive(
  organizationId: string,
  input: EmployeeActiveInput,
): Promise<HandoffOutcome> {
  const existing = await prisma.employee.findFirst({
    where: { organizationId, employeeRef: input.employeeRef },
  });

  if (!existing) {
    return conflictOutcome("ACTIVE", input.employeeRef, null, {
      kind: "conflict",
      reason: "unknown employee",
    });
  }

  const guard: TransitionGuard = {
    allowedFrom: ["OFFERED", "ONBOARDING"],
    idempotentAt: "ACTIVE",
    to: "ACTIVE",
  };
  const step = evalGuard(existing.status as EmployeeStatus, guard);
  if (step.kind === "idempotent") {
    return { outcome: "already-current", employee: existing, status: "ACTIVE" };
  }
  if (step.kind === "conflict") {
    return conflictOutcome("ACTIVE", input.employeeRef, existing, step);
  }
  return applyTransition(organizationId, existing, "ACTIVE", {
    activeAt: pickDate(input, "activeAt") ?? new Date(),
  });
}

async function handleOffboarding(
  organizationId: string,
  input: EmployeeOffboardingInput,
): Promise<HandoffOutcome> {
  const existing = await prisma.employee.findFirst({
    where: { organizationId, employeeRef: input.employeeRef },
  });

  if (!existing) {
    return conflictOutcome("OFFBOARDING", input.employeeRef, null, {
      kind: "conflict",
      reason: "unknown employee",
    });
  }

  const guard: TransitionGuard = {
    allowedFrom: ["ACTIVE"],
    idempotentAt: "OFFBOARDING",
    to: "OFFBOARDING",
  };
  const step = evalGuard(existing.status as EmployeeStatus, guard);
  if (step.kind === "idempotent") {
    return {
      outcome: "already-current",
      employee: existing,
      status: "OFFBOARDING",
    };
  }
  if (step.kind === "conflict") {
    return conflictOutcome("OFFBOARDING", input.employeeRef, existing, step);
  }
  return applyTransition(organizationId, existing, "OFFBOARDING", {
    exitDate: input.exitDate ? resolveDate(input.exitDate) : undefined,
    exitReason: input.exitReason ?? null,
  });
}

export async function applyEmployeeHandoff(
  organizationId: string,
  input: EmployeeHandoffInput,
): Promise<HandoffOutcome> {
  switch (input.event) {
    case "employee.hired":
      return handleHired(organizationId, input);
    case "employee.active":
      return handleActive(organizationId, input);
    case "employee.offboarding":
      return handleOffboarding(organizationId, input);
  }
}
