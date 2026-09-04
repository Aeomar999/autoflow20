import { NonRetriableError } from "inngest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeChatId,
  parseWahaEvent,
  resolveWahaBase,
} from "./waha-client";

describe("normalizeChatId (AF-M10-21)", () => {
  it("addresses a bare phone number", () => {
    // WAHA accepts a raw number and delivers nothing — no error, no message.
    // This normalisation is the difference between working and silently not.
    expect(normalizeChatId("447700900123")).toBe("447700900123@c.us");
  });

  it("strips the punctuation people actually type", () => {
    expect(normalizeChatId("+44 7700 900123")).toBe("447700900123@c.us");
    expect(normalizeChatId("(447) 700-900123")).toBe("447700900123@c.us");
  });

  it("leaves an already-addressed id alone", () => {
    expect(normalizeChatId("447700900123@c.us")).toBe("447700900123@c.us");
    expect(normalizeChatId("123-456@g.us")).toBe("123-456@g.us");
  });

  it("recognises a group id before stripping its hyphen", () => {
    // The digit strip would turn "123-456" into "123456" and address an
    // individual who is not in the group.
    expect(normalizeChatId("123456789-987654321")).toBe(
      "123456789-987654321@g.us",
    );
  });

  it("passes through a value with no digits rather than inventing one", () => {
    expect(normalizeChatId("not-a-number")).toBe("not-a-number");
  });
});

describe("parseWahaEvent (AF-M10-21)", () => {
  it("reads a message from the payload envelope", () => {
    const message = parseWahaEvent({
      event: "message",
      payload: {
        id: "m1",
        from: "447700900123@c.us",
        body: "hello",
        timestamp: 1725400000,
      },
    });

    expect(message).toMatchObject({
      messageId: "m1",
      chatId: "447700900123@c.us",
      text: "hello",
      fromMe: false,
    });
  });

  it("accepts a bare payload, which some WAHA versions send", () => {
    const message = parseWahaEvent({ id: "m2", from: "1@c.us", body: "hi" });
    expect(message?.messageId).toBe("m2");
  });

  it("flags the bot's OWN messages, which is what stops a reply loop", () => {
    // WAHA delivers outbound messages back as events. A workflow that replies
    // to what it receives would reply to its own replies, forever.
    const message = parseWahaEvent({
      payload: { id: "m3", from: "1@c.us", body: "my own reply", fromMe: true },
    });
    expect(message?.fromMe).toBe(true);
  });

  it("returns null for something that is not an event", () => {
    expect(parseWahaEvent(null)).toBeNull();
    expect(parseWahaEvent("string")).toBeNull();
  });

  it("reports media without needing the bytes", () => {
    const message = parseWahaEvent({
      payload: { id: "m4", from: "1@c.us", hasMedia: true },
    });
    expect(message?.hasMedia).toBe(true);
  });
});

describe("resolveWahaBase — the base URL is user-supplied (AF-M10-21)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("refuses a loopback base URL", async () => {
    // The SSRF case. A self-hosted base URL is user input, so pointing it at
    // localhost would make a WhatsApp node a reader of this server's own
    // services.
    await expect(
      resolveWahaBase(
        { apiKey: "k", baseUrl: "http://127.0.0.1:3000" },
        "Test node",
      ),
    ).rejects.toBeInstanceOf(NonRetriableError);
  });

  it("refuses the cloud metadata address", async () => {
    // 169.254.169.254 is the one that turns an integration into a credential
    // leak on most cloud providers.
    const error = (await resolveWahaBase(
      { apiKey: "k", baseUrl: "http://169.254.169.254/latest/meta-data/" },
      "Test node",
    ).catch((e) => e)) as Error;

    expect(error).toBeInstanceOf(NonRetriableError);
    expect(error.message).toMatch(/public host|internal address/i);
  });

  it("refuses a private-range address", async () => {
    await expect(
      resolveWahaBase(
        { apiKey: "k", baseUrl: "http://10.0.0.5:3000" },
        "Test node",
      ),
    ).rejects.toBeInstanceOf(NonRetriableError);
  });

  it("says what is missing when there is no base URL", async () => {
    // WAHA is self-hosted, so unlike every other connector there is no default
    // to fall back to.
    await expect(resolveWahaBase({ apiKey: "k" }, "Test node")).rejects.toThrow(
      /no base URL/i,
    );
  });

  it("refuses a node with no credential bound", async () => {
    await expect(resolveWahaBase(undefined, "Test node")).rejects.toThrow(
      /no WAHA credential/i,
    );
  });
});
