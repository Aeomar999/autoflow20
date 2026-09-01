import { describe, expect, it } from "vitest";
import { emailSenderSchema } from "./env";

/**
 * AF-M8-15: `RESEND_FROM_EMAIL` carries an RFC 5322 sender, which may be a bare
 * address OR a display-name form. `.env.example` and the built-in default both
 * ship the display-name form, so validating it as a bare address made a
 * correctly-configured install refuse to boot.
 */
describe("emailSenderSchema", () => {
  it("accepts a bare address", () => {
    expect(emailSenderSchema.safeParse("noreply@autoflow.dev").success).toBe(
      true,
    );
  });

  it("accepts the display-name form shipped in .env.example", () => {
    expect(
      emailSenderSchema.safeParse("AutoFlow <onboarding@resend.dev>").success,
    ).toBe(true);
  });

  it("accepts a quoted display name containing punctuation", () => {
    expect(
      emailSenderSchema.safeParse('"AutoFlow, Inc." <noreply@autoflow.dev>')
        .success,
    ).toBe(true);
  });

  it("rejects a display-name form whose address is not an email", () => {
    expect(emailSenderSchema.safeParse("AutoFlow <not-an-email>").success).toBe(
      false,
    );
  });

  it("rejects a bare string that is not an email", () => {
    expect(emailSenderSchema.safeParse("not-an-email").success).toBe(false);
  });

  it("rejects an unterminated angle bracket", () => {
    expect(
      emailSenderSchema.safeParse("AutoFlow <noreply@autoflow.dev").success,
    ).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(emailSenderSchema.safeParse("").success).toBe(false);
  });
});
