import { describe, expect, it } from "vitest";
import { signState, verifyState } from "./oauth-state";

describe("OAuth State", () => {
  it("signs and verifies state payload successfully", () => {
    // Setup a mock master key for the test (env is bypassed)
    process.env.CREDENTIAL_MASTER_KEY = "12345678901234567890123456789012";

    const state = {
      userId: "user-123",
      providerId: "google.oauth2",
      nonce: "random-nonce",
    };

    const token = signState(state);
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(2);

    const verified = verifyState(token);
    expect(verified).toEqual(state);
  });

  it("throws error on invalid signature", () => {
    const token =
      "eyJ1c2VySWQiOiJ1c2VyLTEyMyIsInByb3ZpZGVySWQiOiJnb29nbGUub2F1dGgyIiwibm9uY2UiOiJyYW5kb20tbm9uY2UifQ.invalid-signature";
    expect(() => verifyState(token)).toThrow("State signature mismatch");
  });
});
