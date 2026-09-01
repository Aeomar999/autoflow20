import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

type EmailModule = typeof import("./email");

async function loadEmail(): Promise<EmailModule> {
  vi.resetModules();
  return await import("./email");
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
});

describe("email", () => {
  it("throws ResendNotConfiguredError when RESEND_API_KEY is unset", async () => {
    const email = await loadEmail();
    await expect(
      email.sendVerificationEmail({
        user: { email: "a@b.com" },
        url: "http://x",
      }),
    ).rejects.toThrow(email.ResendNotConfiguredError);
    await expect(
      email.sendPasswordResetEmail({
        user: { email: "a@b.com" },
        url: "http://x",
      }),
    ).rejects.toThrow(email.ResendNotConfiguredError);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sends a verification email with the link and correct envelope", async () => {
    process.env.RESEND_API_KEY = "re_test-key";
    sendMock.mockResolvedValue({ error: null });
    const email = await loadEmail();

    await email.sendVerificationEmail({
      user: { email: "person@example.com" },
      url: "http://localhost:3000/verify-email?token=abc123",
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const [payload] = sendMock.mock.calls[0];
    expect(payload.to).toBe("person@example.com");
    expect(payload.subject).toContain("Verify your email");
    expect(payload.html).toContain(
      "http://localhost:3000/verify-email?token=abc123",
    );
    expect(payload.text).toContain(
      "http://localhost:3000/verify-email?token=abc123",
    );
  });

  it("sends a password reset email with the link", async () => {
    process.env.RESEND_API_KEY = "re_test-key";
    sendMock.mockResolvedValue({ error: null });
    const email = await loadEmail();

    await email.sendPasswordResetEmail({
      user: { email: "person@example.com" },
      url: "http://localhost:3000/reset-password?token=xyz789",
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const [payload] = sendMock.mock.calls[0];
    expect(payload.to).toBe("person@example.com");
    expect(payload.subject).toContain("Reset your");
    expect(payload.html).toContain(
      "http://localhost:3000/reset-password?token=xyz789",
    );
  });

  it("honours RESEND_FROM_EMAIL override as the sender", async () => {
    process.env.RESEND_API_KEY = "re_test-key";
    process.env.RESEND_FROM_EMAIL = "AutoFlow <noreply@autoflow.local>";
    sendMock.mockResolvedValue({ error: null });
    const email = await loadEmail();

    await email.sendVerificationEmail({
      user: { email: "a@b.com" },
      url: "http://x",
    });

    expect(sendMock.mock.calls[0][0].from).toBe(
      "AutoFlow <noreply@autoflow.local>",
    );
  });

  it("throws a descriptive error when Resend returns an error", async () => {
    process.env.RESEND_API_KEY = "re_test-key";
    sendMock.mockResolvedValue({ error: { message: "rate limited" } });
    const email = await loadEmail();

    await expect(
      email.sendVerificationEmail({
        user: { email: "a@b.com" },
        url: "http://x",
      }),
    ).rejects.toThrow("Failed to send");
  });
});
