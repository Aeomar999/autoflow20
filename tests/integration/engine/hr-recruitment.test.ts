import { beforeEach, describe, expect, it, vi } from "vitest";
import { templateCatalog } from "@/features/templates/catalog";
import type { TemplateGraph } from "@/features/templates/server/instantiate";
import {
  ExecutionStatus,
  NodeExecutionStatus,
} from "@/generated/prisma/client";
import prisma from "@/lib/db";
import { runGraph } from "./run-graph";

vi.mock("@/nodes/ai/extract/execute", () => ({
  execute: vi.fn(async ({ data, context }) => {
    // Return a mocked successful AI response
    // Check context for trigger name
    const triggerData = (context.form as Record<string, unknown>) || {};
    const isUnqualified = ((triggerData.name as string) || "").includes(
      "Unqualified",
    );
    return {
      ...context,
      [data.variableName as string]: {
        qualified: !isUnqualified,
        score: isUnqualified ? 40 : 85,
        summary: "Candidate is a strong fit.",
      },
    };
  }),
}));

vi.mock("@/nodes/gmail/send/execute", () => ({
  execute: vi.fn(async () => {
    return { ok: true, messageId: "mock-message-id" };
  }),
}));

vi.mock("@/nodes/slack/post/execute", () => ({
  execute: vi.fn(async () => {
    return { ok: true, ts: "12345.678" };
  }),
}));

vi.mock("@/nodes/files/extract-text/execute", () => ({
  execute: vi.fn(async ({ data, context }) => {
    return {
      ...context,
      [data.variableName as string]: {
        text: "Mock extracted resume text",
        truncated: false,
      },
    };
  }),
}));

vi.mock(
  "@/features/executions/server/credential-resolver",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/executions/server/credential-resolver")
      >();
    return {
      ...actual,
      resolveNodeCredentials: vi.fn(async () => ({})), // Mock returning empty credentials
    };
  },
);

const hasDb = Boolean(process.env.TEST_DATABASE_URL);

describe.runIf(hasDb)("hr-lifecycle-phase-1-recruitment template", () => {
  beforeEach(async () => {
    await prisma.nodeExecution.deleteMany({});
    await prisma.execution.deleteMany({});
  });

  const getTemplateGraph = () => {
    const spec = templateCatalog.find(
      (t) => t.slug === "hr-lifecycle-phase-1-recruitment",
    );
    if (!spec) throw new Error("Template not found");
    return spec.graph as unknown as TemplateGraph;
  };

  it("exercises the TRUE path (Qualified)", async () => {
    const graph = getTemplateGraph();

    const { execution, nodeExecutions } = await runGraph(graph, {
      initialData: {
        form: {
          name: "Ada Lovelace",
          email: "ada@example.com",
          position: "Software Engineer",
          resume: "file-ref-123",
        },
      },
    });

    expect(execution.status).toBe(ExecutionStatus.SUCCESS);
    const byName = new Map(nodeExecutions.map((n) => [n.nodeName, n.status]));
    expect(byName.get("Extract Resume Text")).toBe(NodeExecutionStatus.SUCCESS);
    expect(byName.get("AI Resume Screening")).toBe(NodeExecutionStatus.SUCCESS);
    expect(byName.get("Qualified?")).toBe(NodeExecutionStatus.SUCCESS);

    // TRUE branch nodes
    expect(byName.get("Set Booking Link")).toBe(NodeExecutionStatus.SUCCESS);
    expect(byName.get("Send Interview Booking Email")).toBe(
      NodeExecutionStatus.SUCCESS,
    );
    expect(byName.get("Notify Recruiting - Qualified")).toBe(
      NodeExecutionStatus.SUCCESS,
    );

    // FALSE branch nodes
    expect(byName.get("Send Polite Rejection")).toBe(
      NodeExecutionStatus.SKIPPED,
    );
    expect(byName.get("Notify Recruiting - Not Qualified")).toBe(
      NodeExecutionStatus.SKIPPED,
    );
  });

  it("exercises the FALSE path (Not Qualified)", async () => {
    const graph = getTemplateGraph();

    const { execution, nodeExecutions } = await runGraph(graph, {
      initialData: {
        form: {
          name: "John Unqualified",
          email: "john@example.com",
          position: "Software Engineer",
          resume: "file-ref-456",
        },
      },
    });

    expect(execution.status).toBe(ExecutionStatus.SUCCESS);
    const byName = new Map(nodeExecutions.map((n) => [n.nodeName, n.status]));
    expect(byName.get("Extract Resume Text")).toBe(NodeExecutionStatus.SUCCESS);
    expect(byName.get("AI Resume Screening")).toBe(NodeExecutionStatus.SUCCESS);
    expect(byName.get("Qualified?")).toBe(NodeExecutionStatus.SUCCESS);

    // FALSE branch nodes
    expect(byName.get("Send Polite Rejection")).toBe(
      NodeExecutionStatus.SUCCESS,
    );
    expect(byName.get("Notify Recruiting - Not Qualified")).toBe(
      NodeExecutionStatus.SUCCESS,
    );

    // TRUE branch nodes
    expect(byName.get("Set Booking Link")).toBe(NodeExecutionStatus.SKIPPED);
    expect(byName.get("Send Interview Booking Email")).toBe(
      NodeExecutionStatus.SKIPPED,
    );
    expect(byName.get("Notify Recruiting - Qualified")).toBe(
      NodeExecutionStatus.SKIPPED,
    );
  });
});
