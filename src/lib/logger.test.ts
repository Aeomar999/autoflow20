import { afterEach, describe, expect, it, vi } from "vitest";
import { isSensitiveKey, logger, REDACTED, redact } from "./logger";

describe("redact", () => {
  it("redacts sensitive keys at any depth", () => {
    const input = {
      user: { name: "jerry", apiKey: "sk_123", nested: { authToken: "t" } },
    };
    const output = redact(input) as {
      user: { name: string; apiKey: string; nested: { authToken: string } };
    };
    expect(output.user.name).toBe("jerry");
    expect(output.user.apiKey).toBe(REDACTED);
    expect(output.user.nested.authToken).toBe(REDACTED);
  });

  it("redacts inside arrays and keeps safe values", () => {
    const output = redact({
      items: [{ password: "p", ok: 1 }],
    }) as { items: { password: string; ok: number }[] };
    expect(output.items[0].password).toBe(REDACTED);
    expect(output.items[0].ok).toBe(1);
  });

  it("converts errors to plain objects", () => {
    const output = redact(new Error("boom")) as Record<string, unknown>;
    expect(output.message).toBe("boom");
    expect(output.name).toBe("Error");
  });

  it("matches key pattern case-insensitively", () => {
    expect(isSensitiveKey("AUTHORIZATION")).toBe(true);
    expect(isSensitiveKey("private_key")).toBe(true);
    expect(isSensitiveKey("stripeSecret")).toBe(true);
    expect(isSensitiveKey("workflowId")).toBe(false);
  });
});

describe("logger", () => {
  const originalLevel = process.env.LOG_LEVEL;

  afterEach(() => {
    if (originalLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalLevel;
    }
    vi.restoreAllMocks();
  });

  it("emits JSON lines with redacted context", () => {
    process.env.LOG_LEVEL = "debug";
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});

    logger.info("hello", { secret: "s", plain: 1 });

    expect(spy).toHaveBeenCalledOnce();
    const line = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe("info");
    expect(parsed.context.secret).toBe(REDACTED);
    expect(parsed.context.plain).toBe(1);
  });

  it("suppresses debug below the configured level", () => {
    process.env.LOG_LEVEL = "warn";
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    logger.debug("hidden");

    expect(spy).not.toHaveBeenCalled();
  });
});
