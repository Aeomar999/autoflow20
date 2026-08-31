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

    // Verify every offerable node is rendered
    for (const node of nodePalette) {
      expect(screen.getByText(node.label)).toBeTruthy();
      expect(screen.getByText(node.description)).toBeTruthy();
    }

    // Verify category headers exist
    expect(screen.getByText("Triggers")).toBeTruthy();
    expect(screen.getByText("AI Models")).toBeTruthy();
    expect(screen.getByText("Actions & Integrations")).toBeTruthy();
  });

  it("never offers a deprecated node type (AF-M5-09)", () => {
    const retired = nodeManifest.filter((node) => node.deprecated);
    expect(retired.length).toBeGreaterThan(0);

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

    // Search for "slack"
    fireEvent.change(searchInput, { target: { value: "slack" } });

    expect(screen.getByText("Slack")).toBeTruthy();
    expect(screen.queryByText("Google Sheets Append")).toBeNull();
    expect(screen.queryByText("HTTP Request")).toBeNull();

    // Search for a keyword like "rest" (matches HTTP Request)
    fireEvent.change(searchInput, { target: { value: "rest" } });
    expect(screen.getByText("HTTP Request")).toBeTruthy();
    expect(screen.queryByText("Slack")).toBeNull();

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
    }
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
