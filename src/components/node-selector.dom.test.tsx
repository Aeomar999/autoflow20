import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NodeSelector } from "@/components/node-selector";
import {
  appendSourceNodeIdAtom,
  type EditorNode,
  edgesAtom,
  nodeSelectorOpenAtom,
  nodesAtom,
  saveStatusAtom,
} from "@/features/editor/store/atoms";
import { nodeManifest, nodePalette } from "@/nodes/manifest";

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    useReactFlow: () => ({
      screenToFlowPosition: (pos: { x: number; y: number }) => pos,
      setNodes: vi.fn(),
      setEdges: vi.fn(),
      getNode: vi.fn(),
      setCenter: vi.fn(),
    }),
  };
});

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe("NodeSelector / Node Palette (AF-M1-05)", () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
    store.set(nodesAtom, []);
    store.set(edgesAtom, []);
    store.set(saveStatusAtom, "saved");
    store.set(appendSourceNodeIdAtom, null);
    store.set(nodeSelectorOpenAtom, false);
  });

  it("renders every offerable node grouped by category with label and description", () => {
    render(
      <Provider store={store}>
        <NodeSelector open={true} onOpenChange={() => undefined} />
      </Provider>,
    );

    // The DOM is walked ONCE and the assertions run against a set.
    //
    // This used to call getByText twice per palette node, and getByText scans
    // the whole document each time — quadratic against a palette that M10 is
    // steadily growing. At ~90 nodes it took 11.6s and began failing under
    // load in the combined unit+dom run while still passing alone, which is
    // the worst way for a test to break: intermittently, and for a reason that
    // has nothing to do with what it checks.
    const rendered = new Set(
      Array.from(document.querySelectorAll("*"))
        .map((element) => element.textContent?.trim())
        .filter((text): text is string => Boolean(text)),
    );

    for (const node of nodePalette) {
      expect(rendered.has(node.label), `no label for ${node.type}`).toBe(true);
      expect(
        rendered.has(node.description),
        `no description for ${node.type}`,
      ).toBe(true);
    }

    // Verify category headers exist
    expect(screen.getByText("Triggers")).toBeTruthy();
    expect(screen.getByText("AI Models")).toBeTruthy();
    expect(screen.getByText("Actions & Integrations")).toBeTruthy();
    // The assertions above are linear (one DOM walk), but RENDERING the whole
    // palette in jsdom is not free and gets slower with every family M10 adds.
    // vitest's 5s default is meant for unit tests; this one mounts ~100
    // components on purpose, so it gets a bound suited to what it does rather
    // than failing intermittently under load.
  }, 30_000);

  it("never offers a deprecated node type (AF-M5-09)", () => {
    // Latent by design since AF-M8-12 retired the last deprecated types: the
    // population is empty today, and requiring it to be non-empty would make
    // a completed retirement fail the palette suite. The invariant still
    // stands and re-arms itself the next time a type is deprecated.
    const retired = nodeManifest.filter((node) => node.deprecated);

    render(
      <Provider store={store}>
        <NodeSelector open={true} onOpenChange={() => undefined} />
      </Provider>,
    );

    for (const node of retired) {
      expect(screen.queryByText(node.label)).toBeNull();
    }
  });

  it("filters nodes dynamically using fuzzy/keyword search", () => {
    render(
      <Provider store={store}>
        <NodeSelector open={true} onOpenChange={() => undefined} />
      </Provider>,
    );

    const searchInput = screen.getByPlaceholderText(/Search by name/i);

    // Search for "slack". AF-M10-17 retired the webhook-only node labelled
    // exactly "Slack"; the palette now offers the Web API family, so the
    // search term is the same and the label it must find is the replacement.
    fireEvent.change(searchInput, { target: { value: "slack" } });

    expect(screen.getByText("Slack Post Message")).toBeTruthy();
    expect(screen.queryByText("Google Sheets Append")).toBeNull();
    expect(screen.queryByText("HTTP Request")).toBeNull();

    // Search for a keyword like "rest" (matches HTTP Request)
    fireEvent.change(searchInput, { target: { value: "rest" } });
    expect(screen.getByText("HTTP Request")).toBeTruthy();
    expect(screen.queryByText("Slack Post Message")).toBeNull();

    // Search for non-existent term
    fireEvent.change(searchInput, { target: { value: "xyznonexistent" } });
    expect(screen.getByText("No nodes found")).toBeTruthy();
  });

  it("disables trigger insertion when workflow already has a trigger and displays guidance", () => {
    const existingTrigger: EditorNode = {
      id: "t1",
      type: "MANUAL_TRIGGER",
      position: { x: 0, y: 0 },
      data: {},
      name: "Manual Trigger",
    };
    store.set(nodesAtom, [existingTrigger]);

    render(
      <Provider store={store}>
        <NodeSelector open={true} onOpenChange={() => undefined} />
      </Provider>,
    );

    // Explanatory warning banner must be visible
    expect(
      screen.getByText(/Workflows can only have one trigger/i),
    ).toBeTruthy();

    // Trigger button should be rendered disabled/dimmed
    const manualTriggerButton = screen
      .getByText("Manual Trigger")
      .closest("button");
    expect(manualTriggerButton?.getAttribute("draggable")).toBe("false");
  });

  it("allows selecting a node and adds it to the workflow", () => {
    const onOpenChange = vi.fn();

    render(
      <Provider store={store}>
        <NodeSelector open={true} onOpenChange={onOpenChange} />
      </Provider>,
    );

    const httpButton = screen.getByText("HTTP Request").closest("button");
    expect(httpButton).toBeTruthy();
    if (httpButton) {
      fireEvent.click(httpButton);
    }

    const currentNodes = store.get(nodesAtom);
    expect(currentNodes).toHaveLength(1);
    expect(currentNodes[0].type).toBe("HTTP_REQUEST");
    expect(store.get(saveStatusAtom)).toBe("unsaved");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("supports click-to-append mode, auto-connecting to source node", () => {
    const sourceNode: EditorNode = {
      id: "n-source",
      type: "MANUAL_TRIGGER",
      position: { x: 100, y: 200 },
      data: {},
      name: "Manual Trigger",
    };
    store.set(nodesAtom, [sourceNode]);

    render(
      <Provider store={store}>
        <NodeSelector
          open={true}
          onOpenChange={() => undefined}
          sourceNodeId="n-source"
        />
      </Provider>,
    );

    expect(screen.getByText("Append next step")).toBeTruthy();

    const httpButton = screen.getByText("HTTP Request").closest("button");
    expect(httpButton).toBeTruthy();
    if (httpButton) {
      fireEvent.click(httpButton);
    }

    const currentNodes = store.get(nodesAtom);
    expect(currentNodes).toHaveLength(2);

    const newNode = currentNodes.find((n) => n.type === "HTTP_REQUEST");
    expect(newNode).toBeDefined();
    if (newNode) {
      expect(newNode.position.x).toBeGreaterThan(sourceNode.position.x);

      const currentEdges = store.get(edgesAtom);
      expect(currentEdges).toHaveLength(1);
      expect(currentEdges[0].source).toBe("n-source");
      expect(currentEdges[0].target).toBe(newNode.id);

      // AF-M9-03: the handles are the declared PortDef ids, which saveGraph
      // persists verbatim as Connection.fromOutput/toInput. The literals
      // "source-1"/"target-1" are what made branching unmatchable by the engine.
      expect(currentEdges[0].sourceHandle).toBe("main");
      expect(currentEdges[0].targetHandle).toBe("main");
    }
  });

  it("appends from a CONDITION onto its first declared output, not 'main'", () => {
    // AF-M9-03 regression: CONDITION declares true/false and has no "main"
    // output, so a hardcoded handle produced an edge on a port that does not
    // exist — the engine then marked the whole downstream SKIPPED.
    const sourceNode: EditorNode = {
      id: "n-cond",
      type: "CONDITION",
      position: { x: 100, y: 200 },
      data: {},
      name: "Check",
    };
    store.set(nodesAtom, [sourceNode]);

    render(
      <Provider store={store}>
        <NodeSelector
          open={true}
          onOpenChange={() => undefined}
          sourceNodeId="n-cond"
        />
      </Provider>,
    );

    const httpButton = screen.getByText("HTTP Request").closest("button");
    if (httpButton) fireEvent.click(httpButton);

    const currentEdges = store.get(edgesAtom);
    expect(currentEdges).toHaveLength(1);
    expect(currentEdges[0].sourceHandle).toBe("true");
    expect(currentEdges[0].targetHandle).toBe("main");
  });

  it("supports HTML5 drag-and-drop on palette items", () => {
    render(
      <Provider store={store}>
        <NodeSelector open={true} onOpenChange={() => undefined} />
      </Provider>,
    );

    const httpButton = screen.getByText("HTTP Request").closest("button");
    expect(httpButton?.getAttribute("draggable")).toBe("true");

    const setData = vi.fn();
    if (httpButton) {
      fireEvent.dragStart(httpButton, {
        dataTransfer: {
          setData,
          effectAllowed: "",
        },
      });
    }

    expect(setData).toHaveBeenCalledWith(
      "application/reactflow",
      "HTTP_REQUEST",
    );
  });
});
