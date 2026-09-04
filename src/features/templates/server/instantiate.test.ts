import { describe, expect, it } from "vitest";
import { nodeRegistry, UnknownNodeTypeError } from "@/nodes/registry";
import {
  collectPendingCredentials,
  collectPendingSetup,
  prepareTemplateGraph,
  rewriteNodeRefs,
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

/**
 * AF-M8-15: `rewriteNodeRefs` applied each mapping in sequence over the
 * accumulating output, so a substituted new id could be matched again by a
 * later old id. Exercised directly with hand-built maps - going through
 * `prepareTemplateGraph` would depend on which cuids happen to be generated.
 */
describe("rewriteNodeRefs", () => {
  it("does not re-substitute an id it has already written", () => {
    // "a" maps to an id starting with "b", and "b" is itself a key: a
    // sequential replace rewrites the freshly written "b" a second time.
    const idMap = new Map([
      ["a", "b111"],
      ["b", "z999"],
    ]);

    expect(rewriteNodeRefs("$node.a.main.value", idMap)).toBe(
      "$node.b111.main.value",
    );
  });

  it("produces the same result regardless of map insertion order", () => {
    const forward = new Map([
      ["a", "b111"],
      ["b", "z999"],
    ]);
    const reverse = new Map([
      ["b", "z999"],
      ["a", "b111"],
    ]);
    const input = "$node.a.main.value and $node.b.main.value";

    expect(rewriteNodeRefs(input, forward)).toBe(
      rewriteNodeRefs(input, reverse),
    );
  });

  it("leaves an unmapped id alone even when a mapped id is its prefix", () => {
    // "a" is mapped; "abc" is a different node that is not in this graph.
    // A prefix-based replace would corrupt it to "$node.n1bc.main.value".
    const idMap = new Map([["a", "n1"]]);

    expect(rewriteNodeRefs("$node.abc.main.value", idMap)).toBe(
      "$node.abc.main.value",
    );
  });

  it("rewrites every occurrence in one string", () => {
    const idMap = new Map([["a", "n1"]]);

    expect(rewriteNodeRefs("$node.a.x + $node.a.y", idMap)).toBe(
      "$node.n1.x + $node.n1.y",
    );
  });

  it("leaves a reference with no mapping untouched", () => {
    expect(rewriteNodeRefs("$node.gone.main", new Map())).toBe(
      "$node.gone.main",
    );
  });
});

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
    // Rewritten ids are random cuids, so a bare `not.toContain("$node.a")`
    // would flake whenever a fresh cuid happens to start with "a" (the
    // rewritten `$node.ax...` contains the substring `$node.a`). Assert on the
    // exact reference token instead: the mapped reference is present, and the
    // old id's token is gone. A cuid is alphanumeric, so it can never collide
    // with the literal `.main.value` suffix, making this deterministic.
    const serialized = JSON.stringify(prepared.nodes[1].data);
    expect(serialized).toContain(`$node.${prepared.idMap.get("a")}.main.value`);
    expect(serialized).not.toContain("$node.a.main.value");
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
      // AF-M10-03: accepts the scoped type for new bindings and the
      // deprecated one for nodes saved before the split.
      credentialType: "google.sheets|google.oauth2",
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

describe("collectPendingSetup (AF-M10-25)", () => {
  const node = (data: Record<string, unknown>) => ({
    id: "n1",
    type: "GOOGLE_SHEETS_APPEND",
    name: "Log it",
    position: { x: 0, y: 0 },
    data,
  });

  it("finds a top-level placeholder", () => {
    expect(
      collectPendingSetup([node({ spreadsheetId: "REPLACE_WITH_SHEET_ID" })]),
    ).toEqual([
      {
        nodeId: "n1",
        nodeName: "Log it",
        field: "spreadsheetId",
        placeholder: "REPLACE_WITH_SHEET_ID",
      },
    ]);
  });

  it("finds one nested inside an array of mappings", () => {
    // The case that motivated the recursive walk: reporting only top-level
    // keys would have called this template ready to run.
    const found = collectPendingSetup([
      node({
        mappings: [{ key: "sheet", value: "REPLACE_WITH_SHEET_ID" }],
      }),
    ]);

    expect(found).toHaveLength(1);
    expect(found[0].field).toBe("mappings.0.value");
  });

  it("finds one embedded in a JSON string", () => {
    // `values` is authored as a JSON blob, so the placeholder is inside a
    // string rather than being one.
    const found = collectPendingSetup([
      node({ values: '{"Folder": "REPLACE_WITH_FOLDER_ID"}' }),
    ]);

    expect(found).toHaveLength(1);
    expect(found[0].placeholder).toBe("REPLACE_WITH_FOLDER_ID");
  });

  it("reports each occurrence, because each is an edit", () => {
    const found = collectPendingSetup([
      node({
        spreadsheetId: "REPLACE_WITH_SHEET_ID",
        sheetName: "REPLACE_WITH_TAB_NAME",
      }),
    ]);

    expect(found.map((v) => v.placeholder).sort()).toEqual([
      "REPLACE_WITH_SHEET_ID",
      "REPLACE_WITH_TAB_NAME",
    ]);
  });

  it("ignores prose that merely mentions replacing something", () => {
    // The pattern requires uppercase after the prefix so an AI prompt saying
    // "replace_with_the_customer_name" is not reported as setup.
    expect(
      collectPendingSetup([
        node({ text: "Replace with the customer name, replace_with_x." }),
      ]),
    ).toEqual([]);
  });

  it("survives a node with no data at all", () => {
    expect(
      collectPendingSetup([
        { id: "t", type: "MANUAL_TRIGGER", position: { x: 0, y: 0 } },
      ]),
    ).toEqual([]);
  });
});
