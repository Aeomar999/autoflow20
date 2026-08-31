import { execSync } from "node:child_process";
import Stripe from "stripe";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { sendWorkflowExecution } from "@/inngest/utils";
import prisma from "@/lib/db";

/**
 * Route-level authz tests for the trigger webhooks (AF-A-01 acceptance).
 *
 * These run against a real Postgres via TEST_DATABASE_URL (see
 * docs/engineering/testing_strategy.md §4). Without that variable the whole
 * suite skips itself — visible in the reporter, never faked green.
 */
const dbUrl = process.env.TEST_DATABASE_URL;
const hasDb = Boolean(dbUrl);

// External boundary: we are testing webhook authz semantics, not Inngest
// delivery. The send call is asserted instead of performed.
vi.mock("@/inngest/utils", () => ({
  sendWorkflowExecution: vi.fn().mockResolvedValue({ ids: ["evt_test"] }),
  topologicalSort: vi.fn(),
}));

const { POST: stripePost } = await import("@/app/api/webhooks/stripe/route");
const { POST: googleFormPost } = await import(
  "@/app/api/webhooks/google-form/route"
);

const signingSecret = process.env.STRIPE_WEBHOOK_SECRET as string;
// The client is used only for local signature-header generation in these
// tests; the constructor requires a non-empty key, so reuse the secret.
const stripe = new Stripe(signingSecret);

const makeRequest = (
  url: string,
  body: string,
  headers: Record<string, string> = {},
) => {
  return new Request(url, {
    method: "POST",
    body,
    headers: { "content-type": "application/json", ...headers },
  }) as never;
};

describe.skipIf(!hasDb)("trigger webhook authz (AF-A-01)", () => {
  const ownerA = {
    id: "user_a_integration",
    email: "a@integration.test",
    name: "Owner A",
  };
  const ownerB = {
    id: "user_b_integration",
    email: "b@integration.test",
    name: "Owner B",
  };

  let workflowOfA: { id: string; webhookSecret: string };
  let workflowOfB: { id: string; webhookSecret: string };

  beforeAll(() => {
    // Apply migrations to the TEST database only. dotenv does not override
    // an explicitly passed DATABASE_URL, so this cannot touch dev/prod DBs.
    execSync("npx prisma migrate deploy", {
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: dbUrl },
    });
    process.env.DATABASE_URL = dbUrl;
  });

  beforeEach(async () => {
    vi.mocked(sendWorkflowExecution).mockClear();
    // Physical table names per schema @@map: User/Session/Account/Verification
    // are lowercased; every other model keeps its PascalCase name.
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "organization","member","invitation","workspace","NodeExecution","Execution","Connection","Node","Workflow","Credential","user","session","account","verification" CASCADE`,
    );

    await prisma.organization.createMany({
      data: [
        { name: "Org A", slug: "webhook-org-a" },
        { name: "Org B", slug: "webhook-org-b" },
      ],
    });
    const orgA = await prisma.organization.findUniqueOrThrow({
      where: { slug: "webhook-org-a" },
      select: { id: true },
    });
    const orgB = await prisma.organization.findUniqueOrThrow({
      where: { slug: "webhook-org-b" },
      select: { id: true },
    });

    await prisma.user.createMany({ data: [ownerA, ownerB] });
    workflowOfA = await prisma.workflow.create({
      data: { name: "wf-a", userId: ownerA.id, organizationId: orgA.id },
      select: { id: true, webhookSecret: true },
    });
    workflowOfB = await prisma.workflow.create({
      data: { name: "wf-b", userId: ownerB.id, organizationId: orgB.id },
      select: { id: true, webhookSecret: true },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("missing parameters → 400", () => {
    it("stripe: no workflowId", async () => {
      const res = await stripePost(
        makeRequest("http://localhost/api/webhooks/stripe?secret=x", "{}"),
      );
      expect(res.status).toBe(400);
    });

    it("stripe: no secret", async () => {
      const res = await stripePost(
        makeRequest(
          `http://localhost/api/webhooks/stripe?workflowId=${workflowOfA.id}`,
          "{}",
        ),
      );
      expect(res.status).toBe(400);
    });

    it("google-form: missing both", async () => {
      const res = await googleFormPost(
        makeRequest("http://localhost/api/webhooks/google-form", "{}"),
      );
      expect(res.status).toBe(400);
    });
  });

  describe("unknown workflow or bad secret → 404 (indistinguishable)", () => {
    it("stripe: unknown workflow id", async () => {
      const signature = await stripe.webhooks.generateTestHeaderString({
        payload: "{}",
        secret: signingSecret,
      });
      const res = await stripePost(
        makeRequest(
          "http://localhost/api/webhooks/stripe?workflowId=does-not-exist&secret=whatever",
          "{}",
          { "stripe-signature": signature },
        ),
      );
      expect(res.status).toBe(404);
    });

    it("google-form: wrong secret for existing workflow", async () => {
      const res = await googleFormPost(
        makeRequest(
          `http://localhost/api/webhooks/google-form?workflowId=${workflowOfA.id}&secret=wrong-secret`,
          JSON.stringify({ formId: "f1" }),
        ),
      );
      expect(res.status).toBe(404);
    });

    it("google-form: valid secret but unknown workflow", async () => {
      const res = await googleFormPost(
        makeRequest(
          `http://localhost/api/webhooks/google-form?workflowId=nope&secret=${workflowOfA.webhookSecret}`,
          "{}",
        ),
      );
      expect(res.status).toBe(404);
    });
  });

  describe("cross-owner rejection", () => {
    it("google-form: A's secret used against B's workflow → 404", async () => {
      const res = await googleFormPost(
        makeRequest(
          `http://localhost/api/webhooks/google-form?workflowId=${workflowOfB.id}&secret=${workflowOfA.webhookSecret}`,
          "{}",
        ),
      );
      expect(res.status).toBe(404);
      expect(vi.mocked(sendWorkflowExecution)).not.toHaveBeenCalled();
    });

    it("stripe: B's workflow + validly-signed body but A's URL secret → 404", async () => {
      const payload = JSON.stringify({ type: "checkout.completed" });
      const signature = await stripe.webhooks.generateTestHeaderString({
        payload,
        secret: signingSecret,
      });
      const res = await stripePost(
        makeRequest(
          `http://localhost/api/webhooks/stripe?workflowId=${workflowOfB.id}&secret=${workflowOfA.webhookSecret}`,
          payload,
          { "stripe-signature": signature },
        ),
      );
      expect(res.status).toBe(404);
      expect(vi.mocked(sendWorkflowExecution)).not.toHaveBeenCalled();
    });
  });

  describe("valid requests → 200 and exactly one enqueue", () => {
    it("google-form happy path", async () => {
      const body = { formId: "f1", responseId: "r1" };
      const res = await googleFormPost(
        makeRequest(
          `http://localhost/api/webhooks/google-form?workflowId=${workflowOfA.id}&secret=${workflowOfA.webhookSecret}`,
          JSON.stringify(body),
        ),
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(vi.mocked(sendWorkflowExecution)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(sendWorkflowExecution)).toHaveBeenCalledWith({
        workflowId: workflowOfA.id,
        initialData: expect.objectContaining({
          googleForm: expect.objectContaining({ formId: "f1" }),
        }),
      });
    });

    it("stripe: correctly signed payload passes signature verification", async () => {
      const eventPayload = {
        id: "evt_1",
        type: "checkout.session.completed",
        created: Math.floor(Date.now() / 1000),
        livemode: false,
        data: { object: { id: "cs_1" } },
      };
      const raw = JSON.stringify(eventPayload);
      const signature = await stripe.webhooks.generateTestHeaderString({
        payload: raw,
        secret: signingSecret,
      });
      const res = await stripePost(
        makeRequest(
          `http://localhost/api/webhooks/stripe?workflowId=${workflowOfA.id}&secret=${workflowOfA.webhookSecret}`,
          raw,
          { "stripe-signature": signature },
        ),
      );
      expect(res.status).toBe(200);
      expect(vi.mocked(sendWorkflowExecution)).toHaveBeenCalledWith({
        workflowId: workflowOfA.id,
        initialData: {
          stripe: expect.objectContaining({
            eventId: "evt_1",
            eventType: "checkout.session.completed",
          }),
        },
      });
    });

    it("stripe: tampered body fails signature verification → 400", async () => {
      const raw = JSON.stringify({ type: "legit" });
      const signature = await stripe.webhooks.generateTestHeaderString({
        payload: raw,
        secret: signingSecret,
      });
      const res = await stripePost(
        makeRequest(
          `http://localhost/api/webhooks/stripe?workflowId=${workflowOfA.id}&secret=${workflowOfA.webhookSecret}`,
          JSON.stringify({ type: "tampered" }),
          { "stripe-signature": signature },
        ),
      );
      expect(res.status).toBe(400);
      expect(vi.mocked(sendWorkflowExecution)).not.toHaveBeenCalled();
    });

    it("stripe: unsigned request rejected even with valid URL secret → 400", async () => {
      const res = await stripePost(
        makeRequest(
          `http://localhost/api/webhooks/stripe?workflowId=${workflowOfA.id}&secret=${workflowOfA.webhookSecret}`,
          "{}",
        ),
      );
      expect(res.status).toBe(400);
    });
  });
});
