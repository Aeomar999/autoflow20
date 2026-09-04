import { NonRetriableError, RetryAfterError } from "inngest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyQboError,
  escapeQboQuery,
  QBO_MINOR_VERSION,
  qboFetch,
  qboQuery,
  resolveQboConnection,
} from "./qbo-client";

const sandboxSecret = {
  accessToken: "token",
  realmId: "4620816365",
  environment: "sandbox",
};

/** Captures requests and answers with what the test wants. */
function stubQbo(responses: unknown[]): { calls: URL[] } {
  const calls: URL[] = [];
  let index = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation((async (
    input: RequestInfo | URL,
  ) => {
    calls.push(new URL(String(input)));
    const body = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch);
  return { calls };
}

describe("escapeQboQuery (AF-M10-16)", () => {
  it("escapes an apostrophe so a customer name cannot end the query", () => {
    // The acceptance names this case. A value goes into a single-quoted
    // string in QBO's query language; unescaped, the apostrophe closes the
    // string and the remainder is parsed as syntax.
    expect(escapeQboQuery("O'Brien Ltd")).toBe("O\\'Brien Ltd");
  });

  it("escapes a backslash before the quote it could otherwise escape", () => {
    // Escaping the quote first would leave `a\\'b`, where the backslash the
    // caller supplied consumes the one we added and the quote is live again.
    expect(escapeQboQuery("a\\'b")).toBe("a\\\\\\'b");
  });

  it("leaves an ordinary name alone", () => {
    expect(escapeQboQuery("Acme Industries")).toBe("Acme Industries");
  });
});

describe("resolveQboConnection (AF-M10-16)", () => {
  it("takes the base URL from the credential's environment", () => {
    // Sandbox vs production is a property of the CONNECTION. The source
    // templates make it node config, which is how a workflow ends up pointed
    // at a sandbox company after someone copies it into production.
    const connection = resolveQboConnection(sandboxSecret, "test");
    expect(connection.baseUrl).toBe(
      "https://sandbox-quickbooks.api.intuit.com/v3/company/4620816365",
    );
    expect(connection.environment).toBe("sandbox");
  });

  it('treats anything that is not exactly "sandbox" as production', () => {
    const connection = resolveQboConnection(
      { accessToken: "t", realmId: "9", environment: "Sandbox" },
      "test",
    );
    // Failing loudly against the real company beats silently succeeding
    // against a company that does not exist.
    expect(connection.baseUrl).toContain("https://quickbooks.api.intuit.com");
  });

  it("refuses a credential with no company id", () => {
    expect(() =>
      resolveQboConnection({ accessToken: "t" }, "Test node"),
    ).toThrow(/company id/i);
  });

  it("refuses a node with no credential bound", () => {
    expect(() => resolveQboConnection(undefined, "Test node")).toThrow(
      NonRetriableError,
    );
  });
});

describe("qboFetch (AF-M10-16)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("pins the minor version on every request", async () => {
    // Unpinned, a response field can vanish on Intuit's schedule with no
    // deploy on our side.
    const { calls } = stubQbo([{ Customer: { Id: "1" } }]);

    await qboFetch(resolveQboConnection(sandboxSecret, "test"), {
      path: "customer/1",
      where: "test",
    });

    expect(calls[0].searchParams.get("minorversion")).toBe(
      String(QBO_MINOR_VERSION),
    );
  });
});

describe("classifyQboError (AF-M10-16)", () => {
  it("retries a throttle", () => {
    // The acceptance requires both directions be covered: getting this
    // backwards either burns the connection's quota or fails a run that
    // would have succeeded a minute later.
    expect(
      classifyQboError({ status: 429, message: "Throttle exceeded" }),
    ).toBeInstanceOf(RetryAfterError);
  });

  it("retries a server error", () => {
    expect(
      classifyQboError({ status: 503, message: "Service unavailable" }),
    ).toBeInstanceOf(RetryAfterError);
  });

  it("does not retry an auth failure", () => {
    const error = classifyQboError({ status: 401, message: "Unauthorized" });
    expect(error).toBeInstanceOf(NonRetriableError);
    expect(error.message).toMatch(/reconnect/i);
  });

  it("does not retry a permission refusal", () => {
    expect(
      classifyQboError({ status: 403, message: "Forbidden" }),
    ).toBeInstanceOf(NonRetriableError);
  });

  it("names the duplicate-name case, which QBO reports uselessly", () => {
    // Intuit's own message for 6240 is "Business Validation Error", which
    // tells the user nothing about what to change.
    const error = classifyQboError({
      status: 400,
      message: "Business Validation Error",
      code: "6240",
      detail: "Duplicate Name Exists in the table",
    });
    expect(error).toBeInstanceOf(NonRetriableError);
    expect(error.message).toMatch(/QBO_FIND_CUSTOMER/);
  });
});

describe("qboQuery pagination (AF-M10-16)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("starts at position 1, not 0", async () => {
    // QBO's STARTPOSITION is 1-indexed and treats 0 as 1. A loop starting at
    // 0 and adding the page size re-reads the first page's tail forever —
    // an infinite loop that looks like a working one.
    const { calls } = stubQbo([{ QueryResponse: { Customer: [{ Id: "1" }] } }]);

    await qboQuery(resolveQboConnection(sandboxSecret, "test"), {
      select: "SELECT * FROM Customer",
      entity: "Customer",
      limit: 10,
      where: "test",
    });

    expect(calls[0].searchParams.get("query")).toContain("STARTPOSITION 1");
  });

  it("stops on a short page, which is QBO's only end-of-results signal", async () => {
    const { calls } = stubQbo([
      { QueryResponse: { Customer: [{ Id: "1" }, { Id: "2" }] } },
    ]);

    const result = await qboQuery<{ Id: string }>(
      resolveQboConnection(sandboxSecret, "test"),
      {
        select: "SELECT * FROM Customer",
        entity: "Customer",
        limit: 100,
        where: "test",
      },
    );

    expect(result.items).toHaveLength(2);
    expect(result.truncated).toBe(false);
    // One request: a second would have re-read the same two rows.
    expect(calls).toHaveLength(1);
  });

  it("reports truncation rather than implying it returned everything", async () => {
    stubQbo([{ QueryResponse: { Customer: [{ Id: "1" }, { Id: "2" }] } }]);

    const result = await qboQuery<{ Id: string }>(
      resolveQboConnection(sandboxSecret, "test"),
      {
        select: "SELECT * FROM Customer",
        entity: "Customer",
        limit: 2,
        where: "test",
      },
    );

    expect(result.items).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("survives a query response with no rows for the entity", async () => {
    // QBO omits the entity key entirely when nothing matched, rather than
    // returning an empty array.
    stubQbo([{ QueryResponse: {} }]);

    const result = await qboQuery(resolveQboConnection(sandboxSecret, "test"), {
      select: "SELECT * FROM Customer WHERE DisplayName = 'nobody'",
      entity: "Customer",
      limit: 10,
      where: "test",
    });

    expect(result.items).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});
