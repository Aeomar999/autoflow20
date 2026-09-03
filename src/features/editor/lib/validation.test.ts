import { describe, expect, it } from "vitest";
import { validate } from "@/engine/validate";
import { clientNodeRegistry, toGraph } from "./validation";

/**
 * AF-M1-07 unit tests for the client catalogue adapter + canvas-draft
 * converter. Pure functions — no React, no Prisma, no DB, no network.
 */

describe("toGraph — canvas draft to validator graph", () => {
  it("maps nodes and normalises missing handles to main ports", () => {
    const graph = toGraph(
      [
        {
          id: "n1",
          type: "HTTP_REQUEST",
          name: "Fetch",
          data: { endpoint: "https://example.com" },
        },
      ],
      [
        {
          source: "t1",
          target: "n1",
          sourceHandle: null,
          targetHandle: undefined,
        },
      ],
    );
    expect(graph.nodes).toEqual([
      {
        id: "n1",
        name: "Fetch",
        type: "HTTP_REQUEST",
        data: { endpoint: "https://example.com" },
        // AF-M9-04: carried through so the canvas lint exempts a disabled
        // node's config exactly as the server does.
        disabled: false,
      },
    ]);
    expect(graph.connections).toEqual([
      {
        fromNodeId: "t1",
        toNodeId: "n1",
        fromOutput: "main",
        toInput: "main",
      },
    ]);
  });

  it("falls back node names to type, then id", () => {
    const graph = toGraph(
      [
        { id: "a", type: "HTTP_REQUEST", data: {} },
        { id: "b", data: {} },
      ],
      [],
    );
    expect(graph.nodes[0].name).toBe("HTTP_REQUEST");
    expect(graph.nodes[1].name).toBe("b");
  });

  it("preserves explicit handles", () => {
    const graph = toGraph(
      [{ id: "c1", type: "CONDITION", name: "Check", data: {} }],
      [
        {
          source: "c1",
          target: "a1",
          sourceHandle: "true",
          targetHandle: "main",
        },
      ],
    );
    expect(graph.connections).toEqual([
      {
        fromNodeId: "c1",
        toNodeId: "a1",
        fromOutput: "true",
        toInput: "main",
      },
    ]);
  });
});

describe("clientNodeRegistry — manifest-backed catalogue", () => {
  it("recognises registered types", () => {
    expect(clientNodeRegistry.has("MANUAL_TRIGGER")).toBe(true);
    expect(clientNodeRegistry.has("HTTP_REQUEST")).toBe(true);
    expect(clientNodeRegistry.resolve("MANUAL_TRIGGER").inputs).toEqual([]);
  });

  it("aliases legacy INITIAL to MANUAL_TRIGGER with parity checks", () => {
    expect(clientNodeRegistry.has("INITIAL")).toBe(true);
    const result = validate(
      {
        nodes: [
          { id: "t1", name: "Start", type: "INITIAL", data: {} },
          {
            id: "n1",
            name: "Fetch",
            type: "HTTP_REQUEST",
            data: { endpoint: "https://example.com" },
          },
        ],
        connections: [
          {
            fromNodeId: "t1",
            toNodeId: "n1",
            fromOutput: "main",
            toInput: "main",
          },
        ],
      },
      clientNodeRegistry,
    );
    const unknownTypeErrors = result.errors.filter((e) =>
      e.message.includes("Unknown node type"),
    );
    expect(unknownTypeErrors).toHaveLength(0);
    // Naming-based trigger check (INITIAL ≠ *_TRIGGER) matches the server:
    // the client lint must agree with saveGraph that this graph has no trigger.
    const triggerErrors = result.errors.filter((e) =>
      e.message.includes("no trigger"),
    );
    expect(triggerErrors).toHaveLength(1);
  });

  it("reports unknown types", () => {
    expect(clientNodeRegistry.has("NOPE")).toBe(false);
    expect(() => clientNodeRegistry.resolve("NOPE")).toThrow(
      /Unknown node type/,
    );
  });

  it("flags invalid configs with a field path via the shared validator", () => {
    const result = validate(
      {
        nodes: [
          { id: "t1", name: "Start", type: "MANUAL_TRIGGER", data: {} },
          {
            id: "n1",
            name: "Fetch",
            type: "HTTP_REQUEST",
            data: { endpoint: 12345 },
          },
        ],
        connections: [
          {
            fromNodeId: "t1",
            toNodeId: "n1",
            fromOutput: "main",
            toInput: "main",
          },
        ],
      },
      clientNodeRegistry,
    );
    const configErrors = result.errors.filter((e) =>
      e.message.startsWith("Config error:"),
    );
    expect(configErrors).toHaveLength(1);
    expect(configErrors[0].nodeId).toBe("n1");
    expect(configErrors[0].path).toBe("endpoint");
  });
});
