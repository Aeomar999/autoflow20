import { describe, expect, it } from "vitest";
import { buildRawMessage, parseGmailMessage } from "./gmail";

const decode = (raw: string) => Buffer.from(raw, "base64url").toString("utf-8");
const b64 = (text: string) => Buffer.from(text, "utf-8").toString("base64url");

describe("buildRawMessage (AF-M10-15)", () => {
  it("builds a simple HTML message", () => {
    const message = decode(
      buildRawMessage({
        from: "bot@acme.com",
        to: "buyer@example.com",
        subject: "Your invoice",
        html: "<p>Attached.</p>",
      }),
    );

    expect(message).toContain("From: bot@acme.com");
    expect(message).toContain("To: buyer@example.com");
    expect(message).toContain("Subject: Your invoice");
    expect(message).toContain('Content-Type: text/html; charset="UTF-8"');
    // No attachments means no multipart: a simpler message renders more
    // predictably in old clients.
    expect(message).not.toContain("multipart/mixed");
  });

  it("refuses header injection through a newline", () => {
    // A subject is templated from run data. Left raw, "Hi\nBcc: everyone@…"
    // ends the Subject header and adds a recipient.
    const message = decode(
      buildRawMessage({
        from: "bot@acme.com",
        to: "buyer@example.com",
        subject: "Hi\r\nBcc: everyone@acme.com",
        text: "body",
      }),
    );

    const headerBlock = message.split("\r\n\r\n")[0];
    expect(headerBlock).not.toMatch(/^Bcc:/m);
    expect(message).toContain("Subject: Hi Bcc: everyone@acme.com");
  });

  it("refuses injection through a recipient too", () => {
    const message = decode(
      buildRawMessage({
        from: "bot@acme.com",
        to: "a@example.com\r\nBcc: leak@evil.com",
        subject: "s",
        text: "body",
      }),
    );
    expect(message.split("\r\n\r\n")[0]).not.toMatch(/^Bcc:/m);
  });

  it("encodes a non-ASCII subject rather than sending mojibake", () => {
    const message = decode(
      buildRawMessage({
        from: "bot@acme.com",
        to: "buyer@example.com",
        subject: "Rechnung — fällig",
        text: "body",
      }),
    );
    expect(message).toMatch(/Subject: =\?UTF-8\?B\?/);
  });

  it("leaves a plain ASCII subject alone", () => {
    const message = decode(
      buildRawMessage({
        from: "a@b.com",
        to: "c@d.com",
        subject: "Plain subject",
        text: "body",
      }),
    );
    expect(message).toContain("Subject: Plain subject");
    expect(message).not.toContain("=?UTF-8?B?");
  });

  it("builds multipart when there are attachments", () => {
    const message = decode(
      buildRawMessage({
        from: "bot@acme.com",
        to: "buyer@example.com",
        subject: "Invoice",
        html: "<p>See attached.</p>",
        attachments: [
          {
            filename: "invoice.pdf",
            mimeType: "application/pdf",
            data: Buffer.from("%PDF-1.7 fake"),
          },
        ],
      }),
    );

    expect(message).toContain("multipart/mixed");
    expect(message).toContain("Content-Type: application/pdf");
    expect(message).toContain(
      'Content-Disposition: attachment; filename="invoice.pdf"',
    );
    // Boundary opened and closed.
    const boundary = /boundary="([^"]+)"/.exec(message)?.[1] as string;
    expect(message).toContain(`--${boundary}--`);
  });

  it("wraps attachment base64 at 76 characters", () => {
    // Unwrapped base64 exceeds the 998-character line limit, and some relays
    // reject or mangle it.
    const message = decode(
      buildRawMessage({
        from: "a@b.com",
        to: "c@d.com",
        subject: "s",
        text: "body",
        attachments: [
          {
            filename: "big.bin",
            mimeType: "application/octet-stream",
            data: Buffer.alloc(4096, 0x41),
          },
        ],
      }),
    );

    for (const line of message.split("\r\n")) {
      expect(line.length).toBeLessThanOrEqual(998);
    }
  });

  it("refuses attachments over the message limit", () => {
    expect(() =>
      buildRawMessage({
        from: "a@b.com",
        to: "c@d.com",
        subject: "s",
        text: "body",
        attachments: [
          {
            filename: "huge.bin",
            mimeType: "application/octet-stream",
            data: Buffer.alloc(21 * 1024 * 1024),
          },
        ],
      }),
    ).toThrow(/limit for one message/);
  });

  it("threads a reply", () => {
    const message = decode(
      buildRawMessage({
        from: "a@b.com",
        to: "c@d.com",
        subject: "Re: thing",
        text: "body",
        inReplyTo: "<abc@mail.gmail.com>",
      }),
    );
    expect(message).toContain("In-Reply-To: <abc@mail.gmail.com>");
    expect(message).toContain("References: <abc@mail.gmail.com>");
  });
});

describe("parseGmailMessage (AF-M10-15)", () => {
  it("walks a nested part tree to find the body", () => {
    // multipart/mixed → multipart/alternative → text. A one-level scan finds
    // the body of a plain message and nothing at all of a real one.
    const message = parseGmailMessage({
      id: "m1",
      threadId: "t1",
      snippet: "Hello there",
      labelIds: ["INBOX", "UNREAD"],
      payload: {
        mimeType: "multipart/mixed",
        headers: [
          { name: "From", value: "sender@example.com" },
          { name: "Subject", value: "An invoice" },
          { name: "Date", value: "Wed, 3 Sep 2026 10:00:00 +0000" },
        ],
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [
              { mimeType: "text/plain", body: { data: b64("Plain body") } },
              {
                mimeType: "text/html",
                body: { data: b64("<p>HTML body</p>") },
              },
            ],
          },
          {
            mimeType: "application/pdf",
            filename: "invoice.pdf",
            body: { attachmentId: "att1", size: 1234 },
          },
        ],
      },
    });

    expect(message.subject).toBe("An invoice");
    expect(message.from).toBe("sender@example.com");
    expect(message.body).toBe("Plain body");
    expect(message.labelIds).toContain("UNREAD");
    expect(message.attachments).toEqual([
      {
        attachmentId: "att1",
        filename: "invoice.pdf",
        mimeType: "application/pdf",
        size: 1234,
      },
    ]);
  });

  it("falls back to stripped HTML when there is no plain part", () => {
    // Handing a model a page of markup and hoping is the alternative.
    const message = parseGmailMessage({
      id: "m2",
      payload: {
        mimeType: "text/html",
        headers: [],
        body: {
          data: b64("<style>p{color:red}</style><p>Hello</p><p>World</p>"),
        },
      },
    });

    expect(message.body).toBe("Hello\n\nWorld");
    expect(message.body).not.toContain("<p>");
    expect(message.body).not.toContain("color:red");
  });

  it("reads headers case-insensitively", () => {
    // Gmail is consistent, but the header spec is not case-sensitive and a
    // forwarded message can carry anything.
    const message = parseGmailMessage({
      id: "m3",
      payload: { headers: [{ name: "subject", value: "lowercase header" }] },
    });
    expect(message.subject).toBe("lowercase header");
  });

  it("survives a message with no payload at all", () => {
    const message = parseGmailMessage({ id: "m4" });
    expect(message.id).toBe("m4");
    expect(message.body).toBe("");
    expect(message.attachments).toEqual([]);
  });
});
