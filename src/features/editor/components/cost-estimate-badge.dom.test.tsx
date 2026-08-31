import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it } from "vitest";
import type { EditorNode } from "@/features/editor/store/atoms";
import { nodesAtom } from "@/features/editor/store/atoms";
import { CostEstimateBadge } from "./cost-estimate-badge";

describe("CostEstimateBadge", () => {
  it("renders nothing when there are no AI nodes", () => {
    const store = createStore();
    store.set(nodesAtom, [
      { id: "1", type: "MANUAL_TRIGGER", data: {}, position: { x: 0, y: 0 } },
      { id: "2", type: "HTTP_REQUEST", data: {}, position: { x: 0, y: 0 } },
    ]);

    const { container } = render(
      <Provider store={store}>
        <CostEstimateBadge />
      </Provider>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders cost badge when AI nodes are present in the canvas draft", () => {
    const store = createStore();
    const nodes: EditorNode[] = [
      {
        id: "llm-1",
        type: "ai.llm",
        name: "AI Translator",
        data: {
          model: "openai:gpt-4o",
          systemPrompt: "Translate text.",
          userPrompt: "Hello world",
          maxTokens: 500,
        },
        position: { x: 0, y: 0 },
      },
    ];
    store.set(nodesAtom, nodes);

    render(
      <Provider store={store}>
        <CostEstimateBadge />
      </Provider>,
    );

    const button = screen.getByRole("button", {
      name: /workflow cost estimate/i,
    });
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent(/Est\./i);
    expect(button).toHaveTextContent(/\/ run/i);
  });

  it("opens popover with breakdown when clicked", () => {
    const store = createStore();
    const nodes: EditorNode[] = [
      {
        id: "llm-1",
        type: "ai.llm",
        name: "AI Translator",
        data: {
          model: "openai:gpt-4o",
          systemPrompt: "Translate text.",
          userPrompt: "Hello world",
          maxTokens: 500,
        },
        position: { x: 0, y: 0 },
      },
      {
        id: "extract-1",
        type: "ai.extract",
        name: "Invoice Parser",
        data: {
          model: "anthropic:claude-3-5-haiku",
          content: "Invoice $500",
          fields: [{ name: "amount", type: "number" }],
        },
        position: { x: 0, y: 0 },
      },
    ];
    store.set(nodesAtom, nodes);

    render(
      <Provider store={store}>
        <CostEstimateBadge />
      </Provider>,
    );

    const button = screen.getByRole("button", {
      name: /workflow cost estimate/i,
    });
    fireEvent.click(button);

    expect(screen.getByText(/Estimated AI Run Cost/i)).toBeInTheDocument();
    expect(screen.getByText(/AI Translator/i)).toBeInTheDocument();
    expect(screen.getByText(/Invoice Parser/i)).toBeInTheDocument();
    expect(screen.getByText(/openai:gpt-4o/i)).toBeInTheDocument();
    expect(screen.getByText(/anthropic:claude-3-5-haiku/i)).toBeInTheDocument();
  });
});
