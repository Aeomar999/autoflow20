import { describe, expect, it } from "vitest";
import { nodeRegistry } from "@/nodes/registry";
import { saveWorkflowInputSchema, updateNodeSchemas } from "./schemas";

const position = { x: 0, y: 0 };

type TestNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
};

const validSave: {
  id: string;
  nodes: TestNode[];
  edges: Array<{ source: string; target: string }>;
  revision: number;
} = {
  id: "ckv9x0p1a0000abcd0000000",
  revision: 0,
  nodes: [
    {
      id: "n1",
      type: "INITIAL",
      position,
      data: {},
    },
    {
      id: "n2",
      type: "HTTP_REQUEST",
      position: { x: 100, y: 100 },
      data: {
        variableName: "response",
        endpoint: "https://api.example.com/{{user.id}}",
        method: "GET",
      },
    },
  ],
  edges: [{ source: "n1", target: "n2" }],
};

describe("saveWorkflowInputSchema (AF-A-04)", () => {
  it("accepts a well-formed save with react-flow noise fields stripped", () => {
    const noisy = {
      ...validSave,
      nodes: validSave.nodes.map((node) => ({
        ...node,
        dragging: false,
        selected: true,
        measured: { width: 100, height: 50 },
      })),
    };
    const parsed = saveWorkflowInputSchema.parse(noisy);
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.nodes[1]).not.toHaveProperty("dragging");
    expect(
      parsed.nodes.find((n) => n.type === "HTTP_REQUEST")?.data,
    ).toMatchObject({ method: "GET" });
  });

  it("rejects an unknown node type", () => {
    const bad = {
      ...validSave,
      nodes: [{ id: "x1", type: "NOT_A_TYPE", position, data: {} }],
    };
    expect(() => saveWorkflowInputSchema.parse(bad)).toThrow(/Invalid/);
  });

  it("reports a per-node path for a bad field", () => {
    const bad = {
      ...validSave,
      nodes: [
        ...validSave.nodes,
        {
          id: "n3",
          type: "HTTP_REQUEST",
          position,
          data: { method: "TELEPORT" },
        },
      ],
    };
    const result = saveWorkflowInputSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.startsWith("nodes.2.data.method"))).toBe(true);
    }
  });

  it.each([
    ["endpoint", "https://bad\n.example.com"],
    ["webhookUrl", "https://hooks.slack.com\t/x"],
  ])("blocks control characters in %s", (field, value) => {
    const bad = structuredClone(validSave);
    (bad as Record<string, unknown>).nodes = [
      {
        id: "n9",
        type: field === "endpoint" ? "HTTP_REQUEST" : "DISCORD",
        position,
        data: { [field]: value },
      },
    ];
    expect(saveWorkflowInputSchema.safeParse(bad).success).toBe(false);
  });

  it("enforces the identifier-safe variable name rule", () => {
    const bad = structuredClone(validSave);
    bad.nodes[1] = {
      id: "n2",
      type: "HTTP_REQUEST",
      position,
      data: { variableName: "my response" },
    };
    expect(saveWorkflowInputSchema.safeParse(bad).success).toBe(false);
  });

  it("allows multi-line message content and prompts", () => {
    const ok = structuredClone(validSave);
    ok.nodes[1] = {
      id: "n2",
      type: "SLACK",
      position,
      data: {
        content: "line one\nline two\n{{user.name}}",
      },
    };
    expect(saveWorkflowInputSchema.safeParse(ok).success).toBe(true);
  });

  it("caps oversized payloads", () => {
    const big = "a".repeat(70_001);
    const bad = structuredClone(validSave);
    bad.nodes[1] = {
      id: "n2",
      type: "HTTP_REQUEST",
      position,
      data: { body: big },
    };
    expect(saveWorkflowInputSchema.safeParse(bad).success).toBe(false);
  });

  it("keeps trigger nodes data-free but present", () => {
    const ok = structuredClone(validSave);
    ok.nodes[0].data = {};
    expect(saveWorkflowInputSchema.safeParse(ok).success).toBe(true);
  });
});

describe("saveWorkflowInputSchema — revision field (AF-M1-03)", () => {
  it("requires a non-negative integer revision", () => {
    expect(
      saveWorkflowInputSchema.safeParse({ ...validSave, revision: 0 }).success,
    ).toBe(true);
    expect(
      saveWorkflowInputSchema.safeParse({ ...validSave, revision: 5 }).success,
    ).toBe(true);
    expect(
      saveWorkflowInputSchema.safeParse({ ...validSave, revision: -1 }).success,
    ).toBe(false);
    expect(
      saveWorkflowInputSchema.safeParse({ ...validSave, revision: 1.5 })
        .success,
    ).toBe(false);
  });

  it("accepts an empty graph (no nodes, no edges)", () => {
    expect(
      saveWorkflowInputSchema.safeParse({
        id: validSave.id,
        nodes: [],
        edges: [],
        revision: 0,
      }).success,
    ).toBe(true);
  });

  it("accepts a graph with nodes but no edges", () => {
    expect(
      saveWorkflowInputSchema.safeParse({
        id: validSave.id,
        nodes: [validSave.nodes[0]],
        edges: [],
        revision: 0,
      }).success,
    ).toBe(true);
  });
});

describe("saveWorkflowInputSchema — connector nodes (AF-M1-06)", () => {
  it.each([
    [
      "EMAIL_SEND",
      {
        to: "ops@example.com",
        subject: "Deploy done",
        body: "All green",
        from: "ci@example.com",
        fromName: "CI",
      },
    ],
    [
      "WEBHOOK_OUT",
      {
        url: "https://hooks.example.com/flow",
        headers: { Authorization: "Bearer x" },
        body: "{}",
        timeoutMs: 500,
        failOnNon2xx: true,
      },
    ],
    [
      "GOOGLE_SHEETS_APPEND",
      { spreadsheetId: "1abc", sheetName: "Sheet1", values: '[[1, "a"]]' },
    ],
    [
      "AIRTABLE_CREATE_RECORD",
      { baseId: "app123", tableId: "tbl123", fields: '{"Name": "Ada"}' },
    ],
    ["HUBSPOT_CREATE_CONTACT", { properties: '{"email": "a@b.co"}' }],
    [
      "POSTGRES_QUERY",
      { query: "SELECT * FROM users WHERE id = $1", params: "[42]" },
    ],
    [
      "OPENAI_COMPATIBLE_CHAT",
      {
        baseUrl: "https://api.groq.com/openai/v1",
        model: "llama-3.3-70b-versatile",
        userPrompt: "Summarize",
      },
    ],
  ])("accepts a %s node with representative data", (type, data) => {
    const parsed = saveWorkflowInputSchema.safeParse({
      ...validSave,
      nodes: [{ id: "n2", type, position, data }],
    });
    expect(parsed.success).toBe(true);
  });
});

describe("saveWorkflowInputSchema — node metadata (AF-M1-06)", () => {
  it("round-trips name, notes, and disabled", () => {
    const parsed = saveWorkflowInputSchema.parse({
      ...validSave,
      nodes: [
        {
          ...validSave.nodes[1],
          name: "Fetch stats",
          notes: "pager on failure",
          disabled: true,
        },
      ],
    });
    expect(parsed.nodes[0]).toMatchObject({
      name: "Fetch stats",
      notes: "pager on failure",
      disabled: true,
    });
  });

  it("accepts nodes without any metadata", () => {
    const parsed = saveWorkflowInputSchema.parse(validSave);
    expect(parsed.nodes[0]).not.toHaveProperty("name");
    expect(parsed.nodes[1]).not.toHaveProperty("notes");
    expect(parsed.nodes[1]).not.toHaveProperty("disabled");
  });

  it("rejects a blank name and an oversized note", () => {
    expect(
      saveWorkflowInputSchema.safeParse({
        ...validSave,
        nodes: [{ ...validSave.nodes[1], name: "" }],
      }).success,
    ).toBe(false);
    expect(
      saveWorkflowInputSchema.safeParse({
        ...validSave,
        nodes: [{ ...validSave.nodes[1], notes: "x".repeat(501) }],
      }).success,
    ).toBe(false);
  });
});

/**
 * AF-M8-24: the saveable-type list in `schemas.ts` is hand-written, because
 * `z.discriminatedUnion` needs a literal type per entry. Hand-written means it
 * drifts, and both directions of drift are silent and serious:
 *
 * - A registered type missing from the union cannot be SAVED. `AI_LLM` and
 *   `AI_EXTRACT` were in exactly that state - shipped in M5, present in the
 *   palette, rejected by this input schema before the handler ran.
 * - A deleted type still in the union throws `UnknownNodeTypeError` at import,
 *   which is what AF-M8-12 did to the retired AI trio.
 *
 * This is the guard that makes either failure loud, and it names the type.
 */
describe("saveable types track the registry (AF-M8-24)", () => {
  /** The legacy alias predates the registry and has no manifest entry. */
  const ALIASES = new Set(["INITIAL"]);

  const saveable = new Set(
    updateNodeSchemas.map(
      (schema) => (schema.shape.type as { value: string }).value,
    ),
  );
  const registered = new Set(nodeRegistry.list().map((definition) => definition.type));

  it("can save every registered node type", () => {
    const unsaveable = [...registered].filter((type) => !saveable.has(type));

    expect(
      unsaveable,
      `these node types are registered but cannot be saved: ${unsaveable.join(", ")}`,
    ).toEqual([]);
  });

  it("lists no type the registry cannot resolve", () => {
    const orphaned = [...saveable].filter(
      (type) => !registered.has(type) && !ALIASES.has(type),
    );

    expect(
      orphaned,
      `these types are saveable but not registered, which throws at import: ${orphaned.join(", ")}`,
    ).toEqual([]);
  });

  it("covers a non-trivial number of types", () => {
    // Guard the guard: two empty sets would satisfy both assertions above.
    expect(saveable.size).toBeGreaterThan(10);
  });
});

describe("saveWorkflowInputSchema — per-node run policy (AF-M9-06)", () => {
  /**
   * Regression: `_run` used to be stripped here.
   *
   * `configOf` returned the node's bare `configSchema`, and Zod strips unknown
   * keys — so the run policy the config panel writes was discarded on every
   * save. Setting retries in the UI appeared to work and silently did nothing,
   * and all three M9 reference templates shipped a `_run` that never survived
   * installation. This is the same class of defect AF-M9-06 was written to end
   * (`_timeoutMs`/`_continueOnFail` "appeared in no configSchema", so "the save
   * boundary was free to drop them") reappearing in the key that replaced them.
   */
  it("persists a run policy through the save boundary", () => {
    const parsed = saveWorkflowInputSchema.parse({
      ...validSave,
      nodes: [
        {
          ...validSave.nodes[1],
          data: {
            ...validSave.nodes[1].data,
            _run: { maxAttempts: 3, backoffMs: 1000, timeoutMs: 10_000 },
          },
        },
      ],
    });

    expect(parsed.nodes[0].data).toMatchObject({
      _run: { maxAttempts: 3, backoffMs: 1000, timeoutMs: 10_000 },
    });
  });

  it("keeps the node's own config alongside the policy", () => {
    const parsed = saveWorkflowInputSchema.parse({
      ...validSave,
      nodes: [
        {
          ...validSave.nodes[1],
          data: {
            ...validSave.nodes[1].data,
            _run: { continueOnFail: true },
          },
        },
      ],
    });

    const data = parsed.nodes[0].data as Record<string, unknown>;
    expect(data.variableName).toBe("response");
    expect(data._run).toEqual({ continueOnFail: true });
  });

  it("omits the key entirely when no policy is set", () => {
    const parsed = saveWorkflowInputSchema.parse(validSave);
    expect(parsed.nodes[1].data).not.toHaveProperty("_run");
  });

  it("rejects an out-of-bounds policy instead of dropping it", () => {
    // Silently discarding a bad value would be the old behaviour wearing a
    // different hat: the user must be told, not quietly ignored.
    const result = saveWorkflowInputSchema.safeParse({
      ...validSave,
      nodes: [
        {
          ...validSave.nodes[1],
          data: { ...validSave.nodes[1].data, _run: { maxAttempts: 99 } },
        },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("_run"))).toBe(
        true,
      );
    }
  });

  it("still rejects an invalid node config", () => {
    // The split-and-rejoin must not weaken the config half.
    const result = saveWorkflowInputSchema.safeParse({
      ...validSave,
      nodes: [
        {
          ...validSave.nodes[1],
          data: { variableName: "not a valid name!", _run: { maxAttempts: 2 } },
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("accepts a run policy on every registered node type", () => {
    // A shape-agnostic implementation is the point: `triggerDataSchema` is
    // `z.object({}).optional()` and AGGREGATE's is `z.object({}).default({})`,
    // neither of which exposes `.extend`.
    const broken: string[] = [];
    for (const def of nodeRegistry.list()) {
      const schema = updateNodeSchemas.find(
        (s) => s.shape.type.value === def.type,
      );
      if (!schema) continue;
      const result = schema.safeParse({
        id: "n1",
        type: def.type,
        position,
        data: { ...(def.defaults as object), _run: { maxAttempts: 2 } },
      });
      const data = result.success
        ? (result.data.data as Record<string, unknown>)
        : undefined;
      if (!result.success || data?._run === undefined) {
        broken.push(def.type);
      }
    }
    expect(broken).toEqual([]);
  });
});
