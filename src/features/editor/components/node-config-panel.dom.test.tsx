import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { EditorNode } from "@/features/editor/store/atoms";
import { definition as aiExtractDefinition } from "@/nodes/ai/extract/definition";
import { definition as httpHttpRequest } from "@/nodes/http/request/definition";
import type { NodeDefinition } from "@/nodes/types";
import { TRPCTestProvider } from "@/trpc/test-provider";
import { NodeConfigForm, NodeConfigPanel } from "./node-config-panel";

/**
 * The config panel renders a credential picker since AF-M10-01, and that
 * picker queries tRPC — so every render in this file needs a context.
 */
const render = (ui: React.ReactElement) =>
  rtlRender(<TRPCTestProvider>{ui}</TRPCTestProvider>);

const httpDefinition = httpHttpRequest;

const httpNode: EditorNode = {
  id: "n1",
  type: "HTTP_REQUEST",
  name: "Fetch stats",
  position: { x: 0, y: 0 },
  data: {
    method: "GET",
    endpoint: "https://api.example.com/users",
  },
};

const mockDeprecatedDefinition: NodeDefinition = {
  type: "MOCK_DEPRECATED",
  category: "ACTION",
  label: "Mock Deprecated",
  description: "A mocked deprecated node.",
  version: 1,
  // `NodeDefinition.icon` is a lucide-react icon NAME, resolved by the palette
  // and config panel - not a component. This mock passed a component, which is
  // why the file did not typecheck.
  icon: "Zap",
  inputs: [],
  outputs: [],
  configSchema: z.object({}),
  defaults: {},
  deprecated: {
    since: "1.0",
    replacedBy: "NEW_NODE",
    reason: "Because testing.",
  },
};

const mockDeprecatedNode: EditorNode = {
  id: "node-deprecated",
  type: "MOCK_DEPRECATED",
  name: "Legacy Node",
  data: {},
  position: { x: 0, y: 0 },
};

describe("NodeConfigForm (AF-M1-06)", () => {
  it("renders every field kind from the real HTTP_REQUEST schema", () => {
    render(
      <NodeConfigForm
        definition={httpDefinition}
        data={httpNode.data}
        onDataChange={() => undefined}
      />,
    );

    // Labels render an "(optional)" suffix, so query by substring regex.
    const endpoint = screen.getByLabelText(/endpoint/i) as HTMLInputElement;
    expect(endpoint.type).toBe("text");
    expect(endpoint.value).toBe("https://api.example.com/users");

    const method = screen.getByLabelText(/method/i) as HTMLSelectElement;
    expect(method.tagName).toBe("SELECT");
    expect(method.options).toHaveLength(5);
    expect(Array.from(method.options).map((o) => o.value)).toEqual([
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
    ]);

    expect(screen.getByLabelText(/timeout/i).tagName).toBe("INPUT");
    expect(screen.getByLabelText(/fail on/i).tagName).toBe("INPUT");
    expect((screen.getByLabelText(/fail on/i) as HTMLInputElement).type).toBe(
      "checkbox",
    );
    expect(screen.getByLabelText(/body/i).tagName).toBe("TEXTAREA");
    expect(screen.getByLabelText("Headers key 1")).toBeTruthy();
    expect(screen.getByLabelText("Query Params key 1")).toBeTruthy();
  });

  it("pushes edits to onDataChange", () => {
    const onDataChange = vi.fn();
    render(
      <NodeConfigForm
        definition={httpDefinition}
        data={httpNode.data}
        onDataChange={onDataChange}
      />,
    );

    fireEvent.change(screen.getByLabelText(/endpoint/i), {
      target: { value: "https://api.example.com/v2" },
    });
    expect(onDataChange).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "https://api.example.com/v2",
      }),
    );
  });

  it("reports an UnsupportedConfigFieldError instead of crashing", () => {
    const brokenDefinition = {
      ...httpDefinition,
      configSchema: z.object({ born: z.date() }),
    };
    render(
      <NodeConfigForm
        definition={brokenDefinition}
        data={{}}
        onDataChange={() => undefined}
      />,
    );
    expect(screen.getByText(/could not be displayed/i)).toBeTruthy();
    expect(screen.getByText("born")).toBeTruthy();
  });
});

describe("NodeConfigPanel (AF-M1-06)", () => {
  const patch = vi.fn();

  it("renders the node title, rename, notes, and enable switch", () => {
    render(
      <NodeConfigPanel
        workflowId="wf_test"
        node={httpNode}
        definition={httpDefinition}
        onNodeChange={patch}
      />,
    );

    expect(screen.getByDisplayValue("Fetch stats")).toBeTruthy();
    expect(screen.getByLabelText("Notes")).toBeTruthy();
    expect(screen.getByLabelText(/enabled/i)).toBeTruthy();
  });

  it("renames the node through onNodeChange", () => {
    render(
      <NodeConfigPanel
        workflowId="wf_test"
        node={httpNode}
        definition={httpDefinition}
        onNodeChange={patch}
      />,
    );
    fireEvent.change(screen.getByDisplayValue("Fetch stats"), {
      target: { value: "Fetch users" },
    });
    expect(patch).toHaveBeenCalledWith({ name: "Fetch users" });
  });

  it("disables the node through onNodeChange", () => {
    render(
      <NodeConfigPanel
        workflowId="wf_test"
        node={httpNode}
        definition={httpDefinition}
        onNodeChange={patch}
      />,
    );
    const toggle = screen.getByLabelText(/enabled/i) as HTMLInputElement;
    fireEvent.click(toggle);
    expect(patch).toHaveBeenCalledWith({ disabled: true });
  });

  it("says nothing about deprecation for a current node type", () => {
    render(
      <NodeConfigPanel
        workflowId="wf_test"
        node={httpNode}
        definition={httpDefinition}
        onNodeChange={patch}
      />,
    );

    expect(screen.queryByText(/Deprecated since/i)).toBeNull();
  });

  it("renders a deprecation notice if the node definition is deprecated (AF-M5-09)", () => {
    const { getAllByText, queryByText } = render(
      <NodeConfigPanel
        workflowId="wf_test"
        node={{ ...mockDeprecatedNode }}
        definition={mockDeprecatedDefinition}
        onNodeChange={vi.fn()}
      />,
    );

    // Using queryByText with a regular expression to handle text split across elements
    expect(
      queryByText(/Because testing\./i) ||
        getAllByText(
          (_content, element) =>
            element?.textContent?.includes("Because testing.") ?? false,
        )[0],
    ).toBeInTheDocument();
    expect(
      queryByText(/Please replace this with a NEW_NODE node\./i) ||
        getAllByText(
          (_content, element) =>
            element?.textContent?.includes("NEW_NODE") ?? false,
        )[0],
    ).toBeInTheDocument();
  });
});

describe("NodeConfigForm — AI_EXTRACT (AF-M5-03)", () => {
  const defaultExtractData = {
    fields: [{ name: "amount", type: "number", description: "Invoice total" }],
  };

  it("renders the fields row editor and the JSON schema escape hatch", () => {
    render(
      <NodeConfigForm
        definition={aiExtractDefinition}
        data={defaultExtractData}
        onDataChange={() => undefined}
      />,
    );

    const nameCell = screen.getByLabelText("Fields Name 1") as HTMLInputElement;
    expect(nameCell.value).toBe("amount");

    const typeCell = screen.getByLabelText(
      "Fields Type 1",
    ) as HTMLSelectElement;
    expect(typeCell.tagName).toBe("SELECT");
    expect(typeCell.value).toBe("number");
    expect(Array.from(typeCell.options).map((o) => o.value)).toEqual([
      "string",
      "number",
      "boolean",
      "object",
    ]);

    const descriptionCell = screen.getByLabelText(
      "Fields Description 1",
    ) as HTMLTextAreaElement;
    expect(descriptionCell.value).toBe("Invoice total");

    expect(
      (screen.getByLabelText(/json schema/i) as HTMLTextAreaElement).tagName,
    ).toBe("TEXTAREA");

    expect(
      screen.getByRole("button", { name: "+ Add fields row" }),
    ).toBeTruthy();
  });

  it("commits row edits to onDataChange", () => {
    const onDataChange = vi.fn();
    render(
      <NodeConfigForm
        definition={aiExtractDefinition}
        data={defaultExtractData}
        onDataChange={onDataChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Fields Name 1"), {
      target: { value: "total" },
    });
    expect(onDataChange).toHaveBeenCalledWith({
      fields: [expect.objectContaining({ name: "total", type: "number" })],
    });
  });

  it("adds and removes rows", () => {
    const onDataChange = vi.fn();
    render(
      <NodeConfigForm
        definition={aiExtractDefinition}
        data={defaultExtractData}
        onDataChange={onDataChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "+ Add fields row" }));
    expect(screen.getByLabelText("Fields Name 2")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Fields Name 2"), {
      target: { value: "dueDate" },
    });
    expect(onDataChange).toHaveBeenCalledWith({
      fields: [
        expect.objectContaining({ name: "amount" }),
        expect.objectContaining({ name: "dueDate" }),
      ],
    });

    const removeButtons = screen.getAllByRole("button", {
      name: /^Remove Fields row \d+$/,
    });
    fireEvent.click(removeButtons[1]);
    expect(screen.queryByLabelText("Fields Name 2")).toBeNull();
  });
});

describe("NodeConfigPanel — Run settings (AF-M9-06)", () => {
  const patch = vi.fn();

  beforeEach(() => {
    patch.mockClear();
  });

  function renderPanel(node: EditorNode = httpNode) {
    return render(
      <NodeConfigPanel
        workflowId="wf_test"
        node={node}
        definition={httpDefinition}
        onNodeChange={patch}
      />,
    );
  }

  it("exposes all four policy fields", () => {
    renderPanel();
    expect(screen.getByLabelText(/max attempts/i)).toBeTruthy();
    expect(screen.getByLabelText(/retry backoff/i)).toBeTruthy();
    expect(screen.getByLabelText(/attempt timeout/i)).toBeTruthy();
    expect(screen.getByLabelText(/continue on fail/i)).toBeTruthy();
  });

  it("is collapsed by default so it cannot bury the node's own config", () => {
    const { container } = renderPanel();
    const section = container.querySelector("details");
    expect(section).toBeTruthy();
    expect((section as HTMLDetailsElement).open).toBe(false);
  });

  it("shows the inherited value as a placeholder, not as a value", () => {
    // A node with no policy of its own must read as "inherits", otherwise the
    // user cannot tell an explicit 3 from the default 3.
    renderPanel();
    const attempts = screen.getByLabelText(/max attempts/i) as HTMLInputElement;
    expect(attempts.value).toBe("");
    expect(attempts.placeholder).toMatch(/inherits/i);
  });

  it("writes an override under the reserved _run key", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(/max attempts/i), {
      target: { value: "4" },
    });
    expect(patch).toHaveBeenCalledWith({
      data: { ...httpNode.data, _run: { maxAttempts: 4 } },
    });
  });

  it("clearing a field removes the override rather than writing 0", () => {
    const withPolicy: EditorNode = {
      ...httpNode,
      data: { ...httpNode.data, _run: { maxAttempts: 4 } },
    };
    renderPanel(withPolicy);
    fireEvent.change(screen.getByLabelText(/max attempts/i), {
      target: { value: "" },
    });
    // The whole key goes when it empties out — an empty object would make
    // every node's data differ from a node that never had a policy.
    expect(patch).toHaveBeenCalledWith({ data: httpNode.data });
  });

  it("toggles continueOnFail on and back off to nothing", () => {
    renderPanel();
    fireEvent.click(screen.getByLabelText(/continue on fail/i));
    expect(patch).toHaveBeenCalledWith({
      data: { ...httpNode.data, _run: { continueOnFail: true } },
    });

    patch.mockClear();
    renderPanel({
      ...httpNode,
      data: { ...httpNode.data, _run: { continueOnFail: true } },
    });
    fireEvent.click(screen.getAllByLabelText(/continue on fail/i)[1]);
    expect(patch).toHaveBeenCalledWith({ data: httpNode.data });
  });

  it("keeps the node's own config fields untouched when editing the policy", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(/attempt timeout/i), {
      target: { value: "5000" },
    });
    const [[arg]] = patch.mock.calls;
    expect((arg.data as Record<string, unknown>).endpoint).toBe(
      "https://api.example.com/users",
    );
  });
});
