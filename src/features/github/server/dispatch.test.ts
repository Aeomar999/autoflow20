import { describe, expect, it } from "vitest";
import { collectGithubTargets, githubTriggerContext } from "./dispatch";
import type { GithubWebhookEvent } from "./webhook";

const delivery = (
  over: Partial<GithubWebhookEvent> = {},
): GithubWebhookEvent => ({
  event: "pull_request",
  action: "opened",
  repository: "acme/web",
  sender: "octocat",
  deliveryId: "d-1",
  ...over,
});

const workflow = (
  data: Record<string, unknown>,
  over: { id?: string; type?: string; disabled?: boolean } = {},
) => ({
  id: over.id ?? "wf-1",
  organizationId: "org-1",
  activeVersion: {
    graphSnapshot: {
      nodes: [
        {
          id: "trigger",
          type: over.type ?? "GITHUB_TRIGGER",
          disabled: over.disabled,
          data,
        },
      ],
    },
  },
});

describe("collectGithubTargets (AF-M10-18)", () => {
  it("routes a delivery to a trigger naming that repository", () => {
    const targets = collectGithubTargets({
      workflows: [workflow({ repo: "acme/web", events: "pull_request" })],
      delivery: delivery(),
    });
    expect(targets).toHaveLength(1);
    expect(targets[0].workflowId).toBe("wf-1");
  });

  it("does NOT treat a trigger with no repository as a wildcard", () => {
    // The security-relevant one. A blank repo matching everything would make
    // one workspace's workflow fire on every other workspace's repositories,
    // since this is a single app-wide endpoint.
    const targets = collectGithubTargets({
      workflows: [workflow({ events: "pull_request" })],
      delivery: delivery(),
    });
    expect(targets).toEqual([]);
  });

  it("does not route to a different repository", () => {
    const targets = collectGithubTargets({
      workflows: [workflow({ repo: "other/repo" })],
      delivery: delivery(),
    });
    expect(targets).toEqual([]);
  });

  it("matches a pasted URL against GitHub's owner/name form", () => {
    const targets = collectGithubTargets({
      workflows: [workflow({ repo: "https://github.com/acme/web" })],
      delivery: delivery(),
    });
    expect(targets).toHaveLength(1);
  });

  it("matches case-insensitively, as GitHub does", () => {
    const targets = collectGithubTargets({
      workflows: [workflow({ repo: "Acme/Web" })],
      delivery: delivery({ repository: "acme/web" }),
    });
    expect(targets).toHaveLength(1);
  });

  it("skips a disabled trigger", () => {
    const targets = collectGithubTargets({
      workflows: [workflow({ repo: "acme/web" }, { disabled: true })],
      delivery: delivery(),
    });
    expect(targets).toEqual([]);
  });

  it("skips a workflow whose event filter excludes the delivery", () => {
    // Starting a run that immediately has nothing to act on burns quota and
    // makes the execution list unreadable.
    const targets = collectGithubTargets({
      workflows: [workflow({ repo: "acme/web", events: "push" })],
      delivery: delivery({ event: "pull_request" }),
    });
    expect(targets).toEqual([]);
  });

  it("applies the action filter", () => {
    const targets = collectGithubTargets({
      workflows: [
        workflow({
          repo: "acme/web",
          events: "pull_request",
          actions: "closed",
        }),
      ],
      delivery: delivery({ action: "opened" }),
    });
    expect(targets).toEqual([]);
  });

  it("ignores a node that is not a GitHub trigger", () => {
    const targets = collectGithubTargets({
      workflows: [
        workflow({ repo: "acme/web" }, { type: "QBO_WEBHOOK_TRIGGER" }),
      ],
      delivery: delivery(),
    });
    expect(targets).toEqual([]);
  });

  it("survives an unparseable snapshot without losing other workflows", () => {
    const targets = collectGithubTargets({
      workflows: [
        {
          id: "broken",
          organizationId: "org-1",
          activeVersion: { graphSnapshot: "{not json" },
        },
        workflow({ repo: "acme/web" }, { id: "wf-2" }),
      ],
      delivery: delivery(),
    });
    expect(targets.map((t) => t.workflowId)).toEqual(["wf-2"]);
  });

  it("accepts a snapshot stored as a JSON string", () => {
    const targets = collectGithubTargets({
      workflows: [
        {
          id: "wf-3",
          organizationId: "org-1",
          activeVersion: {
            graphSnapshot: JSON.stringify({
              nodes: [
                { id: "t", type: "GITHUB_TRIGGER", data: { repo: "acme/web" } },
              ],
            }),
          },
        },
      ],
      delivery: delivery(),
    });
    expect(targets).toHaveLength(1);
  });
});

describe("githubTriggerContext (AF-M10-18)", () => {
  it("carries the routing fields and the whole payload", () => {
    // What matters differs per event — a push wants commits, a release wants
    // the tag — so the payload is passed through rather than picked over.
    const context = githubTriggerContext({
      delivery: delivery(),
      body: { pull_request: { number: 7 } },
    });

    expect(context.github).toMatchObject({
      event: "pull_request",
      action: "opened",
      repository: "acme/web",
      payload: { pull_request: { number: 7 } },
    });
  });
});
