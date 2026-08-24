import { describe, expect, it } from "vitest";
import {
  assertSafeEndpoint,
  DEFAULT_HTTP_TIMEOUT_MS,
  expandIpv6,
  isBlockedIp,
  MAX_HTTP_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  readCappedText,
  resolveTimeoutMs,
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
