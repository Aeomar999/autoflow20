/**
 * AF-M11-02. Employee lifecycle status chain and handoff contract.
 *
 * Every handoff is keyed by the stable `employeeRef` (not the row id) and
 * guarded: applying an event out of sequence raises a conflict, never a silent
 * no-op.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Status chain
// ---------------------------------------------------------------------------

export const EMPLOYEE_STATUSES = [
  "CANDIDATE",
  "OFFERED",
  "ONBOARDING",
  "ACTIVE",
  "OFFBOARDING",
  "OFFBOARDED",
] as const;

export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

/** Single-step forward-only transitions enforced at the app layer. */
export const EMPLOYEE_TRANSITIONS: Record<
  EmployeeStatus,
  readonly EmployeeStatus[]
> = {
  CANDIDATE: ["OFFERED"],
  OFFERED: ["ONBOARDING"],
  ONBOARDING: ["ACTIVE"],
  ACTIVE: ["OFFBOARDING"],
  OFFBOARDING: ["OFFBOARDED"],
  OFFBOARDED: [],
};

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

export const employeeRefSchema = z.string().trim().min(1).max(200);

export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/** W1 → W2: offer signed, onboarding begins. */
export const employeeHiredSchema = z.object({
  event: z.literal("employee.hired"),
  employeeRef: employeeRefSchema,
  email: z.string().email(),
  fullName: z.string().trim().min(1).max(300),
  role: z.string().trim().min(1).max(200),
  department: z.string().trim().max(200).optional(),
  managerEmail: z.string().email().optional(),
  personalEmail: z.string().email().optional(),
  startDate: dateOnlySchema.optional(),
});

/** W1 → W2: the signed hire officially enters onboarding. */
export const employeeOnboardingSchema = z.object({
  event: z.literal("employee.onboarding"),
  employeeRef: employeeRefSchema,
});

/** W2 → W3: onboarding finished, employee is active. */
export const employeeActiveSchema = z.object({
  event: z.literal("employee.active"),
  employeeRef: employeeRefSchema,
  activeAt: dateOnlySchema.or(z.iso.datetime()).optional(),
});

/** W3 → W4: offboarding begins. */
export const employeeOffboardingSchema = z.object({
  event: z.literal("employee.offboarding"),
  employeeRef: employeeRefSchema,
  exitDate: dateOnlySchema.or(z.iso.datetime()).optional(),
  exitReason: z.string().trim().max(500).optional(),
});

/** W4 terminal: the exit is complete. No transition leaves OFFBOARDED. */
export const employeeOffboardedSchema = z.object({
  event: z.literal("employee.offboarded"),
  employeeRef: employeeRefSchema,
  exitDate: dateOnlySchema.or(z.iso.datetime()).optional(),
});

export const employeeHandoffSchema = z.discriminatedUnion("event", [
  employeeHiredSchema,
  employeeOnboardingSchema,
  employeeActiveSchema,
  employeeOffboardingSchema,
  employeeOffboardedSchema,
]);

export type EmployeeHiredInput = z.infer<typeof employeeHiredSchema>;
export type EmployeeOnboardingInput = z.infer<typeof employeeOnboardingSchema>;
export type EmployeeActiveInput = z.infer<typeof employeeActiveSchema>;
export type EmployeeOffboardingInput = z.infer<
  typeof employeeOffboardingSchema
>;
export type EmployeeOffboardedInput = z.infer<typeof employeeOffboardedSchema>;
export type EmployeeHandoffInput = z.infer<typeof employeeHandoffSchema>;
