import { describe, expect, it } from "vitest";
import {
  HEALTH_HTTP_STATUS,
  type HealthCheck,
  runCheck,
  summarizeHealth,
} from "./health";

const check = (name: string, state: HealthCheck["state"]): HealthCheck => ({
  name,
  state,
});

describe("summarizeHealth", () => {
  it("is ok when every check is ok", () => {
    expect(
      summarizeHealth([check("database", "ok"), check("runner", "ok")]).status,
    ).toBe("ok");
  });

  it("takes the worst state, not the most common one", () => {
    expect(
      summarizeHealth([
        check("database", "ok"),
        check("runner", "degraded"),
        check("other", "ok"),
      ]).status,
    ).toBe("degraded");
  });

  it("reports down when any check is down, even alongside a degraded one", () => {
    expect(
      summarizeHealth([check("runner", "degraded"), check("database", "down")])
        .status,
    ).toBe("down");
  });

  it("preserves the checks it was given", () => {
    const checks = [check("database", "ok"), check("runner", "degraded")];
    expect(summarizeHealth(checks).checks).toEqual(checks);
  });

  it("reports down for an empty check list rather than a cheerful ok", () => {
    // No evidence of health is not evidence of health. An empty list means
    // the checks did not run, which is a fault, not a pass.
    expect(summarizeHealth([]).status).toBe("down");
  });
});

describe("HEALTH_HTTP_STATUS", () => {
  it("maps ok to 200 so an uptime monitor sees a pass", () => {
    expect(HEALTH_HTTP_STATUS.ok).toBe(200);
  });

  it("maps degraded to 200 - the service is still serving", () => {
    expect(HEALTH_HTTP_STATUS.degraded).toBe(200);
  });

  it("maps down to 503 so a load balancer takes the instance out", () => {
    expect(HEALTH_HTTP_STATUS.down).toBe(503);
  });
});

describe("runCheck", () => {
  it("returns the state the probe resolved to", async () => {
    await expect(runCheck("database", async () => "ok")).resolves.toEqual({
      name: "database",
      state: "ok",
    });
  });

  it("reports down when the probe throws, never propagating the error", async () => {
    await expect(
      runCheck("database", async () => {
        throw new Error("connection refused to 10.0.0.4:5432");
      }),
    ).resolves.toEqual({ name: "database", state: "down" });
  });

  it("does not leak the thrown message into the result", async () => {
    const result = await runCheck("database", async () => {
      throw new Error("password authentication failed for user 'autoflow'");
    });

    expect(JSON.stringify(result)).not.toContain("password");
  });

  it("reports down when the probe exceeds its timeout", async () => {
    const result = await runCheck(
      "slow",
      () => new Promise<"ok">((resolve) => setTimeout(() => resolve("ok"), 50)),
      { timeoutMs: 10 },
    );

    expect(result.state).toBe("down");
  });

  it("returns the probe's own degraded verdict untouched", async () => {
    await expect(runCheck("runner", async () => "degraded")).resolves.toEqual({
      name: "runner",
      state: "degraded",
    });
  });
});
