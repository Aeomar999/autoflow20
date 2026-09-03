import { NonRetriableError } from "inngest";
import { describe, expect, it, vi } from "vitest";
import { WEBHOOK_RESPONSE_KEY } from "@/inngest/trace";
import { withResolve } from "@/nodes/shared/test-params";
import type { StepTools } from "@/nodes/types";
import { execute } from "./execute";

/** The composed response the engine harvests off the returned context. */
type Composed = {
  statusCode: number;
  contentType: string;
  headers: Record<string, string>;
  body: string;
};

const composed = (result: Record<string, unknown>): Composed =>
  result[WEBHOOK_RESPONSE_KEY] as Composed;

describe("RESPOND_TO_WEBHOOK execute (AF-M9-10)", () => {
  const step = {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
  } as unknown as StepTools;
  const publish = vi.fn().mockResolvedValue(undefined);

  it("composes a response and leaves the rest of the context untouched", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          statusCode: 201,
          contentType: "application/json",
          body: '{"ok":true}',
        },
        userId: "user-1",
        context: { upstream: "value" },
        step,
        publish,
      }),
    );

    expect(composed(result)).toEqual({
      statusCode: 201,
      contentType: "application/json",
      headers: {},
      body: '{"ok":true}',
    });
    // A respond node is transparent: downstream nodes still see the context.
    expect(result.upstream).toBe("value");
  });

  it("defaults to 200 / application/json with an empty body", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {},
        userId: "user-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(composed(result).statusCode).toBe(200);
    expect(composed(result).contentType).toBe("application/json");
    expect(composed(result).body).toBe("");
  });

  it("resolves templates in the body", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: { body: '{"greeting":"hello {{name}}"}' },
        userId: "user-1",
        context: { name: "Ada" },
        step,
        publish,
      }),
    );

    expect(composed(result).body).toBe('{"greeting":"hello Ada"}');
  });

  it("resolves templates in header names and values", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: { headers: { "x-{{slug}}": "{{value}}" } },
        userId: "user-1",
        context: { slug: "trace-id", value: "abc123" },
        step,
        publish,
      }),
    );

    expect(composed(result).headers).toEqual({ "x-trace-id": "abc123" });
  });

  it("rejects a header a template resolved into a forbidden one", async () => {
    // Filtering happens AFTER resolution — this is the case a compose-time-only
    // check on the literal config would miss entirely.
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { headers: { "{{evil}}": "session=hijacked" } },
          userId: "user-1",
          context: { evil: "Set-Cookie" },
          step,
          publish,
        }),
      ),
    ).rejects.toThrow(NonRetriableError);
  });

  it("names every rejected header so the author can fix the config", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { headers: { "Set-Cookie": "a=b", Connection: "keep-alive" } },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toThrow(/set-cookie.*connection|connection.*set-cookie/i);
  });

  it("rejects an oversized body rather than truncating it", async () => {
    // ADR-0018's posture: a caller receiving half a JSON document gets a parse
    // error it cannot attribute. Fail loudly instead.
    const huge = "x".repeat(1_000_001);

    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { body: huge },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toThrow(/exceeding the 1000000-byte limit/);
  });

  it("measures the body cap in bytes, not characters", async () => {
    // 500_001 three-byte characters is ~1.5 MB — under the cap by length but
    // well over it by bytes. A length check would let this through.
    const multibyte = "世".repeat(500_001);

    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { body: multibyte },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toThrow(/exceeding the 1000000-byte limit/);
  });

  it("refuses a status code outside 200-599", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { statusCode: 100 },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toThrow(/not a valid response status/);
  });

  it("publishes an error status when composition fails", async () => {
    const localPublish = vi.fn().mockResolvedValue(undefined);

    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { headers: { "Set-Cookie": "a=b" } },
          userId: "user-1",
          context: {},
          step,
          publish: localPublish,
        }),
      ),
    ).rejects.toThrow(NonRetriableError);

    // A channel topic call returns a *promise* of the `{channel, topic, data}`
    // envelope, so the recorded argument has to be awaited before its payload
    // is readable.
    const statuses = await Promise.all(
      localPublish.mock.calls.map(async (call) => {
        const envelope = (await call[0]) as { data?: { status?: string } };
        return envelope?.data?.status;
      }),
    );
    expect(statuses).toEqual(["loading", "error"]);
  });
});
