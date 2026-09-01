import { describe, expect, it } from "vitest";

import { validate } from "@/engine/validate";
import { nodeManifest, nodePalette } from "@/nodes/manifest";
import { nodeRegistry } from "@/nodes/registry";

import { TEMPLATE_CATEGORIES } from "../constants";
import { prepareTemplateGraph } from "../server/instantiate";
import { checkCatalog, checkTemplate, formatIssues } from "./harness";
import { templateCatalog, toSeedRow } from "./index";
import {
  MIN_TEMPLATES_PER_DOMAIN,
  TEMPLATE_DOMAINS,
  type TemplateSpec,
} from "./types";

/**
 * AF-M7-02 acceptance, executable.
 *
 * The catalogue is product content shipped to every tenant, so the gate is the
 * test rather than review: a template that fails here cannot be seeded, because
 * `seed:templates` runs the same harness before it writes.
 */

const EXPECTED_TEMPLATE_COUNT = 20;

describe("template catalogue", () => {
  it(`ships ${EXPECTED_TEMPLATE_COUNT} templates`, () => {
    expect(templateCatalog).toHaveLength(EXPECTED_TEMPLATE_COUNT);
  });

  it("passes the authoring harness with zero issues", () => {
    const results = checkCatalog(templateCatalog);
    // Report every issue at once: fixing templates one failed assertion per
    // run is what makes an authoring harness get abandoned.
    expect(formatIssues(results)).toEqual([]);
  });

  it("covers every domain at least four times", () => {
    for (const domain of TEMPLATE_DOMAINS) {
      const count = templateCatalog.filter((t) => t.domain === domain).length;
      expect(
        count,
        `domain "${domain}" has ${count} templates`,
      ).toBeGreaterThanOrEqual(MIN_TEMPLATES_PER_DOMAIN);
    }
  });

  it("uses only categories the gallery can filter by", () => {
    for (const template of templateCatalog) {
      expect(TEMPLATE_CATEGORIES).toContain(template.category);
    }
  });

  it("gives every gallery category at least one template", () => {
    const used = new Set(templateCatalog.map((t) => t.category));
    for (const category of TEMPLATE_CATEGORIES) {
      if (category === "All") continue;
      expect(used, `category "${category}" has no templates`).toContain(
        category,
      );
    }
  });

  it("has unique slugs", () => {
    const slugs = templateCatalog.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("exercises every node type the palette offers", () => {
    const used = new Set(
      templateCatalog.flatMap((t) => t.graph.nodes.map((n) => n.type)),
    );
    const missing = nodePalette
      .map((node) => node.type)
      .filter((type) => !used.has(type));
    expect(missing, `node types no template demonstrates: ${missing}`).toEqual(
      [],
    );
  });

  it("never authors a deprecated node type", () => {
    const deprecated = new Set(
      nodeManifest.filter((n) => n.deprecated).map((n) => n.type),
    );
    // AF-M8-24: this used to require a non-empty deprecated set, which made
    // AF-M8-12's completed retirement fail the catalogue suite. The stronger
    // invariant, and the one that covers the retired types now that they are
    // gone entirely, is that a template never authors a type the registry
    // cannot resolve - deprecated or deleted.
    for (const template of templateCatalog) {
      for (const node of template.graph.nodes) {
        expect(
          deprecated.has(node.type),
          `${template.slug} authors deprecated node ${node.type}`,
        ).toBe(false);
        expect(
          nodeRegistry.has(node.type),
          `${template.slug} authors unregistered node ${node.type}`,
        ).toBe(true);
      }
    }
  });

  it("never asks a new user to wire up more than one credential", () => {
    // This is the "no free-plan-busting mandatory credentials" acceptance in
    // its enforceable form. A template needing two connectors is one nobody
    // finishes setting up, whatever their plan.
    for (const template of templateCatalog) {
      const row = toSeedRow(template);
      expect(
        row.credentialCount,
        `${template.slug} requires ${row.credentialCount} credentials`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it("keeps a meaningful share of the gallery credential-free", () => {
    const free = templateCatalog.filter(
      (t) => toSeedRow(t).credentialCount === 0,
    );
    // A gallery where every entry needs a connector is a gallery a brand-new
    // account cannot try at all. A third is the floor; nine ship today.
    expect(free.length).toBeGreaterThanOrEqual(
      Math.ceil(EXPECTED_TEMPLATE_COUNT / 3),
    );
  });

  it("derives node and credential counts from the graph", () => {
    for (const template of templateCatalog) {
      const row = toSeedRow(template);
      expect(row.nodeCount).toBe(template.graph.nodes.length);
      expect(row.credentialCount).toBeGreaterThanOrEqual(0);
      expect(row.credentialCount).toBeLessThanOrEqual(row.nodeCount);
    }
  });

  it("survives the real install path", () => {
    // The harness validates the AUTHORED graph; `instantiate` installs a
    // rewritten copy. Proving the copy is still sound closes the gap between
    // "passes review" and "the user gets a working workflow".
    for (const template of templateCatalog) {
      const prepared = prepareTemplateGraph(template.graph);

      expect(prepared.nodes).toHaveLength(template.graph.nodes.length);
      expect(prepared.edges).toHaveLength(template.graph.edges.length);

      // Every id rotated, and no authored id survived anywhere.
      const authoredIds = new Set(template.graph.nodes.map((n) => n.id));
      for (const node of prepared.nodes) {
        expect(authoredIds.has(node.id)).toBe(false);
      }
      const preparedIds = new Set(prepared.nodes.map((n) => n.id));
      for (const edge of prepared.edges) {
        expect(preparedIds.has(edge.source)).toBe(true);
        expect(preparedIds.has(edge.target)).toBe(true);
      }

      // The copy passes the same boundary `instantiate` enforces before write.
      const { errors } = validate(
        {
          nodes: prepared.nodes.map((n) => ({
            id: n.id,
            name: n.name ?? n.type,
            type: n.type,
            data: n.data ?? {},
          })),
          connections: prepared.edges.map((e) => ({
            fromNodeId: e.source,
            toNodeId: e.target,
            fromOutput: e.sourceHandle ?? "main",
            toInput: e.targetHandle ?? "main",
          })),
        },
        nodeRegistry,
      );
      expect(
        errors.filter((e) => e.severity === "error"),
        `${template.slug} failed post-install validation`,
      ).toEqual([]);
    }
  });

  it("declares exactly the credential placeholders the install surfaces", () => {
    for (const template of templateCatalog) {
      const prepared = prepareTemplateGraph(template.graph);
      const required = prepared.pendingCredentials.filter((c) => !c.optional);
      expect(required).toHaveLength(toSeedRow(template).credentialCount);
    }
  });

  it("features a handful of templates, not all of them", () => {
    const featured = templateCatalog.filter((t) => t.featured);
    expect(featured.length).toBeGreaterThan(0);
    expect(featured.length).toBeLessThan(EXPECTED_TEMPLATE_COUNT / 2);
  });
});

describe("harness", () => {
  const sound: TemplateSpec = {
    slug: "harness-fixture",
    name: "Harness fixture",
    description:
      "A minimal two-node graph used to prove the authoring harness rejects what it claims to reject.",
    category: "Ops",
    domain: "ops",
    tags: ["fixture"],
    graph: {
      nodes: [
        {
          id: "trigger",
          type: "MANUAL_TRIGGER",
          name: "Start",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "notify",
          type: "SLACK",
          name: "Notify",
          position: { x: 240, y: 0 },
          data: {
            variableName: "post",
            webhookUrl: "https://hooks.slack.com/services/A/B/C",
            content: "hello",
          },
        },
      ],
      edges: [{ source: "trigger", target: "notify" }],
    },
  };

  it("accepts a sound template", () => {
    expect(checkTemplate(sound).issues).toEqual([]);
  });

  it("rejects a leaked cuid in node config", () => {
    const leaked = structuredClone(sound);
    // Shaped like a cuid2 (24 lowercase alphanumerics, contains digits) —
    // exactly what an author copying from their own workspace would paste.
    (leaked.graph.nodes[1].data as Record<string, unknown>).content =
      "see run cm4x9k2p0000108l3f7g2h1d";
    expect(formatIssues([checkTemplate(leaked)])).toEqual([
      expect.stringContaining("looks like a cuid"),
    ]);
  });

  it("rejects an authored credential id", () => {
    const withCredential = structuredClone(sound);
    withCredential.graph.nodes.push({
      id: "email",
      type: "EMAIL_SEND",
      name: "Email",
      position: { x: 480, y: 0 },
      data: { credentialId: "cm4x9k2p0000108l3f7g2h1d" },
    });
    withCredential.graph.edges.push({ source: "notify", target: "email" });
    expect(formatIssues([checkTemplate(withCredential)])).toContainEqual(
      expect.stringContaining("credential-bound"),
    );
  });

  it("rejects a secret-shaped token", () => {
    const withSecret = structuredClone(sound);
    (withSecret.graph.nodes[1].data as Record<string, unknown>).content =
      "token xoxb-000000000000-abcdef";
    expect(formatIssues([checkTemplate(withSecret)])).toContainEqual(
      expect.stringContaining("secret prefix"),
    );
  });

  it("rejects an unregistered model id", () => {
    const badModel = structuredClone(sound);
    badModel.graph.nodes.push({
      id: "chat",
      type: "AI_LLM",
      name: "Chat",
      position: { x: 480, y: 0 },
      data: { variableName: "reply", model: "openai:gpt-4o-mimi" },
    });
    badModel.graph.edges.push({ source: "notify", target: "chat" });
    expect(formatIssues([checkTemplate(badModel)])).toContainEqual(
      expect.stringContaining("not in the AI registry"),
    );
  });

  it("rejects a graph with no trigger", () => {
    const triggerless = structuredClone(sound);
    triggerless.graph.nodes.shift();
    triggerless.graph.edges = [];
    expect(formatIssues([checkTemplate(triggerless)])).toContainEqual(
      expect.stringContaining("no trigger"),
    );
  });

  it("rejects an unreachable node", () => {
    const orphan = structuredClone(sound);
    orphan.graph.edges = [];
    expect(formatIssues([checkTemplate(orphan)])).toContainEqual(
      expect.stringContaining("not reachable"),
    );
  });

  it("rejects an edge leaving through an undeclared port", () => {
    const badPort = structuredClone(sound);
    badPort.graph.edges[0].sourceHandle = "true";
    expect(formatIssues([checkTemplate(badPort)])).toContainEqual(
      expect.stringContaining("does not declare"),
    );
  });

  it("rejects duplicate slugs across the catalogue", () => {
    const issues = formatIssues(checkCatalog([sound, structuredClone(sound)]));
    expect(issues).toContainEqual(expect.stringContaining("Duplicate slug"));
  });

  it("rejects a config that fails its node's schema", () => {
    const badConfig = structuredClone(sound);
    // `variableName` is identifier-only; a dotted value is the mistake an
    // author makes when they think it is a path.
    (badConfig.graph.nodes[1].data as Record<string, unknown>).variableName =
      "post.result";
    expect(formatIssues([checkTemplate(badConfig)])).toContainEqual(
      expect.stringContaining("Smoke run failed"),
    );
  });
});
