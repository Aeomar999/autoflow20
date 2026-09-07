import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTemplateRoots } from "@/features/executions/template";
import { templateCatalog } from "@/features/templates/catalog";
import type { TemplateGraph } from "@/features/templates/server/instantiate";
import {
  ExecutionStatus,
  NodeExecutionStatus,
} from "@/generated/prisma/client";
import prisma from "@/lib/db";
import { runGraph } from "./run-graph";

/**
 * `hr-lifecycle-phase-1-recruitment`, driven from the payload the Google Form
 * webhook actually posts.
 *
 * The predecessor of this file fed `initialData` a flat
 * `form: { name, email, position, resume }` — a shape no trigger in the system
 * produces. It passed while production was broken three ways: the hosted-form
 * route nests everything under `form.fields`/`form.files`, `{{form.resume}}`
 * rendered a `FileRef` as "[object Object]", and both Slack nodes read a
 * `screening.json.*` key that `AI_EXTRACT` never writes. A fixture invented to
 * suit the graph cannot catch a graph that disagrees with its trigger, so the
 * payload below mirrors `src/app/api/webhooks/google-form/route.ts` exactly and
 * the mocks assert on what the nodes were actually handed.
 */

/** What `src/app/api/webhooks/google-form/route.ts` puts into the context. */
const googleFormPayload = (overrides: {
  name: string;
  email: string;
  position: string;
}) => ({
  googleForm: {
    formId: "1FAIpQLSc-test-form-id",
    formTitle: "Job Application",
    responseId: "2_ABaOnud-test-response",
    timestamp: "2026-09-07T09:15:00.000Z",
    respondentEmail: overrides.email,
    // Keyed by question TITLE, because that is what the generated Apps Script
    // sends: `responses[itemResponse.getItem().getTitle()]`. A file-upload
    // answer is an ARRAY of Drive ids, never the file.
    responses: {
      "Full Name": overrides.name,
      Email: overrides.email,
      Position: overrides.position,
      Resume: ["1AbCdEfGhIjKlMnOpQrStUvWxYz-drive-id"],
    },
    raw: {},
  },
});

/** Every `fileId` the Drive node was asked to download, in order. */
const downloadedFileIds: string[] = [];
/** Every `file` expression the extractor resolved, in order. */
const extractedFileArgs: string[] = [];
/** Every rendered Slack body, in order. */
const slackBodies: string[] = [];
/** Every rendered Gmail recipient, in order. */
const gmailRecipients: string[] = [];

vi.mock("@/nodes/drive/download/execute", () => ({
  execute: vi.fn(async ({ data, context, resolve }) => {
    const fileId = resolve(data.fileId as string).trim();
    downloadedFileIds.push(fileId);
    return {
      ...context,
      [data.variableName as string]: {
        file: { $file: { id: "stored-file-1", name: "resume.pdf" } },
        driveFileId: fileId,
        name: "resume.pdf",
        exported: false,
        mimeType: "application/pdf",
        bytes: 12345,
      },
    };
  }),
}));

vi.mock("@/nodes/files/extract-text/execute", () => ({
  execute: vi.fn(async ({ data, context, resolve }) => {
    extractedFileArgs.push(resolve(data.file as string).trim());
    return {
      ...context,
      [data.variableName as string]: {
        text: "Mock extracted resume text",
        truncated: false,
      },
    };
  }),
}));

vi.mock("@/nodes/ai/extract/execute", () => ({
  execute: vi.fn(async ({ data, context, resolve }) => {
    // The screening prompt must carry the candidate's real details; if the
    // expressions are wrong they render empty and the model sees nothing.
    const prompt = resolve(data.content as string);
    const unqualified = prompt.includes("Unqualified");
    return {
      ...context,
      [data.variableName as string]: {
        qualified: !unqualified,
        score: unqualified ? 40 : 85,
        summary: unqualified
          ? "Little overlap with the role's requirements."
          : "Candidate is a strong fit.",
        // Present so a regressed `{{screening.json.score}}` would still render
        // empty rather than accidentally resolving through this fixture.
        promptSeen: prompt,
      },
    };
  }),
}));

// Mirrors the real executor's contract: `{ ...context, [variableName]: … }`.
// The previous fixture returned a bare object, which wiped the context for
// every downstream node — so the Slack post that follows a Gmail send could
// never have rendered a candidate's name, in this test or in production.
vi.mock("@/nodes/gmail/send/execute", () => ({
  execute: vi.fn(async ({ data, context, resolve }) => {
    gmailRecipients.push(resolve(data.to as string).trim());
    return {
      ...context,
      [data.variableName as string]: {
        id: "mock-message-id",
        threadId: "mock-thread-id",
        attachmentCount: 0,
      },
    };
  }),
}));

vi.mock("@/nodes/slack/post/execute", () => ({
  execute: vi.fn(async ({ data, context, resolve }) => {
    slackBodies.push(resolve(data.text as string));
    return {
      ...context,
      [data.variableName as string]: { channel: "C0123ABCD", ts: "12345.678" },
    };
  }),
}));

vi.mock(
  "@/features/executions/server/credential-resolver",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/executions/server/credential-resolver")
      >();
    return {
      ...actual,
      resolveNodeCredentials: vi.fn(async () => ({})),
    };
  },
);

const hasDb = Boolean(process.env.TEST_DATABASE_URL);

const getTemplateGraph = () => {
  const spec = templateCatalog.find(
    (t) => t.slug === "hr-lifecycle-phase-1-recruitment",
  );
  if (!spec) throw new Error("Template not found");
  return spec;
};

describe("hr-lifecycle-phase-1-recruitment template", () => {
  beforeEach(async () => {
    downloadedFileIds.length = 0;
    extractedFileArgs.length = 0;
    slackBodies.length = 0;
    gmailRecipients.length = 0;
    if (hasDb) {
      await prisma.nodeExecution.deleteMany({});
      await prisma.execution.deleteMany({});
    }
  });

  // Contract checks — no database needed, so they run in every environment.
  // These are the assertions that would have caught the shipped defects.
  describe("trigger contract", () => {
    it("references only roots the Google Form trigger seeds", () => {
      const roots = new Set<string>();
      const walk = (value: unknown) => {
        if (typeof value === "string" && value.includes("{{")) {
          for (const root of getTemplateRoots(value)) roots.add(root);
          return;
        }
        if (Array.isArray(value)) {
          for (const item of value) walk(item);
          return;
        }
        if (value && typeof value === "object") {
          for (const inner of Object.values(value)) walk(inner);
        }
      };
      for (const node of getTemplateGraph().graph.nodes) walk(node.data);

      // `form` is the hosted-form root. Its presence here means an expression
      // survived the Google Forms conversion and will render empty at run time.
      expect([...roots]).not.toContain("form");
      // Everything else must be either the trigger root or an upstream node's
      // declared variableName.
      const produced = new Set([
        "googleForm",
        "resumeFile",
        "extractedResume",
        "screening",
        "bookingLink",
      ]);
      expect([...roots].filter((r) => !produced.has(r))).toEqual([]);
    });

    it("reads the Slack score and summary off the object AI_EXTRACT writes", () => {
      const slackText = getTemplateGraph()
        .graph.nodes.filter((n) => n.type === "SLACK_POST")
        .map((n) => (n.data as { text: string }).text);

      expect(slackText).toHaveLength(2);
      for (const text of slackText) {
        // AI_EXTRACT writes the model object flat at context[variableName],
        // so a `.json.` hop resolves to nothing.
        expect(text).not.toContain("screening.json");
        expect(text).toContain("{{screening.score}}");
        expect(text).toContain("{{screening.summary}}");
      }
    });

    it("does not HTML-escape free text or URLs", () => {
      // Handlebars escapes two-brace output. A plain-text mail body, a Slack
      // message and an LLM prompt all render `&#x27;` literally, so every
      // free-text and URL interpolation must be triple-braced. Two braces on
      // the booking link produced `?email&#x3D;` — a dead link in the one
      // message whose whole purpose is to be clicked.
      // Only a boolean and a number may stay two-braced; neither has a
      // character that escaping can touch.
      const ALLOWED_TWO_BRACE = new Set([
        "{{screening.qualified}}",
        "{{screening.score}}",
      ]);

      const offenders: string[] = [];
      const walk = (value: unknown) => {
        if (typeof value === "string") {
          // Blank out the triple-braced spans first, so a `{{{...}}}`
          // cannot be mis-read as a `{{...}}` starting one character in.
          const withoutTriples = value.replace(/\{\{\{[^{}]*\}\}\}/g, "");
          for (const hit of withoutTriples.match(/\{\{[^{}]*\}\}/g) ?? []) {
            if (!ALLOWED_TWO_BRACE.has(hit)) offenders.push(hit);
          }
          return;
        }
        if (Array.isArray(value)) {
          for (const item of value) walk(item);
          return;
        }
        if (value && typeof value === "object") {
          for (const inner of Object.values(value)) walk(inner);
        }
      };
      for (const node of getTemplateGraph().graph.nodes) walk(node.data);

      expect(offenders).toEqual([]);
    });

    it("emits real newlines, not the two-character escape", () => {
      const bodies = getTemplateGraph()
        .graph.nodes.flatMap((n) =>
          [
            (n.data as { text?: string }).text,
            (n.data as { content?: string }).content,
          ].filter((v): v is string => typeof v === "string"),
        )
        .filter((body) => body.includes("\n") || body.includes("\\n"));

      expect(bodies.length).toBeGreaterThan(0);
      for (const body of bodies) {
        // A literal backslash-n reaches the candidate's inbox verbatim.
        expect(body).not.toContain("\\n");
      }
    });
  });

  describe.runIf(hasDb)("execution", () => {
    it("exercises the TRUE path (Qualified)", async () => {
      const graph = getTemplateGraph().graph as unknown as TemplateGraph;

      const { execution, nodeExecutions } = await runGraph(graph, {
        initialData: googleFormPayload({
          name: "Ada Lovelace",
          email: "ada@example.com",
          position: "Software Engineer",
        }),
      });

      expect(execution.status).toBe(ExecutionStatus.SUCCESS);
      const byName = new Map(nodeExecutions.map((n) => [n.nodeName, n.status]));
      expect(byName.get("Download Resume")).toBe(NodeExecutionStatus.SUCCESS);
      expect(byName.get("Extract Resume Text")).toBe(
        NodeExecutionStatus.SUCCESS,
      );
      expect(byName.get("AI Resume Screening")).toBe(
        NodeExecutionStatus.SUCCESS,
      );
      expect(byName.get("Qualified?")).toBe(NodeExecutionStatus.SUCCESS);

      expect(byName.get("Set Booking Link")).toBe(NodeExecutionStatus.SUCCESS);
      expect(byName.get("Send Interview Booking Email")).toBe(
        NodeExecutionStatus.SUCCESS,
      );
      expect(byName.get("Notify Recruiting - Qualified")).toBe(
        NodeExecutionStatus.SUCCESS,
      );

      expect(byName.get("Send Polite Rejection")).toBe(
        NodeExecutionStatus.SKIPPED,
      );
      expect(byName.get("Notify Recruiting - Not Qualified")).toBe(
        NodeExecutionStatus.SKIPPED,
      );
    });

    it("unwraps the Drive id out of the file-upload array", async () => {
      const graph = getTemplateGraph().graph as unknown as TemplateGraph;

      await runGraph(graph, {
        initialData: googleFormPayload({
          name: "Ada Lovelace",
          email: "ada@example.com",
          position: "Software Engineer",
        }),
      });

      // Not the whole array, and not "[object Object]".
      expect(downloadedFileIds).toEqual([
        "1AbCdEfGhIjKlMnOpQrStUvWxYz-drive-id",
      ]);
      // The extractor must receive the FileRef as JSON, not a stringified object.
      expect(extractedFileArgs).toHaveLength(1);
      expect(extractedFileArgs[0]).not.toBe("[object Object]");
      expect(JSON.parse(extractedFileArgs[0])).toMatchObject({
        $file: { id: "stored-file-1" },
      });
    });

    it("renders the candidate's own details into the email and Slack post", async () => {
      const graph = getTemplateGraph().graph as unknown as TemplateGraph;

      await runGraph(graph, {
        initialData: googleFormPayload({
          name: "Ada Lovelace",
          email: "ada@example.com",
          position: "Software Engineer",
        }),
      });

      expect(gmailRecipients).toEqual(["ada@example.com"]);
      expect(slackBodies).toHaveLength(1);
      expect(slackBodies[0]).toContain("Ada Lovelace");
      expect(slackBodies[0]).toContain("Software Engineer");
      expect(slackBodies[0]).toContain("85");
      expect(slackBodies[0]).toContain("Candidate is a strong fit.");
      // The rendered message must not still be carrying an unresolved handle.
      expect(slackBodies[0]).not.toContain("{{");
    });

    it("exercises the FALSE path (Not Qualified)", async () => {
      const graph = getTemplateGraph().graph as unknown as TemplateGraph;

      const { execution, nodeExecutions } = await runGraph(graph, {
        initialData: googleFormPayload({
          name: "John Unqualified",
          email: "john@example.com",
          position: "Software Engineer",
        }),
      });

      expect(execution.status).toBe(ExecutionStatus.SUCCESS);
      const byName = new Map(nodeExecutions.map((n) => [n.nodeName, n.status]));
      expect(byName.get("Send Polite Rejection")).toBe(
        NodeExecutionStatus.SUCCESS,
      );
      expect(byName.get("Notify Recruiting - Not Qualified")).toBe(
        NodeExecutionStatus.SUCCESS,
      );

      expect(byName.get("Set Booking Link")).toBe(NodeExecutionStatus.SKIPPED);
      expect(byName.get("Send Interview Booking Email")).toBe(
        NodeExecutionStatus.SKIPPED,
      );
      expect(byName.get("Notify Recruiting - Qualified")).toBe(
        NodeExecutionStatus.SKIPPED,
      );

      expect(gmailRecipients).toEqual(["john@example.com"]);
      expect(slackBodies[0]).toContain("John Unqualified");
      expect(slackBodies[0]).toContain("40");
    });
  });
});
