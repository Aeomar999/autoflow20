import { describe, expect, it } from "vitest";
import {
  buildTemplateContext,
  compileTemplate,
  ExpressionError,
  type NodeOutputMap,
} from "./template";

const context = {
  user: { name: "Ada" },
  nested: { deep: { value: 42 } },
};

describe("compileTemplate — prototype pollution resistance (AF-A-03)", () => {
  it.each([
    "{{constructor.name}}",
    "{{constructor.constructor}}",
    "{{this.constructor.prototype}}",
    "{{__proto__}}",
    "{{user.__proto__}}",
    "{{user.constructor.prototype.polluted}}",
    '{{lookup . "constructor"}}',
    "{{user.toString}}",
    "{{user.hasOwnProperty}}",
  ])("denies prototype chain access via %s", (template) => {
    expect(compileTemplate(template)(context)).toBe("");
  });

  it("cannot reach Node globals through the template", () => {
    expect(compileTemplate("{{process.env.SECRET}}")(context)).toBe("");
    expect(compileTemplate("{{globalThis.process}}")(context)).toBe("");
    expect(compileTemplate("{{require}}")(context)).toBe("");
  });

  it("still resolves legitimate own-property paths", () => {
    expect(compileTemplate("Hello {{user.name}}!")(context)).toBe("Hello Ada!");
    expect(compileTemplate("{{nested.deep.value}}")(context)).toBe("42");
  });

  it("json helper emits own properties only and does not throw on proto probes", () => {
    const rendered = compileTemplate("{{json user}}")(context);
    expect(JSON.parse(rendered)).toEqual({ name: "Ada" });
  });

  it("treats a null context as empty rather than crashing or leaking", () => {
    expect(compileTemplate("x={{missing}}")(null as never)).toBe("x=");
  });
});

// ---------------------------------------------------------------------------
// AF-M2-03 — buildTemplateContext + $-prefixed context surface
// ---------------------------------------------------------------------------

const meta = { executionId: "exec-123", workflowId: "wf-456" };

describe("buildTemplateContext", () => {
  it("adds $json as alias for accumulated context", () => {
    const ctx = buildTemplateContext({ foo: "bar" }, {}, meta);
    expect(ctx.$json).toEqual({ foo: "bar" });
  });

  it("adds $execution.id and $workflow.id", () => {
    const ctx = buildTemplateContext({}, {}, meta);
    expect(ctx.$execution.id).toBe("exec-123");
    expect(ctx.$workflow.id).toBe("wf-456");
  });

  it("adds $now as ISO-8601 string", () => {
    const ctx = buildTemplateContext({}, {}, meta);
    expect(ctx.$now).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("$node resolves to the nodeOutputs map", () => {
    const nodeOutputs: NodeOutputMap = {
      "HTTP Request": { status: 200, data: { ok: true } },
    };
    const ctx = buildTemplateContext({}, nodeOutputs, meta);
    expect(ctx.$node["HTTP Request"]).toEqual({
      status: 200,
      data: { ok: true },
    });
  });

  it("spreads accumulated context onto the result", () => {
    const ctx = buildTemplateContext({ msg: "hello" }, {}, meta);
    expect(ctx.msg).toBe("hello");
  });
});

describe("compileTemplate with $-prefixed context (AF-M2-03)", () => {
  const nodeOutputs: NodeOutputMap = {
    "HTTP Request": {
      httpResponse: { status: 200, data: { title: "Hello" } },
    },
    Slack: { messageContent: "Sent!" },
  };

  const enrichedCtx = buildTemplateContext(
    { httpResponse: { status: 200, data: { title: "Hello" } } },
    nodeOutputs,
    meta,
  );

  it("resolves $json as the accumulated context", () => {
    expect(compileTemplate("{{$json.httpResponse.status}}")(enrichedCtx)).toBe(
      "200",
    );
  });

  it("resolves $node by node name via lookup helper", () => {
    expect(
      compileTemplate('{{lookup $node "HTTP Request"}}')(enrichedCtx),
    ).toBe("[object Object]");
  });

  it("resolves $node by node name with dot-bracket syntax", () => {
    expect(
      compileTemplate("{{$node.[HTTP Request].httpResponse.data.title}}")(
        enrichedCtx,
      ),
    ).toBe("Hello");
  });

  it("resolves $execution.id", () => {
    expect(compileTemplate("{{$execution.id}}")(enrichedCtx)).toBe("exec-123");
  });

  it("resolves $workflow.id", () => {
    expect(compileTemplate("{{$workflow.id}}")(enrichedCtx)).toBe("wf-456");
  });

  it("resolves $now as ISO timestamp", () => {
    const rendered = compileTemplate("{{$now}}")(enrichedCtx);
    expect(rendered).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("$node for a missing node name resolves as empty string", () => {
    expect(compileTemplate("{{$node.[Nonexistent]}}")(enrichedCtx)).toBe("");
  });

  it("flat context keys still work alongside $-prefixed keys", () => {
    expect(compileTemplate("{{httpResponse.status}}")(enrichedCtx)).toBe("200");
  });

  it("$json and flat keys resolve the same value", () => {
    const flat = compileTemplate("{{httpResponse.status}}")(enrichedCtx);
    const json = compileTemplate("{{$json.httpResponse.status}}")(enrichedCtx);
    expect(flat).toBe(json);
  });

  it("json helper works with $-prefixed context", () => {
    const rendered = compileTemplate("{{json $node}}")(enrichedCtx);
    const parsed = JSON.parse(rendered);
    expect(parsed["HTTP Request"]).toBeDefined();
    expect(parsed["HTTP Request"].httpResponse.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// ExpressionError
// ---------------------------------------------------------------------------

describe("ExpressionError", () => {
  it("carries expression and nodeName", () => {
    const err = new ExpressionError("bad path", {
      expression: "{{$node.[X]}}",
      nodeName: "X",
    });
    expect(err.name).toBe("ExpressionError");
    expect(err.expression).toBe("{{$node.[X]}}");
    expect(err.nodeName).toBe("X");
  });

  it("nodeName is optional", () => {
    const err = new ExpressionError("structural", {
      expression: "{{.}}",
    });
    expect(err.nodeName).toBeUndefined();
  });
});
