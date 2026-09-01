import { beforeEach, describe, expect, it } from "vitest";
import {
  checkHealth,
  STUCK_RUN_DOWN_THRESHOLD,
  STUCK_RUN_THRESHOLD_MS,
} from "@/features/health/server/checks";
import prisma from "@/lib/db";

/**
 * AF-M8-07 against a real Postgres. The database probe is only meaningful
 * against a real connection, and the runner probe is the F1 detector - the
 * failure mode where every other surface looks healthy - so its thresholds are
 * worth pinning to real rows rather than to a mock.
 */

const hasDb = Boolean(process.env.TEST_DATABASE_URL);

const NOW = new Date("2026-09-01T12:00:00.000Z");

describe.runIf(hasDb)("health checks (AF-M8-07)", () => {
  let workflowId: string;

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "AiResponseCache","organization","member","invitation","workspace","WorkflowVersion","NodeExecution","Execution","Connection","Node","Workflow","Credential","user","session","account","verification" CASCADE`,
    );

    await prisma.user.create({
      data: {
        id: "user_health",
        email: "health@test.local",
        name: "Health",
        emailVerified: true,
      },
    });

    const org = await prisma.organization.create({
      data: {
        name: "Health Org",
        slug: "health-org",
        members: { create: { userId: "user_health", role: "OWNER" } },
      },
    });

    workflowId = (
      await prisma.workflow.create({
        data: {
          name: "Health WF",
          userId: "user_health",
          organizationId: org.id,
        },
      })
    ).id;
  });

  const seedRunning = async (count: number, ageMs: number) => {
    for (let i = 0; i < count; i += 1) {
      await prisma.execution.create({
        data: {
          workflowId,
          status: "RUNNING",
          startedAt: new Date(NOW.getTime() - ageMs),
          inngestEventId: `evt_health_${ageMs}_${i}`,
        },
      });
    }
  };

  it("reports ok against a reachable database with no stuck runs", async () => {
    const report = await checkHealth(NOW);

    expect(report.status).toBe("ok");
    expect(report.checks).toEqual([
      { name: "database", state: "ok" },
      { name: "runner", state: "ok" },
    ]);
  });

  it("does not count a recent RUNNING execution as stuck", async () => {
    await seedRunning(5, 60_000);

    const report = await checkHealth(NOW);

    expect(report.status).toBe("ok");
  });

  it("reports degraded once a run passes the stuck threshold", async () => {
    await seedRunning(1, STUCK_RUN_THRESHOLD_MS + 60_000);

    const report = await checkHealth(NOW);

    expect(report.status).toBe("degraded");
    expect(report.checks).toContainEqual({
      name: "runner",
      state: "degraded",
    });
    // The database is fine - a degraded runner must not be reported as a
    // database problem, or the runbook sends someone to the wrong place.
    expect(report.checks).toContainEqual({ name: "database", state: "ok" });
  });

  it("reports down once the queue is clearly not draining", async () => {
    await seedRunning(
      STUCK_RUN_DOWN_THRESHOLD,
      STUCK_RUN_THRESHOLD_MS + 60_000,
    );

    const report = await checkHealth(NOW);

    expect(report.status).toBe("down");
  });

  it("ignores terminal executions however old they are", async () => {
    await prisma.execution.create({
      data: {
        workflowId,
        status: "SUCCESS",
        startedAt: new Date(NOW.getTime() - 400 * 24 * 60 * 60 * 1000),
        inngestEventId: "evt_health_ancient",
      },
    });

    expect((await checkHealth(NOW)).status).toBe("ok");
  });

  it("never exposes connection details in the report", async () => {
    const serialized = JSON.stringify(await checkHealth(NOW));

    // The report reaches an unauthenticated endpoint; it carries verdicts only.
    expect(serialized).not.toMatch(/postgres|password|5432|@/i);
  });
});
