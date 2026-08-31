import { describe, expect, it } from "vitest";
import { resolveTrustedOrigins } from "./auth-origins";

describe("resolveTrustedOrigins", () => {
  it("always trusts local development, both host spellings", () => {
    const origins = resolveTrustedOrigins({});

    expect(origins).toContain("http://localhost:3000");
    // 127.0.0.1 is a different origin to the check, despite the same machine.
    expect(origins).toContain("http://127.0.0.1:3000");
  });

  it("keeps localhost even when the base URL points at a deployment", () => {
    const origins = resolveTrustedOrigins({
      BETTER_AUTH_URL: "https://autoflow20.vercel.app",
    });

    expect(origins).toContain("https://autoflow20.vercel.app");
    expect(origins).toContain("http://localhost:3000");
  });

  it("adds a scheme to bare hosts from NGROK_URL and VERCEL_URL", () => {
    const origins = resolveTrustedOrigins({
      NGROK_URL: "clapped-basics-glorious.ngrok-free.dev",
      VERCEL_URL: "autoflow20-git-branch-xyz.vercel.app",
    });

    expect(origins).toContain("https://clapped-basics-glorious.ngrok-free.dev");
    expect(origins).toContain("https://autoflow20-git-branch-xyz.vercel.app");
  });

  it("normalises to the origin, dropping paths and trailing slashes", () => {
    const origins = resolveTrustedOrigins({
      BETTER_AUTH_URL: "https://example.com/",
      NEXT_PUBLIC_APP_URL: "https://example.com/workflows",
    });

    expect(origins).toContain("https://example.com");
    expect(origins.filter((o) => o === "https://example.com")).toHaveLength(1);
  });

  it("deduplicates without reordering", () => {
    const origins = resolveTrustedOrigins({
      BETTER_AUTH_URL: "http://localhost:3000",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    });

    expect(origins[0]).toBe("http://localhost:3000");
    expect(new Set(origins).size).toBe(origins.length);
  });

  it("drops an unparseable value rather than trusting it or throwing", () => {
    const origins = resolveTrustedOrigins({
      BETTER_AUTH_URL: "http://",
      NEXT_PUBLIC_APP_URL: "   ",
    });

    expect(origins).not.toContain("http://");
    expect(origins).toContain("http://localhost:3000");
  });

  it("preserves a non-default port", () => {
    expect(
      resolveTrustedOrigins({ BETTER_AUTH_URL: "http://localhost:4000" }),
    ).toContain("http://localhost:4000");
  });
});
