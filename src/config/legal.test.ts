import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  legalEffectiveDate,
  legalEntity,
  SUBPROCESSORS,
  supportEmail,
} from "./legal";

/**
 * AF-M8-10. The behaviour worth testing is the refusal: an unconfigured
 * deployment must not be able to render something that looks like a published
 * policy. Everything else here is a lookup.
 */

const KEYS = [
  "NEXT_PUBLIC_LEGAL_ENTITY_NAME",
  "NEXT_PUBLIC_LEGAL_JURISDICTION",
  "NEXT_PUBLIC_LEGAL_ADDRESS",
  "NEXT_PUBLIC_LEGAL_CONTACT_EMAIL",
  "NEXT_PUBLIC_LEGAL_PRIVACY_EMAIL",
  "NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE",
  "NEXT_PUBLIC_SUPPORT_EMAIL",
] as const;

const saved: Record<string, string | undefined> = {};

const configure = (values: Record<string, string>) => {
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
};

const COMPLETE = {
  NEXT_PUBLIC_LEGAL_ENTITY_NAME: "AutoFlow Technologies Ltd",
  NEXT_PUBLIC_LEGAL_JURISDICTION: "England and Wales",
  NEXT_PUBLIC_LEGAL_ADDRESS: "1 Example Street, London, EC1A 1AA",
  NEXT_PUBLIC_LEGAL_CONTACT_EMAIL: "legal@example.com",
};

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
});

describe("legalEntity", () => {
  it("is null when nothing is configured", () => {
    expect(legalEntity()).toBeNull();
  });

  it("is null when only some values are configured", () => {
    // All-or-nothing on purpose: a policy naming the company in one clause and
    // a blank in the next is not partially configured, it is broken.
    configure({
      NEXT_PUBLIC_LEGAL_ENTITY_NAME: "AutoFlow Technologies Ltd",
      NEXT_PUBLIC_LEGAL_JURISDICTION: "England and Wales",
    });

    expect(legalEntity()).toBeNull();
  });

  it("is null when a value is only whitespace", () => {
    configure({ ...COMPLETE, NEXT_PUBLIC_LEGAL_ADDRESS: "   " });

    expect(legalEntity()).toBeNull();
  });

  it("returns the entity once every value is present", () => {
    configure(COMPLETE);

    expect(legalEntity()).toEqual({
      name: "AutoFlow Technologies Ltd",
      jurisdiction: "England and Wales",
      address: "1 Example Street, London, EC1A 1AA",
      contactEmail: "legal@example.com",
      privacyEmail: "legal@example.com",
    });
  });

  it("falls back to the legal contact for the privacy address", () => {
    configure(COMPLETE);
    expect(legalEntity()?.privacyEmail).toBe("legal@example.com");
  });

  it("prefers an explicit privacy address when given", () => {
    configure({
      ...COMPLETE,
      NEXT_PUBLIC_LEGAL_PRIVACY_EMAIL: "privacy@example.com",
    });

    expect(legalEntity()?.privacyEmail).toBe("privacy@example.com");
  });
});

describe("legalEffectiveDate and supportEmail", () => {
  it("are null when unset rather than an empty string", () => {
    expect(legalEffectiveDate()).toBeNull();
    expect(supportEmail()).toBeNull();
  });

  it("return the configured values", () => {
    configure({
      NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE: "2026-09-14",
      NEXT_PUBLIC_SUPPORT_EMAIL: "support@example.com",
    });

    expect(legalEffectiveDate()).toBe("2026-09-14");
    expect(supportEmail()).toBe("support@example.com");
  });
});

describe("SUBPROCESSORS", () => {
  it("describes each entry well enough to answer a customer's question", () => {
    for (const entry of SUBPROCESSORS) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.purpose.length).toBeGreaterThan(0);
      expect(entry.dataHandled.length).toBeGreaterThan(0);
    }
  });

  it("lists the processors that hold data unconditionally as non-optional", () => {
    const required = SUBPROCESSORS.filter((entry) => !entry.optional).map(
      (entry) => entry.name,
    );

    // Hosting stores everything and Inngest drives every run; neither can be
    // switched off, so neither may be presented to a customer as optional.
    expect(required).toContain("Inngest");
    expect(required.length).toBeGreaterThanOrEqual(2);
  });

  it("has no duplicate entries", () => {
    const names = SUBPROCESSORS.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
