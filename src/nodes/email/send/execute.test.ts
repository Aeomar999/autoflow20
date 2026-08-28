import { NonRetriableError } from "inngest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeRunParams } from "@/nodes/types";

const mockSendMail = vi.fn(async () => ({ messageId: "<mock@example.com>" }));
const mockCreateTransport = vi.fn((_config: unknown) => ({
  sendMail: mockSendMail,
}));

// Network boundary is mocked: SMTP transport never connects. Templating,
// validation, and channel publishing run for real.
vi.mock("nodemailer", () => ({
  default: {
    createTransport: (config: unknown) => mockCreateTransport(config),
  },
}));

// The realtime sender is an infra binding; stub it to a plain payload so the
// executor's publish calls are assertable. Channel wiring is covered by the
// realtime subscription layer.
vi.mock("@/inngest/channels/email-send", () => ({
  EMAIL_SEND_CHANNEL_NAME: "email-send-execution",
  emailSendChannel: () => ({
    status: (payload: unknown) => payload,
  }),
}));

import { execute } from "./execute";

const step = {
  run: async <T>(_id: string, fn: () => Promise<T>): Promise<T> => fn(),
} as unknown as NodeRunParams["step"];

const publish = vi.fn(async () => {});

const smtpSecret = {
  host: "smtp.example.com",
  port: "587",
  username: "relay-user",
  password: "relay-pass",
  tls: "starttls",
};

const makeParams = (overrides: Partial<NodeRunParams> = {}): NodeRunParams => ({
  nodeId: "node_1",
  userId: "user_1",
  context: { data: { userId: "usr_123" } },
  credentials: { credentialId: smtpSecret },
  step,
  publish,
  ...overrides,
});

beforeEach(() => {
  mockSendMail.mockClear();
  mockCreateTransport.mockClear();
});

describe("EMAIL_SEND execute", () => {
  it("sends a templated email and stores the delivery result", async () => {
    const params = makeParams({
      data: {
        variableName: "sentEmail",
        credentialId: "cm_smtp",
        from: "no-reply@example.com",
        fromName: "Acme",
        to: "team@example.com, {{data.userId}}@example.com",
        cc: "lead@example.com",
        subject: "Invoice {{data.userId}}",
        body: "Your invoice is ready.",
      },
    });

    const result = await execute(params);

    expect(mockCreateTransport).toHaveBeenCalledTimes(1);
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.example.com",
        port: 587,
        secure: false,
        requireTLS: true,
        auth: { user: "relay-user", pass: "relay-pass" },
      }),
    );

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { name: "Acme", address: "no-reply@example.com" },
        to: "team@example.com, usr_123@example.com",
        cc: "lead@example.com",
        subject: "Invoice usr_123",
        text: "Your invoice is ready.",
      }),
    );

    const stored = result.sentEmail as {
      email: { from?: string; to: string; subject: string; messageId: string };
    };
    expect(stored.email.to).toBe("team@example.com, usr_123@example.com");
    expect(stored.email.subject).toBe("Invoice usr_123");
    expect(stored.email.messageId).toBe("<mock@example.com>");

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "loading" }),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success" }),
    );
  });

  it("maps SSL and none TLS modes onto the secure/requireTLS flags", async () => {
    await execute(
      makeParams({
        credentials: { credentialId: { ...smtpSecret, tls: "ssl" } },
        data: {
          variableName: "sentEmail",
          credentialId: "cm_smtp",
          from: "no-reply@example.com",
          to: "team@example.com",
          subject: "Hello",
        },
      }),
    );
    expect(mockCreateTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ secure: true, requireTLS: false }),
    );

    await execute(
      makeParams({
        credentials: { credentialId: { ...smtpSecret, tls: "none" } },
        data: {
          variableName: "sentEmail",
          credentialId: "cm_smtp",
          from: "no-reply@example.com",
          to: "team@example.com",
          subject: "Hello",
        },
      }),
    );
    expect(mockCreateTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ secure: false, requireTLS: false }),
    );
  });

  it("throws a non-retriable error when the sender is missing", async () => {
    const params = makeParams({
      data: {
        variableName: "sentEmail",
        credentialId: "cm_smtp",
        to: "team@example.com",
        subject: "Hello",
      },
    });

    await expect(execute(params)).rejects.toThrow(
      new NonRetriableError("Email node: No sender configured"),
    );
    expect(mockCreateTransport).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("throws a non-retriable error when the recipient is missing", async () => {
    const params = makeParams({
      data: {
        variableName: "sentEmail",
        credentialId: "cm_smtp",
        from: "no-reply@example.com",
        subject: "Hello",
      },
    });

    await expect(execute(params)).rejects.toThrow(
      new NonRetriableError("Email node: No recipient configured"),
    );
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("throws a non-retriable error when the credential is not found", async () => {
    const params = makeParams({
      credentials: undefined,
      data: {
        variableName: "sentEmail",
        credentialId: "cm_smtp",
        from: "no-reply@example.com",
        to: "team@example.com",
        subject: "Hello",
      },
    });

    await expect(execute(params)).rejects.toThrow(
      new NonRetriableError("Email node: SMTP credential not found"),
    );
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });
});
