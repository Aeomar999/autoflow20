import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyEmployeeHandoff } from "@/features/employees/server/handoff";
import { templateCatalog } from "@/features/templates/catalog";
import type { TemplateSpec } from "@/features/templates/catalog/types";
import { execute as manualTrigger } from "@/nodes/core/manual-trigger/execute";
import { execute as employeeActive } from "@/nodes/people/employee-active/execute";
import { execute as employeeOffboarded } from "@/nodes/people/employee-offboarded/execute";
import { execute as employeeOffboarding } from "@/nodes/people/employee-offboarding/execute";
import { execute as employeeOnboarding } from "@/nodes/people/employee-onboarding/execute";
import { withResolve } from "@/nodes/shared/test-params";
import type { NodeRun, NodeRunParams, StepTools } from "@/nodes/types";

/**
 * AF-M11-12 — the chain is demoable in-editor, proven rather than asserted.
 *
 * The four phase templates each start at a `MANUAL_TRIGGER` whose JSON payload
 * stands in for the previous phase's handoff (M4 payload injection). This
 * suite runs that trigger for real, then feeds the context it produces into
 * each phase's lifecycle node with its authored config — so a template payload
 * key drifting away from a node's expression fails here instead of failing a
 * user on their first run.
 *
 * The handoff layer is mocked: what is under test is the WIRING (does the
 * payload reach the node fully resolved), not the DB transition, which
 * `handoff` and the node suites already cover.
 */

vi.mock("@/features/employees/server/handoff", () => ({
  applyEmployeeHandoff: vi.fn(),
}));

const handoffMock = vi.mocked(applyEmployeeHandoff);

/** The one subject every phase template shares, so the chain runs in order. */
const DEMO_EMPLOYEE_REF = "EMP-ADA-009";

const PHASE_TEMPLATES = {
  W2: "onboard-new-hire",
  W3: "tenure-check-ins",
  W4: "offboard-employee-lifecycle",
} as const;

const step = {
  run: vi.fn((_name: string, fn: () => unknown) => fn()),
} as unknown as StepTools;
const publish = vi.fn().mockResolvedValue(undefined);

const templateBySlug = (slug: string): TemplateSpec => {
  const spec = templateCatalog.find((entry) => entry.slug === slug);
  if (!spec) throw new Error(`template "${slug}" is not in the catalogue`);
  return spec;
};

const nodeById = (spec: TemplateSpec, id: string) => {
  const node = spec.graph.nodes.find((entry) => entry.id === id);
  if (!node) throw new Error(`${spec.slug} has no node "${id}"`);
  return node;
};

/** Run the template's own manual trigger to build the run context. */
const triggerContext = async (slug: string) => {
  const spec = templateBySlug(slug);
  const trigger = spec.graph.nodes.find((n) => n.type === "MANUAL_TRIGGER");
  if (!trigger) throw new Error(`${slug} has no MANUAL_TRIGGER`);

  return manualTrigger(
    withResolve({
      nodeId: trigger.id,
      data: trigger.data as { payload?: string },
      userId: "user-1",
      organizationId: "org-1",
      context: {},
      step,
      publish,
    }) as NodeRunParams<{ payload?: string }>,
  );
};

/** Run one lifecycle node with its authored config against that context. */
const runPhaseNode = async (
  slug: string,
  nodeId: string,
  run: NodeRun<never>,
) => {
  const context = await triggerContext(slug);
  const node = nodeById(templateBySlug(slug), nodeId);

  await (run as NodeRun<Record<string, unknown>>)(
    withResolve({
      nodeId: node.id,
      data: (node.data ?? {}) as Record<string, unknown>,
      userId: "user-1",
      organizationId: "org-1",
      context,
      step,
      publish,
    }),
  );

  const call = handoffMock.mock.calls.at(-1);
  if (!call) throw new Error(`${slug}/${nodeId} did not apply a handoff`);
  return call[1] as Record<string, unknown>;
};

/** No field may still hold an unresolved `{{ … }}` or an empty string. */
const expectFullyResolved = (input: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== "string") continue;
    expect(value, `${key} still holds an unresolved expression`).not.toMatch(
      /\{\{/,
    );
    expect(value, `${key} resolved to an empty string`).not.toBe("");
  }
};

describe("employee lifecycle chain (AF-M11-12)", () => {
  beforeEach(() => {
    handoffMock.mockReset();
    handoffMock.mockResolvedValue({
      outcome: "already-current",
      employee: { id: "emp-1" },
      status: "OFFERED",
    } as unknown as Awaited<ReturnType<typeof applyEmployeeHandoff>>);
  });

  it("gives every phase template a manual trigger carrying the same employeeRef", () => {
    for (const slug of Object.values(PHASE_TEMPLATES)) {
      const spec = templateBySlug(slug);
      const trigger = spec.graph.nodes.find((n) => n.type === "MANUAL_TRIGGER");
      expect(trigger, `${slug} has no MANUAL_TRIGGER`).toBeDefined();

      const payload = JSON.parse(
        (trigger?.data as { payload?: string })?.payload ?? "{}",
      );
      // A different ref per phase is what makes a chain un-runnable without
      // hand-editing between templates — the thing AF-M11-12 exists to fix.
      expect(payload.employeeRef, `${slug} payload employeeRef`).toBe(
        DEMO_EMPLOYEE_REF,
      );
    }
  });

  it("W2: the trigger payload drives EMPLOYEE_ONBOARDING", async () => {
    const input = await runPhaseNode(
      PHASE_TEMPLATES.W2,
      "onboarding",
      employeeOnboarding,
    );

    expect(input).toEqual({
      event: "employee.onboarding",
      employeeRef: DEMO_EMPLOYEE_REF,
    });
  });

  it("W2: the trigger payload drives EMPLOYEE_ACTIVE", async () => {
    const input = await runPhaseNode(
      PHASE_TEMPLATES.W2,
      "active",
      employeeActive,
    );

    expect(input).toMatchObject({
      event: "employee.active",
      employeeRef: DEMO_EMPLOYEE_REF,
    });
    expectFullyResolved(input);
  });

  it("W3 is enrichment-only — it authors no lifecycle node", () => {
    const spec = templateBySlug(PHASE_TEMPLATES.W3);
    const lifecycleTypes = spec.graph.nodes
      .map((node) => node.type)
      .filter((type) => type.startsWith("EMPLOYEE_"));

    // Tenure notifies and carries context; mutating `status` there would put a
    // second, ungated writer on the chain.
    expect(lifecycleTypes).toEqual([]);
  });

  it("W4: the trigger payload drives EMPLOYEE_OFFBOARDING", async () => {
    const input = await runPhaseNode(
      PHASE_TEMPLATES.W4,
      "offboarding",
      employeeOffboarding,
    );

    expect(input).toMatchObject({
      event: "employee.offboarding",
      employeeRef: DEMO_EMPLOYEE_REF,
      exitDate: "2027-01-15",
      exitReason: "Resigned to join a startup",
    });
    expectFullyResolved(input);
  });

  it("W4: the trigger payload drives EMPLOYEE_OFFBOARDED", async () => {
    const input = await runPhaseNode(
      PHASE_TEMPLATES.W4,
      "offboarded",
      employeeOffboarded,
    );

    expect(input).toMatchObject({
      event: "employee.offboarded",
      employeeRef: DEMO_EMPLOYEE_REF,
    });
    expectFullyResolved(input);
  });
});
