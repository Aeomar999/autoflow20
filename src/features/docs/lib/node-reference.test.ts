import { describe, expect, it } from "vitest";
import { nodeManifest } from "@/nodes/manifest";
import {
  CATEGORY_ORDER,
  findNodeReference,
  nodeReference,
  nodeReferenceByCategory,
} from "./node-reference";

/**
 * AF-M8-09. The reference is derived from the registry, so the tests worth
 * writing are the ones that catch it drifting away from the registry or
 * quietly dropping a node - not ones that restate a mapping.
 */

describe("nodeReference", () => {
  it("documents every registered node type, with none invented", () => {
    expect(
      nodeReference()
        .map((entry) => entry.type)
        .sort(),
    ).toEqual(nodeManifest.map((node) => node.type).sort());
  });

  it("includes deprecated types", () => {
    // A saved workflow can still hold one and still run it (ADR-0011), so
    // someone reading a trace has to be able to look it up.
    const deprecated = nodeManifest.filter((node) => node.deprecated);
    expect(deprecated.length).toBeGreaterThan(0);

    for (const node of deprecated) {
      const entry = findNodeReference(node.type);
      expect(entry?.deprecated?.replacedBy).toBe(node.deprecated?.replacedBy);
    }
  });

  it("gives every entry the copy a reader needs", () => {
    for (const entry of nodeReference()) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it("resolves config fields for every node in the catalogue", () => {
    // `fields: null` is the documented degradation for a schema the config
    // deriver cannot render. It is allowed, but no node should need it today -
    // if one starts to, this fails and the gap gets looked at rather than
    // silently shipping a node whose configuration is undocumented.
    const undocumented = nodeReference()
      .filter((entry) => entry.fields === null)
      .map((entry) => entry.type);

    expect(undocumented).toEqual([]);
  });

  it("marks nodes with no inputs as triggers", () => {
    for (const entry of nodeReference()) {
      expect(entry.isTrigger).toBe(entry.inputs.length === 0);
    }
  });

  it("never exposes a credential value, only its requirement", () => {
    const serialized = JSON.stringify(nodeReference());
    expect(serialized).not.toMatch(/ciphertext|wrappedDek|authTag/i);

    for (const entry of nodeReference()) {
      for (const credential of entry.credentials) {
        expect(Object.keys(credential).sort()).toEqual([
          "key",
          "required",
          "type",
        ]);
      }
    }
  });
});

describe("findNodeReference", () => {
  it("finds a known type", () => {
    expect(findNodeReference("HTTP_REQUEST")?.type).toBe("HTTP_REQUEST");
  });

  it("returns undefined for an unknown type rather than throwing", () => {
    expect(findNodeReference("NOT_A_NODE")).toBeUndefined();
  });
});

describe("nodeReferenceByCategory", () => {
  it("loses no node to grouping", () => {
    const grouped = nodeReferenceByCategory().flatMap((g) => g.entries);
    expect(grouped).toHaveLength(nodeManifest.length);
  });

  it("emits groups in the declared order", () => {
    const order = nodeReferenceByCategory().map((group) => group.category);
    expect(order).toEqual(
      CATEGORY_ORDER.filter((category) => order.includes(category)),
    );
  });

  it("drops empty groups instead of rendering an empty heading", () => {
    for (const group of nodeReferenceByCategory()) {
      expect(group.entries.length).toBeGreaterThan(0);
    }
  });

  it("sorts entries within a group by label", () => {
    for (const group of nodeReferenceByCategory()) {
      const labels = group.entries.map((entry) => entry.label);
      expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
    }
  });
});
