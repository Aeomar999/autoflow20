import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  redirectedServiceUrl,
  SERVICE_ENDPOINTS,
  SERVICE_FIXTURE_ENV,
  serviceEndpoint,
  serviceFixtureActive,
} from "./service-endpoints";

/**
 * AF-M10-34's seam, and the rule that keeps it a seam.
 */

// Vitest's own env stubbing, not assignment: @types/node declares NODE_ENV
// readonly, and unstubbing restores the whole environment rather than the
// two keys someone remembered to put back.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("serviceEndpoint", () => {
  it("returns the real base when nothing is overridden", () => {
    vi.stubEnv(SERVICE_FIXTURE_ENV, "");
    expect(serviceEndpoint("stripe")).toBe("https://api.stripe.com/v1");
    expect(serviceFixtureActive()).toBe(false);
  });

  it("routes each service to its own path segment under the fixture", () => {
    // Per-service segments, not one shared origin: two services would
    // otherwise collide on the same path and the fixture could not tell a
    // Sheets call from a Drive one.
    vi.stubEnv(SERVICE_FIXTURE_ENV, "http://127.0.0.1:5599");

    expect(serviceEndpoint("stripe")).toBe("http://127.0.0.1:5599/stripe");
    expect(serviceEndpoint("google-sheets")).toBe(
      "http://127.0.0.1:5599/google-sheets",
    );
    expect(serviceFixtureActive()).toBe(true);
  });

  it("keeps the client's own path suffix, which is what a contract test asserts on", () => {
    vi.stubEnv(SERVICE_FIXTURE_ENV, "http://127.0.0.1:5599");
    // What `stripeFetch` builds: `${base}${path}`.
    expect(`${serviceEndpoint("stripe")}/customers`).toBe(
      "http://127.0.0.1:5599/stripe/customers",
    );
  });

  it("ignores a trailing path on the override, taking only the origin", () => {
    vi.stubEnv(SERVICE_FIXTURE_ENV, "http://127.0.0.1:5599/some/where");
    expect(serviceEndpoint("apify")).toBe("http://127.0.0.1:5599/apify");
  });

  it("accepts localhost and ::1 as well as 127.0.0.1", () => {
    for (const origin of [
      "http://localhost:5599",
      "http://[::1]:5599",
      "http://127.0.0.1:5599",
    ]) {
      vi.stubEnv(SERVICE_FIXTURE_ENV, origin);
      expect(serviceEndpoint("slack").startsWith(origin)).toBe(true);
    }
  });
});

describe("the override cannot become an exfiltration route", () => {
  it("refuses a non-loopback host", () => {
    // The gate that actually matters. A free-form base URL would let anyone
    // who can set an env var redirect every tenant's Stripe key to a host
    // they control.
    vi.stubEnv(SERVICE_FIXTURE_ENV, "http://attacker.example.com");
    expect(() => serviceEndpoint("stripe")).toThrow(/loopback/i);
  });

  it("refuses https, because a fixture server is plain http", () => {
    vi.stubEnv(SERVICE_FIXTURE_ENV, "https://127.0.0.1:5599");
    expect(() => serviceEndpoint("stripe")).toThrow(/loopback/i);
  });

  it("refuses a host that merely contains a loopback name", () => {
    vi.stubEnv(SERVICE_FIXTURE_ENV, "http://127.0.0.1.attacker.example.com");
    expect(() => serviceEndpoint("stripe")).toThrow(/loopback/i);
  });

  it("ignores the override entirely outside NODE_ENV=test", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(SERVICE_FIXTURE_ENV, "http://127.0.0.1:5599");
    expect(serviceEndpoint("stripe")).toBe("https://api.stripe.com/v1");
    expect(serviceFixtureActive()).toBe(false);
  });

  it("throws rather than silently using the real endpoint when malformed", () => {
    // Falling back would turn "this test redirects Stripe" into "this test
    // charged a real card", and the suite is supposed to touch no network.
    vi.stubEnv(SERVICE_FIXTURE_ENV, "not a url");
    expect(() => serviceEndpoint("stripe")).toThrow(/not a valid URL/i);
  });
});

describe("redirectedServiceUrl", () => {
  it("passes a caller-computed base through untouched by default", () => {
    vi.stubEnv(SERVICE_FIXTURE_ENV, "");
    expect(
      redirectedServiceUrl("shopify", "https://acme.myshopify.com/admin/api/x"),
    ).toBe("https://acme.myshopify.com/admin/api/x");
  });

  it("redirects a per-tenant host to the service's fixture route", () => {
    vi.stubEnv(SERVICE_FIXTURE_ENV, "http://127.0.0.1:5599");
    expect(
      redirectedServiceUrl("shopify", "https://acme.myshopify.com/admin/api/x"),
    ).toBe("http://127.0.0.1:5599/shopify");
  });
});

describe("no client reopens the seam", () => {
  /**
   * Files allowed to name a public https host directly, and why.
   *
   * OAuth authorize and token endpoints are reached by the user's browser
   * during a connect flow, not by a workflow run, so no fixture ever needs to
   * stand in for them — and pointing a token exchange at loopback would be a
   * way to capture an authorization code, not a way to test one.
   */
  const ALLOWED = new Set([
    "src/features/credentials/server/oauth-providers.ts",
  ]);

  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        out.push(...walk(full));
      } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        out.push(full);
      }
    }
    return out;
  };

  it("declares no new hardcoded service base URL", () => {
    // The constants this task removed were invisible until someone tried to
    // run a template offline. A twenty-sixth one added next month would be
    // just as invisible, so the rule is a test rather than a convention.
    const offenders: string[] = [];
    const pattern = /^\s*(?:export\s+)?const\s+\w+\s*=\s*"https:\/\/[^"]+"/gm;

    for (const file of walk("src/features")) {
      const rel = file.split("\\").join("/");
      if (ALLOWED.has(rel)) continue;

      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(pattern)) {
        offenders.push(`${rel}: ${match[0].trim()}`);
      }
    }

    expect(
      offenders,
      "add the base to SERVICE_ENDPOINTS and call serviceEndpoint(), or exempt the file here with a reason",
    ).toEqual([]);
  });

  it("gives every registered service an https base", () => {
    for (const [name, url] of Object.entries(SERVICE_ENDPOINTS)) {
      expect(url, name).toMatch(/^https:\/\//);
    }
  });
});
