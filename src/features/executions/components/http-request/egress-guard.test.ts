import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertSafeEndpoint,
  DEFAULT_HTTP_TIMEOUT_MS,
  expandIpv6,
  isBlockedIp,
  MAX_HTTP_TIMEOUT_MS,
  MAX_REDIRECT_HOPS,
  MAX_RESPONSE_BYTES,
  pinnedDispatcher,
  readCappedText,
  resolveTimeoutMs,
  safeFetch,
} from "./egress-guard";

describe("isBlockedIp — IPv4 ranges", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["127.8.4.2", "loopback range"],
    ["10.1.2.3", "private 10/8"],
    ["172.16.0.1", "private 172.16/12 lower"],
    ["172.31.255.255", "private 172.16/12 upper"],
    ["192.168.1.1", "private 192.168/16"],
    ["169.254.169.254", "cloud metadata IP"],
    ["169.254.0.1", "link-local"],
    ["0.0.0.0", "unspecified"],
    ["100.64.0.1", "CGNAT"],
  ])("blocks %s (%s)", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each([
    ["93.184.216.34", "public unicast"],
    ["8.8.8.8", "public resolver"],
    ["172.32.0.1", "just outside 172.16/12"],
    ["198.51.100.7", "public documentation range"],
  ])("allows %s (%s)", (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });
});

describe("isBlockedIp — IPv6", () => {
  it.each([
    ["::1", "IPv6 loopback"],
    ["::", "unspecified"],
    ["fc00::1", "unique local fc00::/7"],
    ["fd12:3456:789a::1", "unique local fd00::/8"],
    ["fe80::1", "link-local fe80::/10"],
    ["::ffff:192.168.0.1", "IPv4-mapped private"],
    ["::ffff:127.0.0.1", "IPv4-mapped loopback"],
    ["not-an-ip", "unparseable fails closed"],
  ])("blocks %s (%s)", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it("allows a global unicast address", () => {
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
  });
});

describe("expandIpv6", () => {
  it("expands :: to eight zero groups", () => {
    expect(expandIpv6("::")).toBe("0000:0000:0000:0000:0000:0000:0000:0000");
  });

  it("expands compressed middle groups", () => {
    expect(expandIpv6("2001:db8::1")).toBe(
      "2001:0db8:0000:0000:0000:0000:0000:0001",
    );
  });
});

describe("assertSafeEndpoint", () => {
  it("rejects non-http schemes", async () => {
    await expect(assertSafeEndpoint("ftp://93.184.216.34/x")).rejects.toThrow(
      /scheme/,
    );
    await expect(assertSafeEndpoint("file:///etc/passwd")).rejects.toThrow(
      /scheme/,
    );
  });

  it("rejects embedded credentials", async () => {
    await expect(
      assertSafeEndpoint("https://user:pass@example.com"),
    ).rejects.toThrow(/credentials/);
  });

  it("rejects hosts that resolve to blocked addresses", async () => {
    await expect(assertSafeEndpoint("http://127.0.0.1/x")).rejects.toThrow(
      /blocked/,
    );
    await expect(
      assertSafeEndpoint("http://169.254.169.254/latest/meta-data"),
    ).rejects.toThrow(/blocked/);
    await expect(assertSafeEndpoint("http://localhost/x")).rejects.toThrow(
      /blocked|resolve/i,
    );
  });

  it("rejects malformed URLs and unresolvable hosts", async () => {
    await expect(assertSafeEndpoint("not a url")).rejects.toThrow(
      /invalid endpoint/,
    );
    await expect(
      assertSafeEndpoint("https://this-host-does-not-exist-af.invalid"),
    ).rejects.toThrow();
  });

  it("accepts a public literal-IP endpoint", async () => {
    const url = await assertSafeEndpoint("https://8.8.8.8/dns-query");
    expect(url.hostname).toBe("8.8.8.8");
  });
});

/**
 * AF-M9-02: the test-only `ALLOW_LOOPBACK_EGRESS` flag lets the engine's
 * acceptance suite run a loopback webhook/target server. It widens ONLY
 * loopback (`127/8`, `::1`) — metadata (`169.254.169.254`), private, and
 * CGNAT ranges stay blocked under the flag.
 */
describe("isBlockedIp — ALLOW_LOOPBACK_EGRESS", () => {
  it("blocks loopback by default (flag unset/off)", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("::1")).toBe(true);
    expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true);
  });

  it("still blocks loopback even when allowed is not requested", () => {
    expect(isBlockedIp("127.0.0.1", { allowLoopback: false })).toBe(true);
  });

  it("allows loopback when allowLoopback is requested", () => {
    expect(isBlockedIp("127.0.0.1", { allowLoopback: true })).toBe(false);
    expect(isBlockedIp("127.8.4.2", { allowLoopback: true })).toBe(false);
    expect(isBlockedIp("::1", { allowLoopback: true })).toBe(false);
    expect(isBlockedIp("::ffff:127.0.0.1", { allowLoopback: true })).toBe(
      false,
    );
  });

  it("keeps metadata, private, and CGNAT blocked under the flag", () => {
    const opts = { allowLoopback: true };
    expect(isBlockedIp("169.254.169.254", opts)).toBe(true);
    expect(isBlockedIp("169.254.0.1", opts)).toBe(true);
    expect(isBlockedIp("10.1.2.3", opts)).toBe(true);
    expect(isBlockedIp("192.168.1.1", opts)).toBe(true);
    expect(isBlockedIp("172.16.0.1", opts)).toBe(true);
    expect(isBlockedIp("100.64.0.1", opts)).toBe(true);
    expect(isBlockedIp("::ffff:192.168.0.1", opts)).toBe(true);
    expect(isBlockedIp("fde7::1", opts)).toBe(true);
  });
});

/**
 * The flag is read from the environment inside `resolveSafeEndpoint`, so
 * these exercise the wiring end to end: flag off rejects loopback, flag on
 * accepts it while still rejecting metadata.
 */
describe("assertSafeEndpoint — loopback egress flag wiring", () => {
  const flag = "ALLOW_LOOPBACK_EGRESS";

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects loopback endpoints when the flag is off", async () => {
    vi.stubEnv(flag, "");
    await expect(assertSafeEndpoint("http://127.0.0.1/x")).rejects.toThrow(
      /blocked/,
    );
  });

  it("accepts a loopback endpoint when the flag is on", async () => {
    vi.stubEnv(flag, "1");
    const url = await assertSafeEndpoint("http://127.0.0.1:5433/");
    expect(url.hostname).toBe("127.0.0.1");
  });

  it("still rejects the cloud metadata endpoint when the flag is on", async () => {
    vi.stubEnv(flag, "1");
    await expect(
      assertSafeEndpoint("http://169.254.169.254/latest/meta-data"),
    ).rejects.toThrow(/blocked/);
  });

  it("still rejects private ranges when the flag is on", async () => {
    vi.stubEnv(flag, "1");
    await expect(assertSafeEndpoint("http://192.168.1.1/x")).rejects.toThrow(
      /blocked/,
    );
  });

  it("reads the flag per call, so it flips without a restart", async () => {
    vi.stubEnv(flag, "1");
    await expect(
      assertSafeEndpoint("http://127.0.0.1/x"),
    ).resolves.toBeTruthy();
    vi.stubEnv(flag, "0");
    await expect(assertSafeEndpoint("http://127.0.0.1/x")).rejects.toThrow(
      /blocked/,
    );
  });
});

describe("resolveTimeoutMs", () => {
  it("defaults when unset or invalid", () => {
    expect(resolveTimeoutMs()).toBe(DEFAULT_HTTP_TIMEOUT_MS);
    expect(resolveTimeoutMs(Number.NaN)).toBe(DEFAULT_HTTP_TIMEOUT_MS);
    expect(resolveTimeoutMs(0)).toBe(DEFAULT_HTTP_TIMEOUT_MS);
    expect(resolveTimeoutMs(-5)).toBe(DEFAULT_HTTP_TIMEOUT_MS);
  });

  it("clamps to the configured ceiling and floor", () => {
    expect(resolveTimeoutMs(999_999)).toBe(MAX_HTTP_TIMEOUT_MS);
    expect(resolveTimeoutMs(5_000)).toBe(5_000);
  });
});

describe("readCappedText", () => {
  const textResponse = (body: string): Response =>
    new Response(body, { status: 200 });

  it("returns short bodies intact", async () => {
    const out = await readCappedText(textResponse('{"ok":true}'));
    expect(out).toBe('{"ok":true}');
  });

  it("aborts bodies over the cap", async () => {
    const big = "x".repeat(MAX_RESPONSE_BYTES + 1);
    await expect(readCappedText(textResponse(big))).rejects.toThrow(/exceeded/);
  }, 20_000);

  it("honors a custom cap", async () => {
    await expect(readCappedText(textResponse("abcdef"), 3)).rejects.toThrow(
      /exceeded/,
    );
  });
});

/**
 * AF-M8-16: `assertSafeEndpoint` only ever saw the FIRST url. Every call site
 * then handed that url to `ky`, which follows redirects itself - so a
 * user-supplied endpoint on an attacker-controlled host could 302 straight to
 * cloud metadata and walk right past the guard. `safeFetch` is the fetch
 * implementation those call sites now pass to ky: it follows redirects itself
 * and re-runs the guard on every hop.
 */
describe("safeFetch - guarded redirects", () => {
  const PUBLIC = "https://93.184.216.34/start";
  const OTHER_PUBLIC = "https://8.8.8.8/next";

  const redirectTo = (location: string, status = 302) =>
    new Response(null, { status, headers: { location } });

  let fetchSpy: MockInstance<typeof globalThis.fetch>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns a non-redirect response untouched", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("body", { status: 200 }));

    const response = await safeFetch(PUBLIC);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("body");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("never lets the platform follow redirects on its own", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("body", { status: 200 }));

    await safeFetch(PUBLIC);

    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("follows a redirect to a public host", async () => {
    fetchSpy
      .mockResolvedValueOnce(redirectTo(OTHER_PUBLIC))
      .mockResolvedValueOnce(new Response("landed", { status: 200 }));

    const response = await safeFetch(PUBLIC);

    await expect(response.text()).resolves.toBe("landed");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("blocks a redirect to the cloud metadata address", async () => {
    fetchSpy.mockResolvedValueOnce(
      redirectTo("http://169.254.169.254/latest/meta-data/"),
    );

    await expect(safeFetch(PUBLIC)).rejects.toThrow(/blocked/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("blocks a redirect to loopback expressed as a relative Location", async () => {
    fetchSpy.mockResolvedValueOnce(redirectTo("//127.0.0.1/admin"));

    await expect(safeFetch(PUBLIC)).rejects.toThrow(/blocked/);
  });

  it("blocks a redirect that switches to a non-http scheme", async () => {
    fetchSpy.mockResolvedValueOnce(redirectTo("file:///etc/passwd"));

    await expect(safeFetch(PUBLIC)).rejects.toThrow(/scheme/);
  });

  it("caps the redirect chain", async () => {
    fetchSpy.mockResolvedValue(redirectTo(OTHER_PUBLIC));

    await expect(safeFetch(PUBLIC)).rejects.toThrow(/redirect/i);
    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(
      MAX_REDIRECT_HOPS + 1,
    );
  });

  it("drops credential headers when a redirect crosses origins", async () => {
    fetchSpy
      .mockResolvedValueOnce(redirectTo(OTHER_PUBLIC))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await safeFetch(PUBLIC, {
      headers: { authorization: "Bearer secret", "x-trace": "keep" },
    });

    const followed = fetchSpy.mock.calls[1][0] as Request;
    expect(followed.headers.get("authorization")).toBeNull();
    expect(followed.headers.get("x-trace")).toBe("keep");
  });

  it("keeps credential headers on a same-origin redirect", async () => {
    fetchSpy
      .mockResolvedValueOnce(redirectTo("https://93.184.216.34/moved"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await safeFetch(PUBLIC, { headers: { authorization: "Bearer secret" } });

    const followed = fetchSpy.mock.calls[1][0] as Request;
    expect(followed.headers.get("authorization")).toBe("Bearer secret");
  });

  it("turns a POST into a GET on a 303 and drops the body", async () => {
    fetchSpy
      .mockResolvedValueOnce(redirectTo(OTHER_PUBLIC, 303))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await safeFetch(PUBLIC, { method: "POST", body: "payload" });

    const followed = fetchSpy.mock.calls[1][0] as Request;
    expect(followed.method).toBe("GET");
    expect(followed.body).toBeNull();
  });

  it("preserves the method and body across a 307", async () => {
    fetchSpy
      .mockResolvedValueOnce(redirectTo(OTHER_PUBLIC, 307))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await safeFetch(PUBLIC, { method: "POST", body: "payload" });

    const followed = fetchSpy.mock.calls[1][0] as Request;
    expect(followed.method).toBe("POST");
    await expect(followed.text()).resolves.toBe("payload");
  });

  it("returns a 3xx that carries no Location rather than looping", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 302 }));

    const response = await safeFetch(PUBLIC);

    expect(response.status).toBe(302);
  });
});

/**
 * AF-M8-17. These are the tests that keep the DNS-rebinding fix honest.
 *
 * The protection lives in a `lookup` override handed to undici, and the
 * failure mode that matters is not "it throws" - it is "the dispatcher is
 * silently ignored and the connection resolves the hostname again", which
 * looks exactly like success while providing nothing. So the test connects a
 * hostname that has no DNS record at all to a real local server: if the pin is
 * honored the request arrives, and if it is ever ignored the lookup fails and
 * this goes red. It runs on whatever Node CI uses, which is the point.
 */
describe("pinnedDispatcher — connections go where we vetted", () => {
  let server: Server;
  let port: number;
  let seenHostHeader: string | undefined;

  beforeEach(async () => {
    server = createServer((req, res) => {
      seenHostHeader = req.headers.host;
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("reached the pinned address");
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  const LOOPBACK = [{ address: "127.0.0.1", family: 4 }];

  it("connects to the vetted address, not to whatever DNS says", async () => {
    // `pinned.invalid` is guaranteed never to resolve (RFC 6761). Reaching the
    // server can therefore only happen through the pinned lookup.
    const dispatcher = pinnedDispatcher("pinned.invalid", LOOPBACK);

    const response = await fetch(`http://pinned.invalid:${port}/`, {
      dispatcher,
    } as RequestInit & { dispatcher: typeof dispatcher });

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("reached the pinned address");
    await dispatcher.close();
  });

  it("still presents the hostname, so virtual hosting and TLS SNI work", async () => {
    // The whole reason this is a lookup override rather than rewriting the URL
    // to an IP: the origin must still see the name it was asked for.
    const dispatcher = pinnedDispatcher("pinned.invalid", LOOPBACK);

    await fetch(`http://pinned.invalid:${port}/`, {
      dispatcher,
    } as RequestInit & { dispatcher: typeof dispatcher });

    expect(seenHostHeader).toBe(`pinned.invalid:${port}`);
    await dispatcher.close();
  });

  it("fails closed when asked for a host it was not built for", async () => {
    // A dispatcher is per-request. Being asked about another host means a
    // redirect reached the connector without being re-vetted.
    const dispatcher = pinnedDispatcher("expected.invalid", LOOPBACK);

    await expect(
      fetch(`http://other.invalid:${port}/`, {
        dispatcher,
      } as RequestInit & { dispatcher: typeof dispatcher }),
    ).rejects.toThrow();

    await dispatcher.close();
  });
});
