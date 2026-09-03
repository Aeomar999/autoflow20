import { describe, expect, it } from "vitest";
import { z } from "zod";
import { configSchema as switchConfigSchema } from "@/nodes/core/switch/definition";
import { type Graph, type ValidationRegistry, validate } from "./validate";

/**
 * AF-M2-02 unit tests for the shared graph validator.
 *
 * Test helpers build minimal graphs inline. No Prisma, no DB, no Inngest.
 */

function makeNode(
  id: string,
  type: string,
  name?: string,
  data: Record<string, unknown> = {},
) {
  return { id, type, name: name ?? id, data };
}

function makeEdge(
  from: string,
  to: string,
  fromOutput = "main",
  toInput = "main",
) {
  return { fromNodeId: from, toNodeId: to, fromOutput, toInput };
}

function errorsOf(result: ReturnType<typeof validate>) {
  return result.errors.filter((e) => e.severity === "error");
}

function warningsOf(result: ReturnType<typeof validate>) {
  return result.errors.filter((e) => e.severity === "warning");
}

// ---------------------------------------------------------------------------
// Graph topology tests
// ---------------------------------------------------------------------------

describe("validate — graph topology", () => {
  it("accepts a single trigger node", () => {
    const graph: Graph = {
      nodes: [makeNode("t1", "MANUAL_TRIGGER", "Start")],
      connections: [],
    };
    const result = validate(graph);
    expect(errorsOf(result)).toHaveLength(0);
    expect(result.order).toEqual(["t1"]);
  });

  it("accepts a linear two-node graph", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("n1", "HTTP_REQUEST", "Fetch"),
      ],
      connections: [makeEdge("t1", "n1")],
    };
    const result = validate(graph);
    expect(errorsOf(result)).toHaveLength(0);
    expect(result.order).toEqual(["t1", "n1"]);
  });

  it("accepts a branching graph (condition → true/false)", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("c1", "CONDITION", "Check"),
        makeNode("a1", "HTTP_REQUEST", "Yes"),
        makeNode("a2", "SLACK", "No"),
      ],
      connections: [
        makeEdge("t1", "c1"),
        makeEdge("c1", "a1", "true", "main"),
        makeEdge("c1", "a2", "false", "main"),
      ],
    };
    const result = validate(graph);
    expect(errorsOf(result)).toHaveLength(0);
    expect(result.order).toEqual(["t1", "c1", "a1", "a2"]);
  });

  it("accepts a diamond graph", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("n1", "HTTP_REQUEST", "A"),
        makeNode("n2", "HTTP_REQUEST", "B"),
        makeNode("n3", "HTTP_REQUEST", "Merge"),
      ],
      connections: [
        makeEdge("t1", "n1"),
        makeEdge("t1", "n2"),
        makeEdge("n1", "n3"),
        makeEdge("n2", "n3"),
      ],
    };
    const result = validate(graph);
    expect(errorsOf(result)).toHaveLength(0);
    expect(result.order).toEqual(["t1", "n1", "n2", "n3"]);
  });

  it("detects a cycle", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("n1", "HTTP_REQUEST", "A"),
        makeNode("n2", "HTTP_REQUEST", "B"),
      ],
      connections: [
        makeEdge("t1", "n1"),
        makeEdge("n1", "n2"),
        makeEdge("n2", "n1"),
      ],
    };
    const result = validate(graph);
    const cycleErrors = errorsOf(result).filter((e) =>
      e.message.includes("cycle"),
    );
    expect(cycleErrors).toHaveLength(1);
    expect(result.order).toEqual([]);
  });

  it("reports disconnected nodes as warnings", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("n1", "HTTP_REQUEST", "Connected"),
        makeNode("n2", "HTTP_REQUEST", "Orphan"),
      ],
      connections: [makeEdge("t1", "n1")],
    };
    const result = validate(graph);
    expect(errorsOf(result)).toHaveLength(0);
    const warnings = warningsOf(result);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].nodeId).toBe("n2");
    expect(warnings[0].message).toContain("not reachable");
  });

  it("reports an empty graph as valid", () => {
    const graph: Graph = { nodes: [], connections: [] };
    const result = validate(graph);
    expect(errorsOf(result)).toHaveLength(0);
    expect(result.order).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Trigger checks
// ---------------------------------------------------------------------------

describe("validate — trigger checks", () => {
  it("errors when no trigger is present", () => {
    const graph: Graph = {
      nodes: [makeNode("n1", "HTTP_REQUEST", "Fetch")],
      connections: [],
    };
    const result = validate(graph);
    const triggerErrors = errorsOf(result).filter((e) =>
      e.message.includes("no trigger"),
    );
    expect(triggerErrors).toHaveLength(1);
  });

  it("errors when multiple triggers are present", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Manual"),
        makeNode("t2", "STRIPE_TRIGGER", "Stripe"),
      ],
      connections: [],
    };
    const result = validate(graph);
    const triggerErrors = errorsOf(result).filter((e) =>
      e.message.includes("Multiple trigger"),
    );
    expect(triggerErrors).toHaveLength(2);
  });

  it("warns when the only trigger is disabled (AF-M9-17)", () => {
    const graph: Graph = {
      nodes: [
        { ...makeNode("t1", "WEBHOOK_TRIGGER", "Webhook"), disabled: true },
      ],
      connections: [],
    };
    const result = validate(graph);
    expect(errorsOf(result)).toHaveLength(0);
    const warning = warningsOf(result).filter((e) =>
      e.message.includes("only trigger"),
    );
    expect(warning).toHaveLength(1);
    expect(warning[0].nodeId).toBe("t1");
    expect(warning[0].message).toContain("Webhook");
  });

  it("does not warn when a non-trigger node is disabled (AF-M9-17)", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        { ...makeNode("n1", "HTTP_REQUEST", "Fetch"), disabled: true },
      ],
      connections: [makeEdge("t1", "n1")],
    };
    const result = validate(graph);
    const warning = warningsOf(result).filter((e) =>
      e.message.includes("only trigger"),
    );
    expect(warning).toHaveLength(0);
  });

  it("recognizes GOOGLE_FORM_TRIGGER as a trigger", () => {
    const graph: Graph = {
      nodes: [makeNode("t1", "GOOGLE_FORM_TRIGGER", "Form")],
      connections: [],
    };
    const result = validate(graph);
    const triggerErrors = errorsOf(result).filter((e) =>
      e.message.includes("trigger"),
    );
    expect(triggerErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Registry-dependent checks (simulated)
// ---------------------------------------------------------------------------

describe("validate — unknown types", () => {
  it("errors on unknown node type when registry is provided", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("n1", "UNKNOWN_TYPE", "Bad"),
      ],
      connections: [makeEdge("t1", "n1")],
    };

    // Minimal mock registry that only knows MANUAL_TRIGGER.
    const registry = {
      has: (type: string) => type === "MANUAL_TRIGGER",
      resolve: (type: string) => {
        if (type === "MANUAL_TRIGGER") {
          return {
            type: "MANUAL_TRIGGER",
            version: 1,
            category: "TRIGGER",
            label: "Manual",
            description: "",
            icon: "",
            configSchema: { safeParse: () => ({ success: true }) },
            defaults: {},
            inputs: [],
            outputs: [],
          } as never;
        }
        throw new Error(`Unknown: ${type}`);
      },
      list: () => [],
    } as never;

    const result = validate(graph, registry);
    const typeErrors = errorsOf(result).filter((e) =>
      e.message.includes("Unknown node type"),
    );
    expect(typeErrors).toHaveLength(1);
    expect(typeErrors[0].nodeId).toBe("n1");
  });

  it("skips type checks when no registry is provided", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("n1", "ANYTHING", "ok"),
      ],
      connections: [makeEdge("t1", "n1")],
    };
    const result = validate(graph);
    const typeErrors = errorsOf(result).filter((e) =>
      e.message.includes("Unknown node type"),
    );
    expect(typeErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Deterministic ordering
// ---------------------------------------------------------------------------

describe("validate — deterministic ordering", () => {
  it("produces the same order for identical graphs", () => {
    const graph: Graph = {
      nodes: [
        makeNode("z1", "HTTP_REQUEST", "Z"),
        makeNode("a1", "MANUAL_TRIGGER", "A"),
        makeNode("m1", "SLACK", "M"),
      ],
      connections: [makeEdge("a1", "z1"), makeEdge("z1", "m1")],
    };
    const order1 = validate(graph).order;
    const order2 = validate(graph).order;
    expect(order1).toEqual(order2);
  });

  it("sorts isolated nodes alphabetically by id", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("c2", "HTTP_REQUEST", "B"),
        makeNode("a1", "HTTP_REQUEST", "A"),
      ],
      connections: [makeEdge("t1", "a1")],
    };
    const result = validate(graph);
    expect(result.order).toEqual(["t1", "a1", "c2"]);
  });
});

// ---------------------------------------------------------------------------
// Registry-backed config + input validation (AF-M1-07)
// ---------------------------------------------------------------------------

describe("validate — config validation with a real registry", () => {
  const registry: ValidationRegistry = {
    has: (type) => type === "MANUAL_TRIGGER" || type === "HTTP_REQUEST",
    resolve: (type) => {
      if (type === "MANUAL_TRIGGER") {
        return {
          configSchema: z.object({}),
          inputs: [],
        };
      }
      if (type === "HTTP_REQUEST") {
        return {
          configSchema: z.object({ endpoint: z.url().optional() }),
          inputs: [{ id: "main", required: true }],
        };
      }
      throw new Error(`Unknown node type: "${type}".`);
    },
  };

  it("flags an invalid config with a field path", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("n1", "HTTP_REQUEST", "Fetch", { endpoint: 12345 }),
      ],
      connections: [makeEdge("t1", "n1")],
    };
    const result = validate(graph, registry);
    const configErrors = errorsOf(result).filter((e) =>
      e.message.startsWith("Config error:"),
    );
    expect(configErrors).toHaveLength(1);
    expect(configErrors[0].nodeId).toBe("n1");
    expect(configErrors[0].path).toBe("endpoint");
  });

  it("accepts a valid config", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("n1", "HTTP_REQUEST", "Fetch", {
          endpoint: "https://example.com",
        }),
      ],
      connections: [makeEdge("t1", "n1")],
    };
    const result = validate(graph, registry);
    expect(errorsOf(result)).toHaveLength(0);
  });

  it("flags an unconnected required input with a main-port path", () => {
    const graph: Graph = {
      nodes: [
        makeNode("n1", "HTTP_REQUEST", "Fetch", {
          endpoint: "https://example.com",
        }),
      ],
      connections: [],
    };
    const result = validate(graph, registry);
    const inputErrors = errorsOf(result).filter((e) =>
      e.message.includes("input"),
    );
    expect(inputErrors).toHaveLength(1);
    expect(inputErrors[0].nodeId).toBe("n1");
    expect(inputErrors[0].path).toBe("inputs.main");
  });

  it("clears the required-input error once connected", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("n1", "HTTP_REQUEST", "Fetch", {
          endpoint: "https://example.com",
        }),
      ],
      connections: [makeEdge("t1", "n1")],
    };
    const result = validate(graph, registry);
    const inputErrors = errorsOf(result).filter((e) =>
      e.message.includes("input"),
    );
    expect(inputErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Orphaned SWITCH output ports (AF-M9-09, gap: renaming detaches edges)
// ---------------------------------------------------------------------------

describe("validate — orphaned SWITCH output ports", () => {
  const registry: ValidationRegistry = {
    has: (type) => type === "MANUAL_TRIGGER" || type === "SWITCH",
    resolve: (type) => {
      if (type === "MANUAL_TRIGGER") {
        return { configSchema: z.object({}), inputs: [] };
      }
      if (type === "SWITCH") {
        return {
          configSchema: switchConfigSchema,
          inputs: [{ id: "main", required: true }],
        };
      }
      throw new Error(`Unknown node type: "${type}".`);
    },
  };

  const validRules = [
    { outputKey: "low", left: "{{x}}", operator: "lte", right: "10" },
  ];

  it("accepts an edge whose source output still exists", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("sw", "SWITCH", "Route", {
          rules: validRules,
          fallback: "none",
        }),
      ],
      connections: [makeEdge("sw", "t1", "low")],
    };
    const result = validate(graph, registry);
    expect(
      errorsOf(result).filter((e) =>
        e.message.includes("would be silently detached"),
      ),
    ).toHaveLength(0);
  });

  it("reports an edge to a renamed (orphaned) output port", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("sw", "SWITCH", "Route", {
          // Rule was renamed from "oldBranch" (the edge still targets it) to "low".
          rules: validRules,
          fallback: "none",
        }),
      ],
      // Edge still points at the pre-rename output key.
      connections: [makeEdge("sw", "t1", "oldBranch")],
    };
    const result = validate(graph, registry);
    const orphaned = errorsOf(result).filter((e) =>
      e.message.includes("would be silently detached"),
    );
    expect(orphaned).toHaveLength(1);
    expect(orphaned[0].nodeId).toBe("sw");
    expect(orphaned[0].path).toBe("outputs.oldBranch");
    expect(orphaned[0].message).toContain('Output port "oldBranch"');
  });
});

// ---------------------------------------------------------------------------
// Disabled nodes (AF-M9-04, gap G10)
// ---------------------------------------------------------------------------

describe("validate — disabled nodes", () => {
  const registry: ValidationRegistry = {
    has: (type) => type === "MANUAL_TRIGGER" || type === "HTTP_REQUEST",
    resolve: (type) => {
      if (type === "MANUAL_TRIGGER") {
        return { configSchema: z.object({}), inputs: [] };
      }
      if (type === "HTTP_REQUEST") {
        return {
          configSchema: z.object({ endpoint: z.url() }),
          inputs: [{ id: "main", required: true }],
        };
      }
      throw new Error(`Unknown node type: "${type}".`);
    },
  };

  function disabled(node: ReturnType<typeof makeNode>) {
    return { ...node, disabled: true };
  }

  it("exempts a disabled node's invalid config", () => {
    // Turning a node off is how you park work in progress. If a half-finished
    // config on a disabled node still blocked the save, the toggle would be
    // useless for the thing people actually use it for.
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        disabled(makeNode("n1", "HTTP_REQUEST", "Fetch", { endpoint: 12345 })),
      ],
      connections: [makeEdge("t1", "n1")],
    };
    const configErrors = errorsOf(validate(graph, registry)).filter((e) =>
      e.message.startsWith("Config error:"),
    );
    expect(configErrors).toHaveLength(0);
  });

  it("still flags the same invalid config when the node is enabled", () => {
    // The exemption must be the disabled flag, not the test fixture.
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("n1", "HTTP_REQUEST", "Fetch", { endpoint: 12345 }),
      ],
      connections: [makeEdge("t1", "n1")],
    };
    const configErrors = errorsOf(validate(graph, registry)).filter((e) =>
      e.message.startsWith("Config error:"),
    );
    expect(configErrors).toHaveLength(1);
    expect(configErrors[0].nodeId).toBe("n1");
  });

  it("exempts a disabled node's unconnected required input", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        disabled(
          makeNode("n1", "HTTP_REQUEST", "Fetch", {
            endpoint: "https://example.com",
          }),
        ),
      ],
      connections: [],
    };
    const inputErrors = errorsOf(validate(graph, registry)).filter((e) =>
      e.message.includes("Required input"),
    );
    expect(inputErrors).toHaveLength(0);
  });

  it("does not report a required input fed only by a disabled node", () => {
    // A disabled node passes its input through (AF-M9-04), so the downstream
    // node IS still fed at run time — reporting it unconnected would be wrong.
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        disabled(
          makeNode("off", "HTTP_REQUEST", "Off", {
            endpoint: "https://example.com",
          }),
        ),
        makeNode("n2", "HTTP_REQUEST", "Downstream", {
          endpoint: "https://example.com",
        }),
      ],
      connections: [makeEdge("t1", "off"), makeEdge("off", "n2")],
    };
    const inputErrors = errorsOf(validate(graph, registry)).filter((e) =>
      e.message.includes("Required input"),
    );
    expect(inputErrors).toHaveLength(0);
  });

  it("still reports an unknown type on a disabled node", () => {
    // The engine resolves every node's registration to build the plan, so an
    // unknown type is fatal whether or not the node is switched off.
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        disabled(makeNode("n1", "NOT_A_TYPE", "Ghost")),
      ],
      connections: [makeEdge("t1", "n1")],
    };
    const unknownErrors = errorsOf(validate(graph, registry)).filter((e) =>
      e.message.startsWith("Unknown node type"),
    );
    expect(unknownErrors).toHaveLength(1);
  });

  it("still detects a cycle that runs through a disabled node", () => {
    // Structural checks are about the graph, not about what executes.
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        disabled(
          makeNode("a", "HTTP_REQUEST", "A", {
            endpoint: "https://example.com",
          }),
        ),
        makeNode("b", "HTTP_REQUEST", "B", {
          endpoint: "https://example.com",
        }),
      ],
      connections: [
        makeEdge("t1", "a"),
        makeEdge("a", "b"),
        makeEdge("b", "a"),
      ],
    };
    const cycleErrors = errorsOf(validate(graph, registry)).filter((e) =>
      e.message.includes("cycle"),
    );
    expect(cycleErrors).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Run policy (AF-M9-06)
// ---------------------------------------------------------------------------

describe("validate — run policy", () => {
  const registry: ValidationRegistry = {
    has: (type) => type === "MANUAL_TRIGGER" || type === "HTTP_REQUEST",
    resolve: (type) => {
      if (type === "MANUAL_TRIGGER") {
        return { configSchema: z.object({}), inputs: [] };
      }
      if (type === "HTTP_REQUEST") {
        return {
          configSchema: z.object({ endpoint: z.url().optional() }),
          inputs: [{ id: "main" }],
        };
      }
      throw new Error(`Unknown node type: "${type}".`);
    },
  };

  function graphWithPolicy(policy: unknown): Graph {
    return {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("n1", "HTTP_REQUEST", "Fetch", {
          endpoint: "https://example.com",
          _run: policy,
        }),
      ],
      connections: [makeEdge("t1", "n1")],
    };
  }

  function policyErrors(graph: Graph) {
    return errorsOf(validate(graph, registry)).filter((e) =>
      e.message.startsWith("Run settings:"),
    );
  }

  it("accepts a valid policy", () => {
    expect(
      policyErrors(
        graphWithPolicy({
          maxAttempts: 3,
          backoffMs: 500,
          timeoutMs: 5000,
          continueOnFail: true,
        }),
      ),
    ).toHaveLength(0);
  });

  it("accepts a node with no policy at all", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("n1", "HTTP_REQUEST", "Fetch", {
          endpoint: "https://example.com",
        }),
      ],
      connections: [makeEdge("t1", "n1")],
    };
    expect(policyErrors(graph)).toHaveLength(0);
  });

  it("reports an out-of-range attempt count against the reserved path", () => {
    // Same error channel as a bad endpoint, so the config panel can point at
    // the offending field rather than showing a generic save failure.
    const found = policyErrors(graphWithPolicy({ maxAttempts: 99 }));
    expect(found).toHaveLength(1);
    expect(found[0].nodeId).toBe("n1");
    expect(found[0].path).toBe("_run.maxAttempts");
  });

  it("reports a timeout below the floor", () => {
    const found = policyErrors(graphWithPolicy({ timeoutMs: 1 }));
    expect(found).toHaveLength(1);
    expect(found[0].path).toBe("_run.timeoutMs");
  });

  it("reports a policy that is not an object", () => {
    expect(policyErrors(graphWithPolicy("fast")).length).toBeGreaterThan(0);
  });

  it("does not report the policy of a disabled node", () => {
    // Consistent with AF-M9-04: a node that cannot run cannot fail a run.
    const graph = graphWithPolicy({ maxAttempts: 99 });
    graph.nodes[1] = { ...graph.nodes[1], disabled: true };
    expect(policyErrors(graph)).toHaveLength(0);
  });

  it("does not let the reserved key trip the node's own config schema", () => {
    // `_run` is not a field any node declares; a non-strict Zod object strips
    // it, and this pins that so a future `.strict()` cannot silently break
    // every saved node that carries a policy.
    const configErrors = errorsOf(
      validate(graphWithPolicy({ maxAttempts: 2 }), registry),
    ).filter((e) => e.message.startsWith("Config error:"));
    expect(configErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Template root inference (AF-M9-07)
// ---------------------------------------------------------------------------

describe("validate — template root inference", () => {
  it("does not warn on a template under an always-present meta root", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("n1", "HTTP_REQUEST", "Fetch", {
          endpoint: "https://example.com/{{$json.body.x}}",
        }),
      ],
      connections: [makeEdge("t1", "n1")],
    };
    const warnings = warningsOf(validate(graph)).filter((e) =>
      e.message.includes("unknown root"),
    );
    expect(warnings).toHaveLength(0);
  });

  it("does not warn on a data root produced by a node's variableName", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("n1", "HTTP_REQUEST", "Fetch", { variableName: "res" }),
        makeNode("n2", "HTTP_REQUEST", "Report", {
          endpoint: "https://example.com/{{res.httpResponse.data}}",
        }),
      ],
      connections: [makeEdge("t1", "n1"), makeEdge("n1", "n2")],
    };
    const warnings = warningsOf(validate(graph)).filter((e) =>
      e.message.includes("unknown root"),
    );
    expect(warnings).toHaveLength(0);
  });

  it("does not treat helper callees as roots", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("n1", "HTTP_REQUEST", "Fetch", {
          endpoint: 'https://example.com/{{default name "n/a"}}',
        }),
      ],
      connections: [makeEdge("t1", "n1")],
    };
    const warnings = warningsOf(validate(graph)).filter((e) =>
      e.message.includes("unknown root"),
    );
    // Only the genuinely-unknown data arg `name` is flagged, never `default`.
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('unknown root "name"');
  });

  it("accepts webhook-trigger context roots via the webhook.* mapping", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "WEBHOOK_TRIGGER", "In"),
        makeNode("n1", "HTTP_REQUEST", "Fetch", {
          endpoint: "https://example.com/{{webhook.body.userId}}",
        }),
      ],
      connections: [makeEdge("t1", "n1")],
    };
    const warnings = warningsOf(validate(graph)).filter((e) =>
      e.message.includes("unknown root"),
    );
    expect(warnings).toHaveLength(0);
  });

  it("warns on a stale n8n root that the graph cannot produce", () => {
    // `$json.body` is n8n's idiom; AutoFlow's accumulated context has no
    // top-level `body` key, so it must be caught at save time — the acceptance
    // case for AF-M9-07.
    const graph: Graph = {
      nodes: [
        makeNode("t1", "WEBHOOK_TRIGGER", "In"),
        makeNode("n1", "HTTP_REQUEST", "Fetch", {
          endpoint: "https://example.com/{{body.userId}}",
        }),
      ],
      connections: [makeEdge("t1", "n1")],
    };
    const warnings = warningsOf(validate(graph)).filter((e) =>
      e.message.includes("unknown root"),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].nodeId).toBe("n1");
    expect(warnings[0].message).toContain('unknown root "body"');
    expect(warnings[0].message).toContain("webhook.body");
  });

  it("collects roots from nested config bags (e.g. SET mappings)", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "WEBHOOK_TRIGGER", "In"),
        makeNode("n1", "SET", "Map", {
          mappings: [{ key: "displayName", value: "{{webhook.body.name}}" }],
        }),
        makeNode("n2", "HTTP_REQUEST", "Fetch", {
          endpoint: "https://example.com/{{staleField.path}}",
        }),
      ],
      connections: [makeEdge("t1", "n1"), makeEdge("n1", "n2")],
    };
    const warnings = warningsOf(validate(graph)).filter((e) =>
      e.message.includes("unknown root"),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('unknown root "staleField"');
  });

  it("lets SET mapping keys be valid downstream roots", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "WEBHOOK_TRIGGER", "In"),
        makeNode("n1", "SET", "Map", {
          mappings: [
            { key: "user.name", value: "{{webhook.body.name}}" },
            { key: "displayName", value: "{{webhook.body.name}}" },
          ],
        }),
        makeNode("n2", "HTTP_REQUEST", "Fetch", {
          endpoint: "https://example.com/{{user.name.upper}}",
        }),
      ],
      connections: [makeEdge("t1", "n1"), makeEdge("n1", "n2")],
    };
    const warnings = warningsOf(validate(graph)).filter((e) =>
      e.message.includes("unknown root"),
    );
    expect(warnings).toHaveLength(0);
  });

  it("does not warn on templates that carry no data-root reference", () => {
    // A helper call with only literal arguments references no data root, so it
    // must not trigger an unknown-root warning.
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("n1", "HTTP_REQUEST", "Fetch", {
          endpoint: "https://example.com/{{default 5 7}}",
        }),
      ],
      connections: [makeEdge("t1", "n1")],
    };
    const warnings = warningsOf(validate(graph)).filter((e) =>
      e.message.includes("unknown root"),
    );
    expect(warnings).toHaveLength(0);
  });

  it("does not warn on templates on a disabled node (AF-M9-04 parity)", () => {
    // `disabled` is a node-level field, not part of the config bag; a disabled
    // node's half-written template is the same "cannot run, cannot fail" case
    // the run-policy skip covers.
    const graph: Graph = {
      nodes: [
        makeNode("t1", "WEBHOOK_TRIGGER", "In"),
        {
          id: "n1",
          type: "HTTP_REQUEST",
          name: "Off",
          data: { endpoint: "https://example.com/{{totallyWrong.x}}" },
          disabled: true,
        },
      ],
      connections: [makeEdge("t1", "n1")],
    };
    const warnings = warningsOf(validate(graph)).filter((e) =>
      e.message.includes("unknown root"),
    );
    expect(warnings).toHaveLength(0);
  });

  it("ignores an unparseable template rather than warning on roots", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("n1", "HTTP_REQUEST", "Fetch", {
          endpoint: "https://example.com/{{#busted",
        }),
      ],
      connections: [makeEdge("t1", "n1")],
    };
    const warnings = warningsOf(validate(graph)).filter((e) =>
      e.message.includes("unknown root"),
    );
    expect(warnings).toHaveLength(0);
  });

  it("accepts the schedule root from a scheduled trigger", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "SCHEDULE_TRIGGER", "Every 5m"),
        makeNode("n1", "HTTP_REQUEST", "Alert", {
          endpoint: "https://example.com/check?at={{schedule.timestamp}}",
        }),
      ],
      connections: [makeEdge("t1", "n1")],
    };
    const warnings = warningsOf(validate(graph)).filter((e) =>
      e.message.includes("unknown root"),
    );
    expect(warnings).toHaveLength(0);
  });

  it("accepts the googleForm root from a google-form trigger", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "GOOGLE_FORM_TRIGGER", "Form"),
        makeNode("n1", "SET", "Map", {
          mappings: [
            { key: "row_email", value: "{{googleForm.respondentEmail}}" },
            { key: "row_answers", value: "{{googleForm.responses}}" },
          ],
        }),
      ],
      connections: [makeEdge("t1", "n1")],
    };
    const warnings = warningsOf(validate(graph)).filter((e) =>
      e.message.includes("unknown root"),
    );
    expect(warnings).toHaveLength(0);
  });

  it("accepts the stripe root from a stripe trigger", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "STRIPE_TRIGGER", "Payment"),
        makeNode("n1", "HTTP_REQUEST", "Log", {
          endpoint: "https://example.com/{{stripe.raw.amount}}",
        }),
      ],
      connections: [makeEdge("t1", "n1")],
    };
    const warnings = warningsOf(validate(graph)).filter((e) =>
      e.message.includes("unknown root"),
    );
    expect(warnings).toHaveLength(0);
  });

  it("accepts a manual trigger's flat-spread JSON payload keys", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start", {
          payload:
            '{"title":"Checkout latency spike","severity":"SEV2","notes":"p95 up"}',
        }),
        makeNode("n1", "SET", "Map", {
          mappings: [
            { key: "incident_title", value: "{{title}}" },
            { key: "incident_severity", value: "{{severity}}" },
            { key: "incident_notes", value: "{{notes}}" },
          ],
        }),
      ],
      connections: [makeEdge("t1", "n1")],
    };
    const warnings = warningsOf(validate(graph)).filter((e) =>
      e.message.includes("unknown root"),
    );
    expect(warnings).toHaveLength(0);
  });

  it("does not treat an unparseable manual payload as producing roots", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start", { payload: "not-json{{{" }),
        makeNode("n1", "HTTP_REQUEST", "Fetch", {
          endpoint: "https://example.com/{{madeUp.field}}",
        }),
      ],
      connections: [makeEdge("t1", "n1")],
    };
    const warnings = warningsOf(validate(graph)).filter((e) =>
      e.message.includes("unknown root"),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('unknown root "madeUp"');
  });
});

// ---------------------------------------------------------------------------
// Fan-out segment shape (AF-M9-14, ADR-0021)
// ---------------------------------------------------------------------------

describe("validate — fan-out segment shape (AF-M9-14)", () => {
  const SEGMENT_ERROR = /fan-out|AGGREGATE|SPLIT_OUT|nested|Crossing edge/i;

  it("accepts a single well-formed SPLIT_OUT → interior → AGGREGATE segment", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("s1", "SPLIT_OUT", "Split"),
        makeNode("i1", "SET", "Interior"),
        makeNode("a1", "AGGREGATE", "Aggregate"),
        makeNode("d1", "SET", "Done"),
      ],
      connections: [
        makeEdge("t1", "s1"),
        makeEdge("s1", "i1"),
        makeEdge("i1", "a1"),
        makeEdge("a1", "d1"),
      ],
    };
    const errors = errorsOf(validate(graph)).filter((e) =>
      SEGMENT_ERROR.test(e.message),
    );
    expect(errors).toHaveLength(0);
  });

  it("rejects a SPLIT_OUT with no closing AGGREGATE", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("s1", "SPLIT_OUT", "Split"),
        makeNode("d1", "SET", "Done"),
      ],
      connections: [makeEdge("t1", "s1"), makeEdge("s1", "d1")],
    };
    const errors = errorsOf(validate(graph)).filter((e) =>
      e.message.includes("has no closing"),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('SPLIT_OUT "Split" has no closing');
  });

  it("rejects a SPLIT_OUT reaching multiple AGGREGATEs", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("s1", "SPLIT_OUT", "Split"),
        makeNode("a1", "AGGREGATE", "Agg1"),
        makeNode("a2", "AGGREGATE", "Agg2"),
      ],
      connections: [
        makeEdge("t1", "s1"),
        makeEdge("s1", "a1"),
        makeEdge("s1", "a2"),
      ],
    };
    const errors = errorsOf(validate(graph)).filter((e) =>
      e.message.includes("reaches 2"),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("reaches 2 AGGREGATE");
  });

  it("rejects a nested fan-out segment", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("s1", "SPLIT_OUT", "Outer Split"),
        makeNode("s2", "SPLIT_OUT", "Inner Split"),
        makeNode("a2", "AGGREGATE", "Inner Aggregate"),
        makeNode("a1", "AGGREGATE", "Outer Aggregate"),
      ],
      connections: [
        makeEdge("t1", "s1"),
        makeEdge("s1", "s2"),
        makeEdge("s2", "a2"),
        makeEdge("a2", "a1"),
      ],
    };
    const errors = errorsOf(validate(graph)).filter((e) =>
      e.message.includes("Nested fan-out"),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects an edge crossing a segment boundary from an interior node", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t1", "MANUAL_TRIGGER", "Start"),
        makeNode("s1", "SPLIT_OUT", "Split"),
        makeNode("i1", "SET", "Interior"),
        makeNode("a1", "AGGREGATE", "Aggregate"),
        makeNode("d1", "SET", "Outside"),
      ],
      connections: [
        makeEdge("t1", "s1"),
        makeEdge("s1", "i1"),
        makeEdge("i1", "a1"),
        // Interior node connects outside the envelope -> crossing.
        makeEdge("i1", "d1"),
      ],
    };
    const errors = errorsOf(validate(graph)).filter((e) =>
      e.message.includes("Crossing edge"),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('"Interior" → "Outside"');
  });
});

// ---------------------------------------------------------------------------
// RESPOND_TO_WEBHOOK checks (AF-M9-10)
// ---------------------------------------------------------------------------

describe("validate — respond-to-webhook checks (AF-M9-10)", () => {
  it("warns when a respond node has no webhook trigger to answer", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t", "SCHEDULE_TRIGGER"),
        makeNode("r", "RESPOND_TO_WEBHOOK", "Respond"),
      ],
      connections: [makeEdge("t", "r")],
    };

    const warnings = warningsOf(validate(graph));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].nodeId).toBe("r");
    expect(warnings[0].message).toContain("no enabled webhook trigger");
    // A warning only — the workflow still runs correctly, it just responds
    // to nobody, so a save must not be blocked.
    expect(errorsOf(validate(graph))).toHaveLength(0);
  });

  it("does not warn when a webhook trigger is present", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t", "WEBHOOK_TRIGGER"),
        makeNode("r", "RESPOND_TO_WEBHOOK", "Respond"),
      ],
      connections: [makeEdge("t", "r")],
    };

    expect(warningsOf(validate(graph))).toHaveLength(0);
  });

  it("treats a DISABLED webhook trigger as absent", () => {
    // A disabled trigger never dispatches (AF-M9-17), so the response would
    // still go unread. Two warnings: the disabled-only-trigger one and ours.
    const graph: Graph = {
      nodes: [
        { ...makeNode("t", "WEBHOOK_TRIGGER"), disabled: true },
        makeNode("r", "RESPOND_TO_WEBHOOK", "Respond"),
      ],
      connections: [makeEdge("t", "r")],
    };

    const messages = warningsOf(validate(graph)).map((w) => w.message);
    expect(messages.some((m) => m.includes("no enabled webhook trigger"))).toBe(
      true,
    );
  });

  it("ignores a DISABLED respond node entirely", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t", "SCHEDULE_TRIGGER"),
        { ...makeNode("r", "RESPOND_TO_WEBHOOK", "Respond"), disabled: true },
      ],
      connections: [makeEdge("t", "r")],
    };

    expect(warningsOf(validate(graph))).toHaveLength(0);
  });

  it("warns when one respond node is downstream of another", () => {
    const graph: Graph = {
      nodes: [
        makeNode("t", "WEBHOOK_TRIGGER"),
        makeNode("r1", "RESPOND_TO_WEBHOOK", "First"),
        makeNode("s", "SET"),
        makeNode("r2", "RESPOND_TO_WEBHOOK", "Second"),
      ],
      connections: [
        makeEdge("t", "r1"),
        makeEdge("r1", "s"),
        makeEdge("s", "r2"),
      ],
    };

    const warnings = warningsOf(validate(graph));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].nodeId).toBe("r2");
    expect(warnings[0].message).toContain('"First"');
    expect(warnings[0].message).toContain("overwritten");
  });

  it("does NOT warn for respond nodes on sibling branches", () => {
    // This is W1's router shape: one respond node per branch, exactly one of
    // which runs. Flagging it would make the milestone's own template noisy.
    const graph: Graph = {
      nodes: [
        makeNode("t", "WEBHOOK_TRIGGER"),
        makeNode("sw", "SWITCH"),
        makeNode("r1", "RESPOND_TO_WEBHOOK", "Ping response"),
        makeNode("r2", "RESPOND_TO_WEBHOOK", "Process response"),
      ],
      connections: [
        makeEdge("t", "sw"),
        makeEdge("sw", "r1", "ping"),
        makeEdge("sw", "r2", "process"),
      ],
    };

    expect(warningsOf(validate(graph))).toHaveLength(0);
  });

  it("reports each downstream pair once, not transitively", () => {
    // r1 → r2 → r3. r2 is reported against r1 and r3 against r2, but the walk
    // stops at each respond node, so r3 is not ALSO reported against r1.
    const graph: Graph = {
      nodes: [
        makeNode("t", "WEBHOOK_TRIGGER"),
        makeNode("r1", "RESPOND_TO_WEBHOOK", "One"),
        makeNode("r2", "RESPOND_TO_WEBHOOK", "Two"),
        makeNode("r3", "RESPOND_TO_WEBHOOK", "Three"),
      ],
      connections: [
        makeEdge("t", "r1"),
        makeEdge("r1", "r2"),
        makeEdge("r2", "r3"),
      ],
    };

    const warnings = warningsOf(validate(graph));
    expect(warnings).toHaveLength(2);
    expect(warnings.map((w) => w.nodeId).sort()).toEqual(["r2", "r3"]);
  });

  it("does not hang on a cycle between respond nodes", () => {
    // `checkCycles` reports the cycle; this check must terminate regardless.
    const graph: Graph = {
      nodes: [
        makeNode("t", "WEBHOOK_TRIGGER"),
        makeNode("r1", "RESPOND_TO_WEBHOOK", "One"),
        makeNode("r2", "RESPOND_TO_WEBHOOK", "Two"),
      ],
      connections: [
        makeEdge("t", "r1"),
        makeEdge("r1", "r2"),
        makeEdge("r2", "r1"),
      ],
    };

    const result = validate(graph);
    expect(result.errors.some((e) => e.message.includes("cycle"))).toBe(true);
  });
});
