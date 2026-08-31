import { describe, expect, it } from "vitest";
import { nodeRegistry, UnknownNodeTypeError } from "@/nodes/registry";
import {
  collectPendingCredentials,
  prepareTemplateGraph,
  type TemplateGraph,
} from "./instantiate";

const trigger = (id: string) => ({
  id,
  type: "MANUAL_TRIGGER",
  position: { x: 0, y: 0 },
});

const sheets = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  type: "GOOGLE_SHEETS_APPEND",
  position: { x: 120, y: 120 },
  data: {
    spreadsheetId: "abc123",
    sheetName: "Leads",
    range: "A:C",
    credentialId: "cmtest012345678901234567",
    ...overrides,
  },
});

const baseGraph: TemplateGraph = {
  nodes: [trigger("a"), sheets("b")],
  edges: [{ source: "a", target: "b" }],
};

describe("prepareTemplateGraph", () => {
  it("rotates every node id to a fresh cuid and maps old -> new", () => {
    const prepared = prepareTemplateGraph(baseGraph);

    expect(prepared.nodes).toHaveLength(2);
    for (const node of prepared.nodes) {
      expect(node.id).not.toBe("a");
      expect(node.id).not.toBe("b");
      expect(node.id).toMatch(/^[a-z0-9]{20,}$/);
    }
    expect(prepared.idMap.get("a")).toBe(prepared.nodes[0].id);
    expect(prepared.idMap.get("b")).toBe(prepared.nodes[1].id);
  });

  it("produces disjoint ids across two installs of the same template", () => {
    const first = prepareTemplateGraph(baseGraph).nodes.map((n) => n.id);
    const second = prepareTemplateGraph(baseGraph).nodes.map((n) => n.id);

    expect(new Set([...first, ...second]).size).toBe(
      first.length + second.length,
    );
  });

  it("rewires edges to the rotated node ids and preserves handles", () => {
    const prepared = prepareTemplateGraph({
      ...baseGraph,
      edges: [
        {
          source: "a",
          target: "b",
          sourceHandle: "main",
          targetHandle: "main",
        },
      ],
    });

    expect(prepared.edges).toEqual([
      {
        source: prepared.idMap.get("a"),
        target: prepared.idMap.get("b"),
        sourceHandle: "main",
        targetHandle: "main",
      },
    ]);
  });

  it("drops stray edges whose endpoints are not in the graph", () => {
    const prepared = prepareTemplateGraph({
      ...baseGraph,
      edges: [{ source: "a", target: "missing" }],
    });

    expect(prepared.edges).toHaveLength(0);
  });

  it("rewrites $node.<oldId> references in data, including nested values", () => {
    const prepared = prepareTemplateGraph({
      nodes: [
        trigger("a"),
        {
          ...sheets("b", {
            payload: {
              cells: {
                ref: "$node.a.main.value",
                wrapped: "prefix-$node.a.main.value-suffix",
              },
            },
          }),
        },
      ],
      edges: [{ source: "a", target: "b" }],
    });

    const data = prepared.nodes[1].data as Record<string, unknown>;
    const cells = (data.payload as Record<string, Record<string, unknown>>)
      .cells;

    expect(String(cells.ref)).toBe(
      `$node.${prepared.idMap.get("a")}.main.value`,
    );
    expect(String(cells.wrapped)).toBe(
      `prefix-$node.${prepared.idMap.get("a")}.main.value-suffix`,
    );
    expect(JSON.stringify(prepared.nodes[1].data)).not.toContain("$node.a");
  });

  it("strips credential-bound fields and preserves the rest of the config", () => {
    const prepared = prepareTemplateGraph(baseGraph);
    const data = prepared.nodes[1].data as Record<string, unknown>;

    expect("credentialId" in data).toBe(false);
    expect(data.spreadsheetId).toBe("abc123");
    expect(data.sheetName).toBe("Leads");
  });

  it("leaves nodes without credentials untouched", () => {
    const prepared = prepareTemplateGraph(baseGraph);
    expect(prepared.nodes[0].data).toEqual({});
  });

  it("throws UnknownNodeTypeError for an unregistered node type", () => {
    expect(() =>
      prepareTemplateGraph({
        nodes: [{ id: "x", type: "NO_SUCH_NODE", position: { x: 0, y: 0 } }],
        edges: [],
      }),
    ).toThrow(UnknownNodeTypeError);
  });

  it("throws when the graph is malformed", () => {
    expect(() =>
      prepareTemplateGraph({
        nodes: undefined,
        edges: [],
      } as unknown as TemplateGraph),
    ).toThrow(/nodes/);
  });
});

describe("collectPendingCredentials", () => {
  it("reports required credentials as required, optional ones as optional", () => {
    const pending = collectPendingCredentials([
      trigger("a"),
      sheets("b"),
      {
        id: "c",
        type: "AI_RETRIEVE",
        position: { x: 0, y: 0 },
      },
    ]);

    const sheetsReq = pending.find((p) => p.nodeId === "b");
    expect(sheetsReq).toMatchObject({
      nodeId: "b",
      nodeName: "GOOGLE_SHEETS_APPEND",
      credentialKey: "credentialId",
      credentialType: "google.oauth2",
      optional: false,
    });

    const aiReq = pending.find((p) => p.nodeId === "c");
    expect(aiReq).toMatchObject({
      credentialKey: "credentialId",
      credentialType: "openai.apiKey",
      optional: true,
    });
  });

  it("mirrors the registry's credential requirements", () => {
    const expected =
      nodeRegistry.resolve("GOOGLE_SHEETS_APPEND").credentials ?? [];
    expect(expected).toHaveLength(1);

    const pending = collectPendingCredentials([sheets("b")]);
    expect(pending[0]).toEqual({
      nodeId: "b",
      nodeName: "GOOGLE_SHEETS_APPEND",
      credentialKey: expected[0].key,
      credentialType: expected[0].type,
      optional: false,
    });
  });
});
