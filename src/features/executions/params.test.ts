import { createSerializer } from "nuqs/server";
import { describe, expect, it } from "vitest";
import { executionsParams } from "./params";

/**
 * AF-UX-01 — search + workflowIds URL params.
 *
 * These are real nav params (like `status`): they must survive a page reload
 * as a URL, so the unit test pins the parser/serializer contract — including
 * clearOnDefault, which is what keeps a reset filter from leaving a stale
 * `?search=…&workflowIds=…` in the address bar.
 */
describe("executionsParams.search (AF-UX-01)", () => {
  it("parses a query value back to the same string", () => {
    expect(executionsParams.search.parseServerSide("quarterly revenue")).toBe(
      "quarterly revenue",
    );
  });

  it("defaults to an empty string when the query is absent", () => {
    expect(executionsParams.search.parseServerSide(undefined)).toBe("");
  });

  it("treats an explicit empty value as the default", () => {
    expect(executionsParams.search.parseServerSide("")).toBe("");
  });

  it("serializes a non-default value into the URL", () => {
    const serialize = createSerializer({ search: executionsParams.search });
    expect(serialize({ search: "invoice" })).toBe("?search=invoice");
  });

  it("is dropped from the URL when it equals the default (clearOnDefault)", () => {
    const serialize = createSerializer({ search: executionsParams.search });
    expect(serialize("https://app.local/executions", { search: "" })).toBe(
      "https://app.local/executions",
    );
  });
});

describe("executionsParams.workflowIds (AF-UX-01)", () => {
  it("parses a comma-joined query value back to an array", () => {
    expect(
      executionsParams.workflowIds.parseServerSide("wf_aaa,wf_bbb"),
    ).toEqual(["wf_aaa", "wf_bbb"]);
  });

  it("mimics URLSearchParams for repeated keys (first value wins)", () => {
    expect(
      executionsParams.workflowIds.parseServerSide(["wf_aaa", "wf_bbb"]),
    ).toEqual(["wf_aaa"]);
  });

  it("defaults to an empty array when the query is absent", () => {
    expect(executionsParams.workflowIds.parseServerSide(undefined)).toEqual([]);
  });

  it("serializes multiple ids comma-joined into the URL", () => {
    const serialize = createSerializer({
      workflowIds: executionsParams.workflowIds,
    });
    expect(serialize({ workflowIds: ["wf_aaa", "wf_bbb"] })).toBe(
      "?workflowIds=wf_aaa,wf_bbb",
    );
  });

  it("is dropped from the URL when it equals the default (clearOnDefault)", () => {
    const serialize = createSerializer({
      workflowIds: executionsParams.workflowIds,
    });
    expect(serialize({ workflowIds: [] })).toBe("");
  });

  it("combines with search in one query string", () => {
    const serialize = createSerializer({
      search: executionsParams.search,
      workflowIds: executionsParams.workflowIds,
    });
    expect(
      serialize({ search: "invoice", workflowIds: ["wf_aaa", "wf_bbb"] }),
    ).toBe("?search=invoice&workflowIds=wf_aaa,wf_bbb");
  });
});
