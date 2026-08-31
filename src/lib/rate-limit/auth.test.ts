import { describe, expect, it } from "vitest";
import { authBucket, deriveAuthRateKey, detectAuthSurface } from "./auth";
import { AUTH_BUCKETS } from "./store";

describe("detectAuthSurface", () => {
  it("resolves credential endpoints", () => {
    expect(detectAuthSurface("/api/auth/sign-in/email")).toBe("sign-in");
    expect(detectAuthSurface("/api/auth/sign-in")).toBe("sign-in");
    expect(detectAuthSurface("/api/auth/sign-up/email")).toBe("sign-up");
    expect(detectAuthSurface("/api/auth/request-password-reset")).toBe("reset");
    expect(detectAuthSurface("/api/auth/reset-password")).toBe("reset");
  });

  it("is case-insensitive", () => {
    expect(detectAuthSurface("/api/auth/Sign-In/email")).toBe("sign-in");
  });

  it("returns null for non-credential routes", () => {
    expect(detectAuthSurface("/api/auth/get-session")).toBeNull();
    expect(detectAuthSurface("/api/auth/sign-out")).toBeNull();
    expect(detectAuthSurface("/api/not-auth")).toBeNull();
    expect(detectAuthSurface("/")).toBeNull();
  });
});

describe("authBucket", () => {
  it("uses the sign-in bucket for sign-in and sign-up", () => {
    expect(authBucket("sign-in")).toBe(AUTH_BUCKETS.SIGN_IN);
    expect(authBucket("sign-up")).toBe(AUTH_BUCKETS.SIGN_IN);
  });

  it("uses the reset bucket for reset", () => {
    expect(authBucket("reset")).toBe(AUTH_BUCKETS.RESET);
  });
});

describe("deriveAuthRateKey", () => {
  it("keys sign-in/up by ip and normalized email", () => {
    expect(deriveAuthRateKey("sign-in", "1.2.3.4", "  A@B.com ")).toBe(
      "auth:sign-in:1.2.3.4:a@b.com",
    );
    expect(deriveAuthRateKey("sign-up", "1.2.3.4", "a@b.com")).toBe(
      "auth:sign-up:1.2.3.4:a@b.com",
    );
  });

  it("keys reset by email only (ip-independent)", () => {
    const a = deriveAuthRateKey("reset", "5.6.7.8", "a@b.com");
    const b = deriveAuthRateKey("reset", "9.9.9.9", "a@b.com");
    expect(a).toBe("auth:reset:a@b.com");
    expect(b).toBe(a);
  });

  it("handles a missing email", () => {
    expect(deriveAuthRateKey("sign-in", "1.2.3.4", undefined)).toBe(
      "auth:sign-in:1.2.3.4:",
    );
  });
});
