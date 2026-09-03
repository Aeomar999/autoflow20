import { render } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { describe, expect, it, vi } from "vitest";
import { inputPorts, outputPorts } from "@/nodes/ports";
import { NodePortHandles } from "./node-port-handles";

/**
 * AF-M9-03. The handle `id` is the persisted `Connection.fromOutput`/`toInput`,
 * so what this component renders IS the graph contract — not decoration.
 */

/**
 * A synthetic three-output type. No registered node declares three outputs yet
 * — `SWITCH` (AF-M9-09) will be the first — but the component must already
 * handle N ports, and "it works for the two ports that happen to exist today"
 * is not the claim this task makes. Registered types are passed through
 * untouched so every other case exercises the real manifest.
 */
vi.mock("@/nodes/manifest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/nodes/manifest")>();
  return {
    ...actual,
    findManifestEntry: (type: string) =>
      type === "TRIPLE_FIXTURE"
        ? {
            type,
            inputs: [
              { id: "left", label: "Left" },
              { id: "right", label: "Right" },
            ],
            outputs: [
              { id: "a", label: "A" },
              { id: "b", label: "B" },
              { id: "c", label: "C" },
            ],
          }
        : actual.findManifestEntry(type),
  };
});

function renderPorts(type: string) {
  const { container } = render(
    <ReactFlowProvider>
      <NodePortHandles type={type} />
    </ReactFlowProvider>,
  );
  return container;
}

/** React Flow stamps the handle id onto `data-handleid`. */
function handleIds(container: HTMLElement, kind: "source" | "target") {
  return Array.from(
    container.querySelectorAll(
      `.react-flow__handle-${kind === "source" ? "right" : "left"}`,
    ),
  ).map((el) => el.getAttribute("data-handleid"));
}

describe("NodePortHandles (AF-M9-03)", () => {
  it("renders one source handle per declared output, with the declared ids", () => {
    const container = renderPorts("CONDITION");

    // Two outputs — the case that was impossible before AF-M9-03.
    expect(handleIds(container, "source")).toEqual(["true", "false"]);
    expect(handleIds(container, "target")).toEqual(["main"]);
  });

  it("renders a single centred handle for a single-port node", () => {
    const container = renderPorts("SET");

    expect(handleIds(container, "source")).toEqual(["main"]);
    expect(handleIds(container, "target")).toEqual(["main"]);

    const source = container.querySelector(".react-flow__handle-right");
    expect((source as HTMLElement).style.top).toBe("50%");
  });

  it("renders no target handle for a trigger, which declares no inputs", () => {
    const container = renderPorts("MANUAL_TRIGGER");

    expect(handleIds(container, "source")).toEqual(["main"]);
    expect(handleIds(container, "target")).toEqual([]);
  });

  it("distributes multiple handles vertically instead of stacking them", () => {
    const container = renderPorts("CONDITION");
    const tops = Array.from(
      container.querySelectorAll(".react-flow__handle-right"),
    ).map((el) => (el as HTMLElement).style.top);

    expect(tops).toHaveLength(2);
    expect(new Set(tops).size).toBe(2);
    expect(tops[0]).not.toBe("50%");
  });

  it("labels the ports only when there is a choice to make", () => {
    // Two outputs → the user must be told which is which.
    const branching = renderPorts("CONDITION");
    expect(branching.textContent).toContain("True");
    expect(branching.textContent).toContain("False");

    // One output → unlabelled, so single-port nodes look exactly as before.
    const linear = renderPorts("SET");
    expect(linear.textContent).toBe("");
  });

  it("renders three distinct handles for a three-output type", () => {
    const container = renderPorts("TRIPLE_FIXTURE");

    expect(handleIds(container, "source")).toEqual(["a", "b", "c"]);
    expect(handleIds(container, "target")).toEqual(["left", "right"]);

    const tops = Array.from(
      container.querySelectorAll(".react-flow__handle-right"),
    ).map((el) => (el as HTMLElement).style.top);
    expect(tops).toEqual(["25%", "50%", "75%"]);
    expect(new Set(tops).size).toBe(3);
  });

  it("never emits a legacy handle id for any registered type", () => {
    // The whole G1 defect in one assertion.
    for (const type of ["CONDITION", "SET", "HTTP_REQUEST", "MERGE"]) {
      const container = renderPorts(type);
      const ids = [
        ...handleIds(container, "source"),
        ...handleIds(container, "target"),
      ];
      expect(ids).not.toContain("source-1");
      expect(ids).not.toContain("target-1");
      expect(ids).toEqual([
        ...outputPorts(type).map((p) => p.id),
        ...inputPorts(type).map((p) => p.id),
      ]);
    }
  });
});
