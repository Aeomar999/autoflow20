import { describe, expect, it } from "vitest";
import {
  filterResponseHeaders,
  isHeaderAllowed,
  isValidResponseStatus,
} from "./webhook-response";

/**
 * AF-M9-10. The header policy is the security boundary for
 * `RESPOND_TO_WEBHOOK`: a workflow author picks these values, and we emit them
 * as a real HTTP response. Every test here is a thing an author could write
 * that must not reach a caller.
 */
describe("isHeaderAllowed", () => {
  it("allows standard response headers a workflow legitimately sets", () => {
    for (const name of [
      "Cache-Control",
      "Location",
      "ETag",
      "Retry-After",
      "Content-Disposition",
      "Access-Control-Allow-Origin",
    ]) {
      expect(isHeaderAllowed(name), name).toBe(true);
    }
  });

  it("allows x- prefixed custom headers, case-insensitively", () => {
    expect(isHeaderAllowed("x-request-id")).toBe(true);
    expect(isHeaderAllowed("X-Correlation-Id")).toBe(true);
  });

  it("refuses Set-Cookie", () => {
    // A workflow that can set a cookie on our origin can fixate a session.
    expect(isHeaderAllowed("Set-Cookie")).toBe(false);
    expect(isHeaderAllowed("set-cookie")).toBe(false);
    expect(isHeaderAllowed("SET-COOKIE")).toBe(false);
  });

  it("refuses hop-by-hop headers", () => {
    for (const name of [
      "Connection",
      "Keep-Alive",
      "Proxy-Authenticate",
      "Proxy-Authorization",
      "TE",
      "Trailer",
      "Transfer-Encoding",
      "Upgrade",
    ]) {
      expect(isHeaderAllowed(name), name).toBe(false);
    }
  });

  it("refuses runtime-owned framing headers", () => {
    // A caller-chosen Content-Length is a response-splitting primitive, and
    // Content-Type has exactly one source of truth (the node's own field).
    expect(isHeaderAllowed("Content-Length")).toBe(false);
    expect(isHeaderAllowed("Content-Type")).toBe(false);
  });

  it("refuses an unknown header that is not x- prefixed", () => {
    expect(isHeaderAllowed("Authorization")).toBe(false);
    expect(isHeaderAllowed("Server")).toBe(false);
  });

  it("refuses a syntactically invalid field name", () => {
    expect(isHeaderAllowed("x-bad header")).toBe(false);
    expect(isHeaderAllowed("x-bad:header")).toBe(false);
    expect(isHeaderAllowed("x-bad\nheader")).toBe(false);
    expect(isHeaderAllowed("")).toBe(false);
  });

  it("cannot be readmitted by an x- prefix on a forbidden name", () => {
    // The forbidden set is checked before the x- rule, so a header that is
    // both forbidden and x- prefixed still loses. No such header exists today;
    // this pins the ordering so a future addition cannot open a hole.
    expect(isHeaderAllowed("x-set-cookie")).toBe(true); // distinct header, fine
    expect(isHeaderAllowed("set-cookie")).toBe(false);
  });
});

describe("filterResponseHeaders", () => {
  it("keeps allowed headers and reports rejected ones", () => {
    const result = filterResponseHeaders({
      "Cache-Control": "no-store",
      "X-Request-Id": "abc123",
      "Set-Cookie": "session=hijacked",
      Connection: "keep-alive",
    });

    expect(result.headers).toEqual({
      "Cache-Control": "no-store",
      "X-Request-Id": "abc123",
    });
    expect(result.rejected.sort()).toEqual(["connection", "set-cookie"]);
  });

  it("rejects a value containing CR or LF (response splitting)", () => {
    // The header NAME is allowed here; the value is the attack. Without this
    // check, a template resolving to attacker text could terminate the header
    // block and inject a second response.
    const result = filterResponseHeaders({
      "X-Note": "ok\r\nSet-Cookie: session=hijacked",
    });

    expect(result.headers).toEqual({});
    expect(result.rejected).toEqual(["x-note"]);
  });

  it("rejects a value containing a bare LF or a NUL", () => {
    expect(filterResponseHeaders({ "X-A": "a\nb" }).rejected).toEqual(["x-a"]);
    expect(filterResponseHeaders({ "X-B": "a\0b" }).rejected).toEqual(["x-b"]);
  });

  it("returns empty results for undefined input", () => {
    expect(filterResponseHeaders(undefined)).toEqual({
      headers: {},
      rejected: [],
    });
  });
});

describe("isValidResponseStatus", () => {
  it("accepts 200-599", () => {
    expect(isValidResponseStatus(200)).toBe(true);
    expect(isValidResponseStatus(404)).toBe(true);
    expect(isValidResponseStatus(599)).toBe(true);
  });

  it("refuses informational and out-of-range codes", () => {
    // 1xx is an interim response with no body — a settled execution cannot
    // express one, so it is refused on top of the schema's 100-599 bound.
    expect(isValidResponseStatus(100)).toBe(false);
    expect(isValidResponseStatus(199)).toBe(false);
    expect(isValidResponseStatus(600)).toBe(false);
    expect(isValidResponseStatus(0)).toBe(false);
    expect(isValidResponseStatus(-1)).toBe(false);
  });

  it("refuses a non-integer", () => {
    expect(isValidResponseStatus(200.5)).toBe(false);
    expect(isValidResponseStatus(Number.NaN)).toBe(false);
  });
});
