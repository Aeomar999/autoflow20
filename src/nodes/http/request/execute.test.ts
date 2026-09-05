import { describe, expect, it, vi } from "vitest";
import type { NodeRunParams } from "@/nodes/types";

/**
 * HTTP_REQUEST executor (AF-M10-01).
 *
 * The egress guard is mocked at the module boundary rather than at
 * `globalThis.fetch`: the real guard does a DNS lookup and pins the socket to
 * the resolved addresses, which a unit test has no business doing. What this
 * suite proves is the layer above it — that auth is built from the resolved
 * credential map, lands on the request, and never reaches the value the engine
 * persists into `NodeExecution.output`.
 *
 * `createSafeFetch`'s own redirect behaviour is covered by
 * `egress-guard.test.ts`; here we only assert the node hands it the header
 * names to strip.
 */

const { capture, createSafeFetchMock } = vi.hoisted(() => {
  const capture: {
    url?: URL;
    headers?: Record<string, string>;
    credentialHeaders?: readonly string[];
    body?: unknown;
  } = {};

  const createSafeFetchMock = vi.fn(
    (options: { credentialHeaders?: readonly string[] } = {}) => {
      capture.credentialHeaders = options.credentialHeaders;
      return async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        capture.url = new URL(request.url);
        capture.headers = Object.fromEntries(request.headers.entries());
        capture.body = await request.text();
        // Echo the request back, the way httpbin and most API gateways do.
        // This is the shape that used to write a credential into the trace.
        return new Response(
          JSON.stringify({ echoedHeaders: capture.headers }),
          {
            status: 200,
            statusText: "OK",
            headers: { "content-type": "application/json" },
          },
        );
      };
    },
  );

  return { capture, createSafeFetchMock };
});

vi.mock("@/features/executions/components/http-request/egress-guard", () => ({
  assertSafeEndpoint: async (raw: string) => new URL(raw),
  createSafeFetch: createSafeFetchMock,
  readCappedText: async (response: Response) => response.text(),
  resolveTimeoutMs: (input?: number) => input ?? 10_000,
}));

vi.mock("@/inngest/channels/http-request", () => ({
  httpRequestChannel: () => ({ status: (payload: unknown) => payload }),
}));

import { withResolve } from "@/nodes/shared/test-params";
import { execute } from "./execute";

const step = {
  run: async <T>(_id: string, fn: () => Promise<T>): Promise<T> => fn(),
} as unknown as NodeRunParams["step"];

const publish = vi.fn(async () => {});

const run = (
  data: Record<string, unknown>,
  credentials?: NodeRunParams["credentials"],
) =>
  execute(
    withResolve({
      data,
      nodeId: "node_http",
      userId: "user_1",
      organizationId: "org_1",
      context: {},
      step,
      publish,
      credentials,
    }) as unknown as NodeRunParams,
  );

const baseData = {
  variableName: "api",
  endpoint: "https://api.example.com/v1/things",
  method: "GET" as const,
};

describe("HTTP_REQUEST executor auth (AF-M10-01)", () => {
  it("sends no Authorization when no auth mode is configured", async () => {
    await run(baseData);
    expect(capture.headers?.authorization).toBeUndefined();
    expect(capture.credentialHeaders).toEqual([]);
  });

  it("applies a bearer credential from the resolved credential map", async () => {
    await run(
      { ...baseData, credentialId: "cred_1", authMode: "bearer" },
      { credentialId: { token: "tok_live_abcdef123456" } },
    );
    expect(capture.headers?.authorization).toBe("Bearer tok_live_abcdef123456");
  });

  it("puts queryParam auth on the URL", async () => {
    await run(
      {
        ...baseData,
        credentialId: "cred_1",
        authMode: "queryParam",
        authQueryParam: "key",
      },
      { credentialId: { apiKey: "gcs_key_abcdef" } },
    );
    expect(capture.url?.searchParams.get("key")).toBe("gcs_key_abcdef");
    expect(capture.headers?.authorization).toBeUndefined();
  });

  it("reports a custom auth header to the guard so a redirect drops it", async () => {
    await run(
      {
        ...baseData,
        credentialId: "cred_1",
        authMode: "header",
        authHeaderName: "X-API-Key",
      },
      { credentialId: { apiKey: "key_abcdef123456" } },
    );
    expect(capture.headers?.["x-api-key"]).toBe("key_abcdef123456");
    // The acceptance rule: an auth header must not follow a cross-origin
    // redirect, and `X-API-Key` is not in the fetch spec's default list.
    expect(capture.credentialHeaders).toEqual(["x-api-key"]);
  });

  it("never reads the secret from node config", async () => {
    // A secret pasted into config would already be in `NodeExecution.input`
    // before the executor ran. The executor must ignore it entirely.
    await expect(
      run({
        ...baseData,
        credentialId: "cred_1",
        authMode: "bearer",
        token: "tok_from_config_should_be_ignored",
      }),
    ).rejects.toThrow(/no credential is bound/i);
  });

  it("lets the credential win over a templated header of the same name", async () => {
    await run(
      {
        ...baseData,
        headers: { Authorization: "Bearer stale-hand-written-value" },
        credentialId: "cred_1",
        authMode: "bearer",
        method: "GET",
      },
      { credentialId: { token: "tok_live_abcdef123456" } },
    );
    expect(capture.headers?.authorization).toBe("Bearer tok_live_abcdef123456");
  });

  it("keeps the secret out of the value the engine persists", async () => {
    // The fixture echoes the request headers into the response body — the
    // exact shape that used to put a live token in `NodeExecution.output`.
    const secret = "tok_live_abcdef123456";
    const result = await run(
      { ...baseData, credentialId: "cred_1", authMode: "bearer" },
      { credentialId: { token: secret } },
    );

    expect(capture.headers?.authorization).toBe(`Bearer ${secret}`);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).toContain("[redacted]");
  });

  it("redacts basic auth in both its raw and encoded forms", async () => {
    const password = "hunter2-long-password";
    const encoded = Buffer.from(`alice:${password}`).toString("base64");
    const result = await run(
      { ...baseData, credentialId: "cred_1", authMode: "basic" },
      { credentialId: { username: "alice", password } },
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(password);
    expect(serialized).not.toContain(encoded);
  });

  it("still runs an unauthenticated POST exactly as before AF-M10-01", async () => {
    const result = await run({
      variableName: "api",
      endpoint: "https://api.example.com/v1/things",
      method: "POST",
      body: JSON.stringify({ name: "Alice" }),
    });
    expect(capture.body).toBe(JSON.stringify({ name: "Alice" }));
    expect(capture.headers?.["content-type"]).toBe("application/json");
    expect(
      (result.api as { httpResponse: { status: number } }).httpResponse.status,
    ).toBe(200);
  });
});
