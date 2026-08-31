import { describe, expect, it } from "vitest";

import { fuzzyScore, NO_MATCH, rankResults } from "./fuzzy";
import type { SearchResult } from "./types";

const result = (title: string, subtitle?: string): SearchResult => ({
  kind: "workflow",
  id: title,
  title,
  subtitle,
});

describe("fuzzyScore", () => {
  it("scores an exact match highest", () => {
    expect(fuzzyScore("Slack", "Slack")).toBeGreaterThan(
      fuzzyScore("Slack alerts", "Slack"),
    );
  });

  it("is case-insensitive", () => {
    expect(fuzzyScore("SLACK", "slack")).toBe(fuzzyScore("slack", "SLACK"));
  });

  it("prefers a prefix to a mid-string match", () => {
    expect(fuzzyScore("Slack approval", "sla")).toBeGreaterThan(
      fuzzyScore("Post to Slack", "sla"),
    );
  });

  it("prefers a word-boundary match to a mid-word one", () => {
    expect(fuzzyScore("Invoice to Slack", "slack")).toBeGreaterThan(
      fuzzyScore("Unslackable thing", "slack"),
    );
  });

  it("matches a scattered subsequence", () => {
    expect(fuzzyScore("Weekly search rank digest", "wsrd")).not.toBe(NO_MATCH);
  });

  it("rejects characters that are not present", () => {
    expect(fuzzyScore("Slack", "zzz")).toBe(NO_MATCH);
  });

  it("rejects a subsequence that is out of order", () => {
    expect(fuzzyScore("abc", "cba")).toBe(NO_MATCH);
  });

  it("rewards consecutive characters over scattered ones", () => {
    expect(fuzzyScore("workflow", "work")).toBeGreaterThan(
      fuzzyScore("we or knew", "work"),
    );
  });

  it("breaks ties toward the shorter name", () => {
    expect(fuzzyScore("Slack", "sl")).toBeGreaterThan(
      fuzzyScore("Slack approval gate copy 3", "sl"),
    );
  });

  it("treats an empty query as a neutral match", () => {
    expect(fuzzyScore("anything", "")).toBe(0);
  });
});

describe("rankResults", () => {
  it("leaves order untouched for an empty query", () => {
    // The server orders by recency; with nothing typed, that ordering is the
    // most useful one and must survive.
    const items = [result("Zebra"), result("Apple"), result("Mango")];
    expect(rankResults(items, "").map((r) => r.title)).toEqual([
      "Zebra",
      "Apple",
      "Mango",
    ]);
  });

  it("drops non-matches", () => {
    const items = [result("Slack alerts"), result("Postgres sync")];
    expect(rankResults(items, "slack").map((r) => r.title)).toEqual([
      "Slack alerts",
    ]);
  });

  it("orders by score", () => {
    const items = [
      result("Post to Slack"),
      result("Slack approval"),
      result("Slack"),
    ];
    expect(rankResults(items, "slack").map((r) => r.title)).toEqual([
      "Slack",
      "Slack approval",
      "Post to Slack",
    ]);
  });

  it("matches on the subtitle too", () => {
    // Typing a status should find the run, whose title is the workflow name.
    const items = [result("Nightly sync", "FAILED · a1b2c3d4")];
    expect(rankResults(items, "failed")).toHaveLength(1);
  });

  it("ranks a title match above a subtitle match", () => {
    const items = [
      result("Nightly sync", "FAILED · a1b2c3d4"),
      result("Failed payment handler", "SUCCESS · e5f6a7b8"),
    ];
    expect(rankResults(items, "failed")[0].title).toBe(
      "Failed payment handler",
    );
  });

  it("is stable for equal scores", () => {
    const items = [result("Slack one"), result("Slack two")];
    expect(rankResults(items, "slack").map((r) => r.title)).toEqual([
      "Slack one",
      "Slack two",
    ]);
  });
});
