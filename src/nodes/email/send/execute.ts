import "server-only";
import { NonRetriableError } from "inngest";
import nodemailer from "nodemailer";
import { compileTemplate } from "@/features/executions/template";
import { emailSendChannel } from "@/inngest/channels/email-send";
import type { NodeRun } from "@/nodes/types";

type EmailSendData = {
  variableName?: string;
  credentialId?: string;
  from?: string;
  fromName?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  body?: string;
};

// Connection timeouts bound a dead relay instead of hanging a run attempt.
const SMTP_TIMEOUT_MS = 30_000;

export const execute: NodeRun<EmailSendData> = async ({
  data,
  nodeId,
  context,
  step,
  publish,
  credentials,
}) => {
  await publish(
    emailSendChannel().status({
      nodeId,
      status: "loading",
    }),
  );

  try {
    const result = await step.run("email-send", async () => {
      if (!data.variableName) {
        await publish(
          emailSendChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError("Email node: Variable name not configured");
      }

      if (!data.credentialId) {
        await publish(
          emailSendChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError("Email node: No SMTP credential selected");
      }

      const secret = credentials?.credentialId;
      if (!secret) {
        await publish(
          emailSendChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError("Email node: SMTP credential not found");
      }

      if (!data.from) {
        await publish(
          emailSendChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError("Email node: No sender configured");
      }

      if (!data.to) {
        await publish(
          emailSendChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError("Email node: No recipient configured");
      }

      if (!data.subject) {
        await publish(
          emailSendChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError("Email node: Subject not configured");
      }

      const to = compileTemplate(data.to)(context);
      const cc = data.cc ? compileTemplate(data.cc)(context) : undefined;
      const bcc = data.bcc ? compileTemplate(data.bcc)(context) : undefined;
      const subject = compileTemplate(data.subject)(context);
      const body = data.body ? compileTemplate(data.body)(context) : "";

      // Deny policy: the SMTP user/password never leave this scope, so a run
      // that throws still cannot disclose secrets through its trace.
      const tls = secret.tls;
      const transporter = nodemailer.createTransport({
        host: secret.host,
        port: Number(secret.port),
        secure: tls === "ssl",
        requireTLS: tls !== "ssl" && tls !== "none",
        auth: secret.username
          ? { user: secret.username, pass: secret.password }
          : undefined,
        connectionTimeout: SMTP_TIMEOUT_MS,
        greetingTimeout: SMTP_TIMEOUT_MS,
        socketTimeout: SMTP_TIMEOUT_MS,
      });

      const info = await transporter.sendMail({
        from: data.fromName
          ? { name: data.fromName, address: data.from }
          : data.from,
        to,
        cc,
        bcc,
        subject,
        text: body,
      });

      return {
        ...context,
        [data.variableName]: {
          email: {
            from: data.from,
            to,
            subject,
            messageId: info.messageId ?? null,
          },
        },
      };
    });

    await publish(
      emailSendChannel().status({
        nodeId,
        status: "success",
      }),
    );

    return result;
  } catch (error) {
    await publish(
      emailSendChannel().status({
        nodeId,
        status: "error",
      }),
    );
    throw error;
  }
};
