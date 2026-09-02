import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emailSenderSchema, serverEnvSchemaForTests } from "./env";

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

/**
 * The documented quick start is `cp .env.example .env`. If a variable the
 * template ships blank fails validation, that command produces an install
 * which refuses to boot - which is what happened to the four POLAR product
 * ids and POLAR_WEBHOOK_SECRET, and to RESEND_FROM_EMAIL before AF-M8-15.
 * This reads the real template rather than a copy of its values, so the two
 * cannot drift apart without failing here.
 */
describe("`.env.example` satisfies its own schema", () => {
  const example = readFileSync(join(process.cwd(), ".env.example"), "utf-8");

  const shippedValues = new Map<string, string>();
  for (const line of example.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) shippedValues.set(match[1], match[2].replace(/^"|"$/g, ""));
  }

  it("parses cleanly, with the required values filled in", () => {
    // Everything the template ships, plus the handful an operator must supply
    // for the app to boot at all.
    const env = {
      ...Object.fromEntries(shippedValues),
      DATABASE_URL: "postgresql://u:p@localhost:5432/db",
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "http://localhost:3000",
      CREDENTIAL_MASTER_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
    };

    const result = serverEnvSchemaForTests.safeParse(env);
    const problems = result.success
      ? []
      : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);

    expect(problems).toEqual([]);
  });

  it("ships the Polar ids blank, which is the case that used to break", () => {
    // Guards the fixture itself: if the template stops shipping these blank,
    // the test above stops covering the regression it exists for.
    for (const key of [
      "POLAR_PRODUCT_ID",
      "POLAR_PRODUCT_ID_STARTER",
      "POLAR_PRODUCT_ID_PRO",
      "POLAR_PRODUCT_ID_ENTERPRISE",
      "POLAR_WEBHOOK_SECRET",
    ]) {
      expect(shippedValues.get(key)).toBe("");
    }
  });
});
