import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/inngest/utils", () => ({
  sendWorkflowExecution: vi.fn(async () => ({ eventId: "evt_form_test" })),
}));

import { POST } from "@/app/api/forms/[workflowId]/route";
import { findPublishedForm } from "@/features/forms/server/form-lookup";
import { sendWorkflowExecution } from "@/inngest/utils";
import prisma from "@/lib/db";

/**
 * AF-M10-14 against a real Postgres.
 *
 * The properties worth a database: that an unpublished, disabled or
 * wrong-segment form is indistinguishable from one that never existed, and
 * that a valid submission really creates a run with the payload the templates
 * expect.
 */

const hasDb = Boolean(process.env.TEST_DATABASE_URL);

const FIELDS = [
  { name: "email", label: "Email", type: "email", required: true },
  { name: "topic", label: "Topic", type: "select", options: "Sales\nSupport" },
  { name: "note", label: "Note", type: "textarea" },
];

describe.runIf(hasDb)("hosted intake form (AF-M10-14)", () => {
  let workflowId: string;
  let organizationId: string;

  const publish = async (
    over: { disabled?: boolean; pathSecret?: string; type?: string } = {},
  ) => {
    const version = await prisma.workflowVersion.create({
      data: {
        workflowId,
        version: Math.floor(Math.random() * 1_000_000),
        workflowRevision: 1,
        graphSnapshot: {
          nodes: [
            {
              id: "form-node",
              type: over.type ?? "FORM_TRIGGER",
              name: "Form",
              disabled: over.disabled ?? false,
              data: {
                title: "Contact us",
                submitLabel: "Send",
                successMessage: "Got it.",
                fields: FIELDS,
                ...(over.pathSecret ? { pathSecret: over.pathSecret } : {}),
              },
            },
          ],
          connections: [],
        },
      },
    });
    await prisma.workflow.update({
      where: { id: workflowId },
      data: { activeVersionId: version.id },
    });
  };

  const submit = async (body: FormData, search = "") => {
    const request = new Request(
      `http://localhost:3000/api/forms/${workflowId}${search}`,
      { method: "POST", body },
    );
    return POST(request as never, {
      params: Promise.resolve({ workflowId }),
    });
  };

  beforeEach(async () => {
    vi.mocked(sendWorkflowExecution).mockClear();
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "StoredFile","organization","member","invitation","workspace","WorkflowVersion","NodeExecution","Execution","Connection","Node","Workflow","Credential","user","session","account","verification" CASCADE`,
    );

    await prisma.user.create({
      data: {
        id: "user_form",
        email: "form@test.local",
        name: "Form",
        emailVerified: true,
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: "Form Org",
        slug: "form-org",
        members: { create: { userId: "user_form", role: "OWNER" } },
      },
    });
    organizationId = org.id;

    const workflow = await prisma.workflow.create({
      data: { name: "Intake", userId: "user_form", organizationId },
    });
    workflowId = workflow.id;
  });

  describe("who can see the form", () => {
    it("finds a published, enabled form", async () => {
      await publish();
      const form = await findPublishedForm({ workflowId });
      expect(form?.title).toBe("Contact us");
      expect(form?.fields).toHaveLength(3);
    });

    it("hides an unpublished workflow's form", async () => {
      expect(await findPublishedForm({ workflowId })).toBeNull();
    });

    it("hides a disabled trigger's form (AF-M9-17)", async () => {
      // Showing a form that cannot start a run is the worse failure.
      await publish({ disabled: true });
      expect(await findPublishedForm({ workflowId })).toBeNull();
    });

    it("hides a workflow with no form trigger", async () => {
      await publish({ type: "WEBHOOK_TRIGGER" });
      expect(await findPublishedForm({ workflowId })).toBeNull();
    });

    it("requires the path segment when the author set one", async () => {
      await publish({ pathSecret: "q7x2" });
      expect(await findPublishedForm({ workflowId })).toBeNull();
      expect(
        await findPublishedForm({ workflowId, pathSegment: "wrong" }),
      ).toBeNull();
      expect(
        await findPublishedForm({ workflowId, pathSegment: "q7x2" }),
      ).not.toBeNull();
    });

    it("rejects a path segment when the author set none", async () => {
      await publish();
      expect(
        await findPublishedForm({ workflowId, pathSegment: "anything" }),
      ).toBeNull();
    });
  });

  describe("submitting", () => {
    it("404s for an unpublished form rather than 500-ing", async () => {
      const body = new FormData();
      body.set("email", "a@b.com");
      const response = await submit(body);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found" });
      expect(sendWorkflowExecution).not.toHaveBeenCalled();
    });

    it("creates a run with the payload templates expect", async () => {
      await publish();
      const body = new FormData();
      body.set("email", "buyer@example.com");
      body.set("topic", "Sales");
      body.set("note", "Please call me.");

      const response = await submit(body);
      expect(response.status).toBe(202);

      const execution = await prisma.execution.findFirst({
        where: { workflowId },
      });
      expect(execution?.trigger).toBe("FORM");
      expect(execution?.organizationId).toBe(organizationId);

      expect(sendWorkflowExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          initialData: expect.objectContaining({
            form: expect.objectContaining({
              nodeId: "form-node",
              fields: {
                email: "buyer@example.com",
                topic: "Sales",
                note: "Please call me.",
              },
            }),
          }),
        }),
      );
    });

    it("reports every validation problem at once, and starts no run", async () => {
      await publish();
      const body = new FormData();
      body.set("email", "not-an-address");
      body.set("topic", "Enterprise");

      const response = await submit(body);
      expect(response.status).toBe(400);

      const payload = (await response.json()) as {
        errors: Array<{ field: string }>;
      };
      expect(payload.errors.map((e) => e.field).sort()).toEqual([
        "email",
        "topic",
      ]);
      expect(sendWorkflowExecution).not.toHaveBeenCalled();
      expect(await prisma.execution.count({ where: { workflowId } })).toBe(0);
    });

    it("requires the path segment on submit, not only on the page", async () => {
      // A form hidden behind a segment whose POST accepted anything would be
      // hidden from browsers and open to everyone else.
      await publish({ pathSecret: "q7x2" });
      const body = new FormData();
      body.set("email", "a@b.com");
      expect((await submit(body)).status).toBe(404);
    });

    it("stores a submitted file and passes a reference, not bytes", async () => {
      await prisma.workflowVersion.deleteMany({ where: { workflowId } });
      const version = await prisma.workflowVersion.create({
        data: {
          workflowId,
          version: 99,
          workflowRevision: 1,
          graphSnapshot: {
            nodes: [
              {
                id: "form-node",
                type: "FORM_TRIGGER",
                name: "Form",
                disabled: false,
                data: {
                  title: "Send a document",
                  fields: [
                    {
                      name: "doc",
                      label: "Document",
                      type: "file",
                      required: true,
                    },
                  ],
                },
              },
            ],
            connections: [],
          },
        },
      });
      await prisma.workflow.update({
        where: { id: workflowId },
        data: { activeVersionId: version.id },
      });

      const body = new FormData();
      body.set(
        "doc",
        new File([Buffer.from("%PDF-1.7 hello")], "brief.pdf", {
          type: "application/pdf",
        }),
      );

      const response = await submit(body);
      expect(response.status).toBe(202);

      const stored = await prisma.storedFile.findFirst({
        where: { organizationId },
      });
      expect(stored?.filename).toBe("brief.pdf");
      // No run existed when the file arrived, so it carries its own lifetime
      // and the sweep collects it if the run never happens (ADR-0025).
      expect(stored?.executionId).toBeNull();
      expect(stored?.expiresAt).not.toBeNull();

      const call = vi.mocked(sendWorkflowExecution).mock.calls[0][0];
      const files = (
        call.initialData as { form: { files: Record<string, unknown> } }
      ).form.files;
      expect(files.doc).toHaveProperty("$file");
    });

    it("refuses a file type not on the allowlist", async () => {
      await prisma.workflowVersion.deleteMany({ where: { workflowId } });
      const version = await prisma.workflowVersion.create({
        data: {
          workflowId,
          version: 100,
          workflowRevision: 1,
          graphSnapshot: {
            nodes: [
              {
                id: "form-node",
                type: "FORM_TRIGGER",
                name: "Form",
                disabled: false,
                data: {
                  fields: [{ name: "doc", label: "Document", type: "file" }],
                },
              },
            ],
            connections: [],
          },
        },
      });
      await prisma.workflow.update({
        where: { id: workflowId },
        data: { activeVersionId: version.id },
      });

      const body = new FormData();
      body.set(
        "doc",
        new File([Buffer.from("<script>alert(1)</script>")], "x.html", {
          type: "text/html",
        }),
      );

      const response = await submit(body);
      expect(response.status).toBe(400);
      expect(await prisma.storedFile.count()).toBe(0);
    });
  });
});
