import { beforeAll, describe, expect, it } from "vitest";
import {
  ApprovalTokenError,
  approvalLinks,
  signApprovalToken,
  verifyApprovalToken,
} from "./approval-token";

beforeAll(() => {
  process.env.CREDENTIAL_MASTER_KEY = "12345678901234567890123456789012";
});

const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;

const payload = (over: Record<string, unknown> = {}) => ({
  approvalId: "appr_1",
  organizationId: "org_a",
  decision: "APPROVED" as const,
  exp: inAnHour(),
  ...over,
});

describe("approval tokens (AF-M10-09)", () => {
  it("round-trips a token", () => {
    const input = payload();
    expect(verifyApprovalToken(signApprovalToken(input))).toEqual(input);
  });

  it("refuses a tampered payload", () => {
    // The decision is inside the signature, so flipping "reject" to "approve"
    // in the URL invalidates the token rather than changing the outcome.
    const token = signApprovalToken(payload({ decision: "REJECTED" }));
    const [encoded, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify(payload({ decision: "APPROVED" })),
    ).toString("base64url");

    expect(() => verifyApprovalToken(`${forged}.${signature}`)).toThrow(
      ApprovalTokenError,
    );
    expect(encoded).not.toBe(forged);
  });

  it("refuses an expired token", () => {
    // An approval link that works forever is a permanent grant sitting in
    // someone's inbox.
    const token = signApprovalToken(
      payload({ exp: Math.floor(Date.now() / 1000) - 60 }),
    );
    expect(() => verifyApprovalToken(token)).toThrow(/expired/i);
  });

  it("cannot have its expiry extended by editing the URL", () => {
    const token = signApprovalToken(
      payload({ exp: Math.floor(Date.now() / 1000) - 60 }),
    );
    const [, signature] = token.split(".");
    const extended = Buffer.from(
      JSON.stringify(payload({ exp: inAnHour() })),
    ).toString("base64url");
    expect(() => verifyApprovalToken(`${extended}.${signature}`)).toThrow(
      ApprovalTokenError,
    );
  });

  it("refuses a malformed token rather than throwing something opaque", () => {
    for (const bad of ["", "nodot", "a.b.c.d", "!!!.###"]) {
      expect(() => verifyApprovalToken(bad), bad).toThrow(ApprovalTokenError);
    }
  });

  it("names the organization, so a token cannot cross tenants", () => {
    const verified = verifyApprovalToken(
      signApprovalToken(payload({ organizationId: "org_b" })),
    );
    expect(verified.organizationId).toBe("org_b");
  });

  it("builds one link per decision, both pointing at the confirm page", () => {
    // Not at an endpoint that acts on GET: mail scanners follow links.
    const links = approvalLinks({
      approvalId: "appr_1",
      organizationId: "org_a",
      expiresAt: new Date(Date.now() + 3600_000),
      appUrl: "https://app.example.com",
    });

    expect(links.approve).toContain(
      "https://app.example.com/approvals/respond",
    );
    expect(links.reject).toContain("https://app.example.com/approvals/respond");
    expect(links.approve).not.toBe(links.reject);

    const decisionOf = (link: string) =>
      verifyApprovalToken(
        decodeURIComponent(new URL(link).searchParams.get("token") as string),
      ).decision;

    expect(decisionOf(links.approve)).toBe("APPROVED");
    expect(decisionOf(links.reject)).toBe("REJECTED");
  });
});
