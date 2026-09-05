import { NonRetriableError, RetryAfterError } from "inngest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  describeAvailableTransitions,
  type JiraTransition,
  jiraFetch,
  matchTransition,
  textToAdf,
} from "./jira-client";

const secret = { accessToken: "atl_test", cloudId: "cloud-1" };

function stubJira(
  responses: Array<{
    body: unknown;
    status?: number;
    headers?: Record<string, string>;
  }>,
) {
  const calls: URL[] = [];
  let index = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation((async (
    input: RequestInfo | URL,
  ) => {
    calls.push(new URL(String(input)));
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    // 204 is a null-body status: the Response constructor rejects
    // any body with it, empty string included.
    return new Response(
      next.status === 204 ? null : JSON.stringify(next.body),
      {
        status: next.status ?? 200,
        headers: {
          "content-type": "application/json",
          ...(next.headers ?? {}),
        },
      },
    );
  }) as typeof fetch);
  return { calls };
}

describe("matchTransition — the reason the node takes a name (AF-M10-18)", () => {
  const transitions: JiraTransition[] = [
    { id: "11", name: "Start Progress", to: { name: "In Progress" } },
    { id: "31", name: "Finish Work", to: { name: "Done" } },
    { id: "41", name: "Reopen", to: { name: "To Do" } },
  ];

  it("matches on the transition name", () => {
    expect(matchTransition(transitions, "Finish Work")?.id).toBe("31");
  });

  it("matches case-insensitively", () => {
    // People type "done", not "Done".
    expect(matchTransition(transitions, "finish work")?.id).toBe("31");
  });

  it("falls back to the destination STATUS name", () => {
    // The important convenience: people say "move it to Done" when the
    // transition is called "Finish Work" and Done is the status it lands on.
    expect(matchTransition(transitions, "Done")?.id).toBe("31");
  });

  it("prefers a transition name over a status name when both could match", () => {
    const ambiguous: JiraTransition[] = [
      { id: "1", name: "Done", to: { name: "Complete" } },
      { id: "2", name: "Finish", to: { name: "Done" } },
    ];
    expect(matchTransition(ambiguous, "Done")?.id).toBe("1");
  });

  it("returns undefined for a name this workflow does not have", () => {
    expect(matchTransition(transitions, "Deploy")).toBeUndefined();
  });

  it("lists what IS available, which is what makes the failure fixable", () => {
    const message = describeAvailableTransitions(transitions);
    expect(message).toContain("Finish Work");
    expect(message).toContain("Done");
  });

  it("explains an empty transition list rather than listing nothing", () => {
    // An issue with no outgoing transitions is usually a permission problem,
    // and "Available: " followed by nothing tells the user nothing.
    expect(describeAvailableTransitions([])).toMatch(/permission|no outgoing/i);
  });
});

describe("textToAdf (AF-M10-18)", () => {
  it("wraps plain text as a document, which v3 requires", () => {
    // Passing a bare string here is rejected with a message that never
    // mentions ADF, which is why this exists at all.
    const doc = textToAdf("Hello there");
    expect(doc.type).toBe("doc");
    expect(doc.version).toBe(1);
    expect(doc.content).toHaveLength(1);
  });

  it("splits blank-line-separated blocks into paragraphs", () => {
    const doc = textToAdf("First para.\n\nSecond para.");
    expect(doc.content).toHaveLength(2);
  });

  it("keeps single newlines as hard breaks", () => {
    // A pasted list would otherwise collapse onto one line.
    const doc = textToAdf("Line one\nLine two");
    const paragraph = doc.content[0] as { content: Array<{ type: string }> };
    expect(paragraph.content.some((n) => n.type === "hardBreak")).toBe(true);
  });

  it("produces a valid document for empty input", () => {
    const doc = textToAdf("");
    expect(doc.type).toBe("doc");
    expect(Array.isArray(doc.content)).toBe(true);
  });
});

describe("jiraFetch (AF-M10-18)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("addresses the per-site cloud id, not the atlassian.net domain", () => {
    const { calls } = stubJira([{ body: { key: "ENG-1" } }]);
    return jiraFetch(secret, { path: "/issue/ENG-1", where: "test" }).then(
      () => {
        expect(calls[0].host).toBe("api.atlassian.com");
        expect(calls[0].pathname).toBe(
          "/ex/jira/cloud-1/rest/api/3/issue/ENG-1",
        );
      },
    );
  });

  it("says to reconnect when the credential has no cloud id", async () => {
    // The cloud id is resolved once at authorise time; a credential without
    // one predates that and cannot be repaired by retrying.
    await expect(
      jiraFetch({ accessToken: "t" }, { path: "/issue", where: "Test node" }),
    ).rejects.toThrow(/cloud id/i);
  });

  it("handles a 204 with no body, which transitions return", async () => {
    stubJira([{ body: null, status: 204 }]);
    await expect(
      jiraFetch(secret, {
        path: "/issue/ENG-1/transitions",
        method: "POST",
        where: "test",
      }),
    ).resolves.toBeUndefined();
  });

  it("surfaces Jira's per-field errors, which name the actual problem", async () => {
    stubJira([
      {
        body: {
          errorMessages: [],
          errors: { summary: "Summary is required." },
        },
        status: 400,
      },
    ]);

    const error = (await jiraFetch(secret, {
      path: "/issue",
      method: "POST",
      where: "test",
    }).catch((e) => e)) as Error;

    expect(error).toBeInstanceOf(NonRetriableError);
    expect(error.message).toContain("summary: Summary is required.");
  });

  it("retries a 429 and honours retry-after", async () => {
    stubJira([{ body: {}, status: 429, headers: { "retry-after": "20" } }]);
    await expect(
      jiraFetch(secret, { path: "/issue", where: "test" }),
    ).rejects.toBeInstanceOf(RetryAfterError);
  });

  it("does not retry a 401", async () => {
    stubJira([{ body: {}, status: 401 }]);
    await expect(
      jiraFetch(secret, { path: "/issue", where: "test" }),
    ).rejects.toBeInstanceOf(NonRetriableError);
  });

  it("mentions browse permission on a 404, not just a bad key", async () => {
    stubJira([
      { body: { errorMessages: ["Issue does not exist"] }, status: 404 },
    ]);
    const error = (await jiraFetch(secret, {
      path: "/issue/ENG-9",
      where: "test",
    }).catch((e) => e)) as Error;
    expect(error.message).toMatch(/browse|cannot/i);
  });
});
