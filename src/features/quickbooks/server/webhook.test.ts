import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { collectQboTargets, qboTriggerContext } from "./dispatch";
import {
  eventMatchesFilter,
  parseIntuitNotification,
  verifyIntuitSignature,
} from "./webhook";

const TOKEN = "verifier-token";

const sign = (body: string): string =>
  createHmac("sha256", TOKEN).update(body, "utf8").digest("base64");

const NOTIFICATION = JSON.stringify({
  eventNotifications: [
    {
      realmId: "4620816365",
      dataChangeEvent: {
        entities: [
          {
            name: "Invoice",
            id: "142",
            operation: "Create",
            lastUpdated: "2026-09-04T10:00:00-0700",
          },
          {
            name: "Payment",
            id: "77",
            operation: "Update",
            lastUpdated: "2026-09-04T10:01:00-0700",
          },
        ],
      },
    },
  ],
});

describe("verifyIntuitSignature (AF-M10-16)", () => {
  it("accepts a correctly signed payload", () => {
    expect(
      verifyIntuitSignature({
        rawBody: NOTIFICATION,
        signature: sign(NOTIFICATION),
        verifierToken: TOKEN,
      }),
    ).toBe(true);
  });

  it("rejects a payload signed with a different token", () => {
    const forged = createHmac("sha256", "wrong-token")
      .update(NOTIFICATION, "utf8")
      .digest("base64");

    expect(
      verifyIntuitSignature({
        rawBody: NOTIFICATION,
        signature: forged,
        verifierToken: TOKEN,
      }),
    ).toBe(false);
  });

  it("rejects a body that was altered after signing", () => {
    const signature = sign(NOTIFICATION);
    const tampered = NOTIFICATION.replace('"142"', '"999"');

    expect(
      verifyIntuitSignature({
        rawBody: tampered,
        signature,
        verifierToken: TOKEN,
      }),
    ).toBe(false);
  });

  it("fails on a re-serialised body, which is why the RAW body is used", () => {
    // Not a hypothetical: reading the body with `request.json()` and signing
    // `JSON.stringify(parsed)` is the obvious implementation, and it produces
    // a byte-for-byte different document. Every check would fail, and it
    // would look like a wrong verifier token.
    const signature = sign(NOTIFICATION);
    const reserialised = JSON.stringify(JSON.parse(NOTIFICATION), null, 2);

    expect(reserialised).not.toBe(NOTIFICATION);
    expect(
      verifyIntuitSignature({
        rawBody: reserialised,
        signature,
        verifierToken: TOKEN,
      }),
    ).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(
      verifyIntuitSignature({
        rawBody: NOTIFICATION,
        signature: null,
        verifierToken: TOKEN,
      }),
    ).toBe(false);
  });

  it("rejects a signature of the wrong length without throwing", () => {
    // `timingSafeEqual` throws on a length mismatch, and an unhandled throw
    // here would turn a forged request into a 500 rather than a rejection.
    expect(
      verifyIntuitSignature({
        rawBody: NOTIFICATION,
        signature: "c2hvcnQ=",
        verifierToken: TOKEN,
      }),
    ).toBe(false);
  });

  it("rejects when the server has no verifier token configured", () => {
    // Never fail open. An unconfigured deployment must reject, not accept.
    expect(
      verifyIntuitSignature({
        rawBody: NOTIFICATION,
        signature: sign(NOTIFICATION),
        verifierToken: "",
      }),
    ).toBe(false);
  });
});

describe("parseIntuitNotification (AF-M10-16)", () => {
  it("pulls each realm's entity events out", () => {
    const realms = parseIntuitNotification(JSON.parse(NOTIFICATION));
    expect(realms).toHaveLength(1);
    expect(realms[0].realmId).toBe("4620816365");
    expect(realms[0].entities.map((e) => e.name)).toEqual([
      "Invoice",
      "Payment",
    ]);
  });

  it("returns nothing for a keep-alive with no events", () => {
    // Intuit sends these. Signed and valid, nothing to do — not an error.
    expect(parseIntuitNotification({ eventNotifications: [] })).toEqual([]);
    expect(parseIntuitNotification({})).toEqual([]);
    expect(parseIntuitNotification(null)).toEqual([]);
  });

  it("skips a malformed entity rather than failing the whole batch", () => {
    const realms = parseIntuitNotification({
      eventNotifications: [
        {
          realmId: "1",
          dataChangeEvent: {
            entities: [
              { name: "Invoice", id: "1", operation: "Create" },
              { name: "Invoice" },
              { id: "3", operation: "Create" },
            ],
          },
        },
      ],
    });
    expect(realms[0].entities).toHaveLength(1);
  });
});

describe("eventMatchesFilter (AF-M10-16)", () => {
  const event = {
    name: "Invoice",
    id: "1",
    operation: "Create",
    lastUpdated: "",
  };

  it("matches everything when no filter is set", () => {
    expect(eventMatchesFilter(event, {})).toBe(true);
    expect(eventMatchesFilter(event, { entities: [], operations: [] })).toBe(
      true,
    );
  });

  it("filters by entity", () => {
    expect(eventMatchesFilter(event, { entities: ["Invoice"] })).toBe(true);
    expect(eventMatchesFilter(event, { entities: ["Payment"] })).toBe(false);
  });

  it("filters by operation", () => {
    expect(eventMatchesFilter(event, { operations: ["Create"] })).toBe(true);
    expect(eventMatchesFilter(event, { operations: ["Delete"] })).toBe(false);
  });

  it("compares case-insensitively", () => {
    // A saved graph can carry either casing, and Intuit's own docs are not
    // consistent about it.
    expect(eventMatchesFilter(event, { entities: ["invoice"] })).toBe(true);
    expect(eventMatchesFilter(event, { operations: ["create"] })).toBe(true);
  });
});

describe("collectQboTargets (AF-M10-16)", () => {
  const realm = parseIntuitNotification(JSON.parse(NOTIFICATION))[0];

  const workflow = (
    data: Record<string, unknown>,
    overrides: { disabled?: boolean; type?: string } = {},
  ) => ({
    id: "wf1",
    organizationId: "org1",
    activeVersion: {
      graphSnapshot: {
        nodes: [
          {
            id: "trigger",
            type: overrides.type ?? "QBO_WEBHOOK_TRIGGER",
            disabled: overrides.disabled,
            data,
          },
        ],
      },
    },
  });

  it("routes to a trigger bound to a credential for this realm", () => {
    const targets = collectQboTargets({
      workflows: [workflow({ credentialId: "cred1", entities: ["Invoice"] })],
      credentialIds: new Set(["cred1"]),
      realm,
    });

    expect(targets).toHaveLength(1);
    expect(targets[0].events.map((e) => e.id)).toEqual(["142"]);
  });

  it("ignores a trigger bound to a different company", () => {
    // One organization can connect two QuickBooks companies. Company B's
    // invoices must not start company A's workflow.
    const targets = collectQboTargets({
      workflows: [workflow({ credentialId: "other-company" })],
      credentialIds: new Set(["cred1"]),
      realm,
    });
    expect(targets).toEqual([]);
  });

  it("ignores a trigger bound to no credential at all", () => {
    const targets = collectQboTargets({
      workflows: [workflow({})],
      credentialIds: new Set(["cred1"]),
      realm,
    });
    expect(targets).toEqual([]);
  });

  it("skips a disabled trigger", () => {
    const targets = collectQboTargets({
      workflows: [workflow({ credentialId: "cred1" }, { disabled: true })],
      credentialIds: new Set(["cred1"]),
      realm,
    });
    expect(targets).toEqual([]);
  });

  it("returns nothing when the filter excludes every event", () => {
    // Dispatching a run with no events would burn quota to do nothing and
    // make the execution list unreadable.
    const targets = collectQboTargets({
      workflows: [workflow({ credentialId: "cred1", entities: ["Estimate"] })],
      credentialIds: new Set(["cred1"]),
      realm,
    });
    expect(targets).toEqual([]);
  });

  it("survives a graph snapshot that will not parse", () => {
    const targets = collectQboTargets({
      workflows: [
        {
          id: "wf-bad",
          organizationId: "org1",
          activeVersion: { graphSnapshot: "{not json" },
        },
      ],
      credentialIds: new Set(["cred1"]),
      realm,
    });
    expect(targets).toEqual([]);
  });

  it("ignores nodes that are not QuickBooks triggers", () => {
    const targets = collectQboTargets({
      workflows: [
        workflow({ credentialId: "cred1" }, { type: "WEBHOOK_TRIGGER" }),
      ],
      credentialIds: new Set(["cred1"]),
      realm,
    });
    expect(targets).toEqual([]);
  });
});

describe("qboTriggerContext (AF-M10-16)", () => {
  it("gives the graph the ids a follow-up read needs", () => {
    const context = qboTriggerContext({
      realmId: "4620816365",
      event: {
        name: "Invoice",
        id: "142",
        operation: "Create",
        lastUpdated: "2026-09-04T10:00:00-0700",
      },
    });

    // The webhook says WHAT changed, not what it now says: QBO_GET reads the
    // record, and these are the two values it needs.
    expect(context.qbo).toMatchObject({
      entity: "Invoice",
      entityId: "142",
      operation: "Create",
      realmId: "4620816365",
    });
  });

  it("carries the merge target when there is one", () => {
    const context = qboTriggerContext({
      realmId: "1",
      event: {
        name: "Customer",
        id: "5",
        operation: "Merge",
        lastUpdated: "",
        deletedId: "9",
      },
    }) as { qbo: Record<string, unknown> };

    expect(context.qbo.deletedId).toBe("9");
  });
});
