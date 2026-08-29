import { describe, expect, it } from "vitest";
import { saveWorkflowInputSchema } from "./schemas";

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
