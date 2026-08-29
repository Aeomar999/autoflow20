import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { EditorNode } from "@/features/editor/store/atoms";
import { definition as httpHttpRequest } from "@/nodes/http/request/definition";
import { NodeConfigForm, NodeConfigPanel } from "./node-config-panel";

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
        node={httpNode}
        definition={httpDefinition}
        onNodeChange={patch}
      />,
    );
    const toggle = screen.getByLabelText(/enabled/i) as HTMLInputElement;
    fireEvent.click(toggle);
    expect(patch).toHaveBeenCalledWith({ disabled: true });
  });
});
