import { describe, expect, it } from "vitest";
import type { NodeRegistration } from "@/nodes/types";
import {
  DEFAULT_POLL_INTERVAL_SECONDS,
  MIN_POLL_INTERVAL_SECONDS,
} from "./polling";
import {
  type ActiveWorkflowForPolling,
  collectPollableTriggers,
  keyFingerprintOf,
} from "./polling-sweep";

/**
 * A registry stub. The discovery rules are what this file asserts, so they are
 * checked against a known set of types rather than against whichever pollers
 * production happens to register on the day the test runs.
 */
const registration = (
  type: string,
  polling?: NodeRegistration["polling"],
): NodeRegistration =>
  ({
    type,
    version: 1,
    category: "TRIGGER",
    label: type,
    description: type,
    icon: "Box",
    configSchema: { parse: (v: unknown) => v },
    defaults: {},
    inputs: [],
    outputs: [{ id: "main", label: "Out" }],
    execute: async () => ({}),
    polling,
  }) as unknown as NodeRegistration;

const registry = (() => {
  const byType = new Map<string, NodeRegistration>([
    [
      "SHEETS_TRIGGER",
      registration("SHEETS_TRIGGER", {
        defaultIntervalSeconds: 300,
        poll: async () => ({ items: [], cursor: null }),
      }),
    ],
    [
      "FAST_TRIGGER",
      registration("FAST_TRIGGER", {
        defaultIntervalSeconds: 5,
        poll: async () => ({ items: [], cursor: null }),
      }),
    ],
    ["NO_POLL_TRIGGER", registration("NO_POLL_TRIGGER")],
    ["HTTP_REQUEST", registration("HTTP_REQUEST")],
  ]);
  return {
    has: (type: string) => byType.has(type),
    resolve: (type: string) => {
      const found = byType.get(type);
      if (!found) throw new Error(`unknown type ${type}`);
      return found;
    },
  };
})();

const workflow = (
  nodes: Array<Record<string, unknown>>,
  over: Partial<ActiveWorkflowForPolling> = {},
): ActiveWorkflowForPolling => ({
  id: "wf_1",
  organizationId: "org_1",
  activeVersion: { graphSnapshot: { nodes } },
  ...over,
});

describe("collectPollableTriggers (AF-M10-05)", () => {
  it("finds a polling trigger through the registry, not a hard-coded list", () => {
    const triggers = collectPollableTriggers(
      [
        workflow([
          { id: "n1", name: "New row", type: "SHEETS_TRIGGER", data: {} },
          { id: "n2", type: "HTTP_REQUEST", data: {} },
        ]),
      ],
      registry,
    );

    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toMatchObject({
      workflowId: "wf_1",
      organizationId: "org_1",
      nodeId: "n1",
      nodeType: "SHEETS_TRIGGER",
      intervalSeconds: 300,
    });
  });

  it("skips a trigger node whose type declares no poller", () => {
    expect(
      collectPollableTriggers(
        [workflow([{ id: "n1", type: "NO_POLL_TRIGGER", data: {} }])],
        registry,
      ),
    ).toHaveLength(0);
  });

  it("skips a disabled trigger, exactly as AF-M9-17 does for schedules", () => {
    expect(
      collectPollableTriggers(
        [
          workflow([
            {
              id: "n1",
              type: "SHEETS_TRIGGER",
              disabled: true,
              data: {},
            },
          ]),
        ],
        registry,
      ),
    ).toHaveLength(0);
  });

  it("ignores a workflow with no published version", () => {
    expect(
      collectPollableTriggers(
        [{ id: "wf_2", organizationId: "org_1", activeVersion: null }],
        registry,
      ),
    ).toHaveLength(0);
  });

  it("survives a malformed snapshot without taking the sweep down", () => {
    // One workflow with a corrupt snapshot must not stop every other
    // workflow's triggers from being polled this minute.
    const triggers = collectPollableTriggers(
      [
        {
          id: "wf_bad",
          organizationId: "org_1",
          activeVersion: { graphSnapshot: "{not json" },
        },
        workflow([{ id: "n1", type: "SHEETS_TRIGGER", data: {} }], {
          id: "wf_good",
        }),
      ],
      registry,
    );
    expect(triggers.map((t) => t.workflowId)).toEqual(["wf_good"]);
  });

  it("parses a snapshot stored as a JSON string", () => {
    const triggers = collectPollableTriggers(
      [
        {
          id: "wf_1",
          organizationId: "org_1",
          activeVersion: {
            graphSnapshot: JSON.stringify({
              nodes: [{ id: "n1", type: "SHEETS_TRIGGER", data: {} }],
            }),
          },
        },
      ],
      registry,
    );
    expect(triggers).toHaveLength(1);
  });

  it("lets node config override the poller's default interval", () => {
    const triggers = collectPollableTriggers(
      [
        workflow([
          {
            id: "n1",
            type: "SHEETS_TRIGGER",
            data: { pollIntervalSeconds: 900 },
          },
        ]),
      ],
      registry,
    );
    expect(triggers[0].intervalSeconds).toBe(900);
  });

  it("floors a poller that asks to be swept faster than the sweep runs", () => {
    const triggers = collectPollableTriggers(
      [workflow([{ id: "n1", type: "FAST_TRIGGER", data: {} }])],
      registry,
    );
    expect(triggers[0].intervalSeconds).toBe(MIN_POLL_INTERVAL_SECONDS);
  });

  it("falls back to the default when neither states an interval", () => {
    const bare = {
      has: () => true,
      resolve: () =>
        registration("BARE", {
          poll: async () => ({ items: [], cursor: null }),
        }),
    };
    const triggers = collectPollableTriggers(
      [workflow([{ id: "n1", type: "BARE", data: {} }])],
      bare,
    );
    expect(triggers[0].intervalSeconds).toBe(DEFAULT_POLL_INTERVAL_SECONDS);
  });
});

describe("keyFingerprintOf", () => {
  it("changes when what an item IS changes", () => {
    const a = keyFingerprintOf({ spreadsheetId: "s1", sheetName: "Sheet1" });
    const b = keyFingerprintOf({ spreadsheetId: "s2", sheetName: "Sheet1" });
    expect(a).not.toBe(b);
  });

  it("does NOT change for a cosmetic edit", () => {
    // Renaming a node or changing its interval must not clear the dedupe
    // window — that would replay the whole backlog.
    const a = keyFingerprintOf({
      spreadsheetId: "s1",
      pollIntervalSeconds: 300,
    });
    const b = keyFingerprintOf({
      spreadsheetId: "s1",
      pollIntervalSeconds: 900,
      variableName: "renamed",
    });
    expect(a).toBe(b);
  });

  it("is stable across calls", () => {
    expect(keyFingerprintOf({ query: "is:unread" })).toBe(
      keyFingerprintOf({ query: "is:unread" }),
    );
  });
});
