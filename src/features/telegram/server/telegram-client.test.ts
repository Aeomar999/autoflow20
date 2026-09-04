import { NonRetriableError, RetryAfterError } from "inngest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TELEGRAM_MAX_MESSAGE_CHARS } from "../constants";
import { matchTelegramTrigger, telegramTriggerContext } from "./dispatch";
import {
  downloadTelegramFile,
  splitMessage,
  telegramFetch,
} from "./telegram-client";
import { parseTelegramUpdate, verifyTelegramSecret } from "./webhook";

/**
 * `parseTelegramUpdate` returns undefined for an update it does not
 * recognise. Asserting here turns that into a named failure instead of a
 * property access on undefined several lines later.
 */
function parsed(raw: unknown) {
  const update = parseTelegramUpdate(raw);
  if (!update) {
    throw new Error(`fixture did not parse: ${JSON.stringify(raw)}`);
  }
  return update;
}

const secret = { botToken: "123456:AA-test" };

function stubTelegram(
  responses: Array<{ body: unknown; status?: number; raw?: Buffer }>,
) {
  const calls: string[] = [];
  let index = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation((async (
    input: RequestInfo | URL,
  ) => {
    calls.push(String(input));
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (next.raw) {
      return new Response(new Uint8Array(next.raw), {
        status: next.status ?? 200,
        headers: { "content-type": "application/pdf" },
      });
    }
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch);
  return { calls };
}

describe("verifyTelegramSecret (AF-M10-21)", () => {
  const SECRET = "a-sufficiently-long-workflow-secret";

  it("accepts the matching token", () => {
    expect(verifyTelegramSecret({ provided: SECRET, expected: SECRET })).toBe(
      true,
    );
  });

  it("rejects a wrong token", () => {
    expect(verifyTelegramSecret({ provided: "nope", expected: SECRET })).toBe(
      false,
    );
  });

  it("rejects an absent header rather than throwing", () => {
    expect(verifyTelegramSecret({ provided: null, expected: SECRET })).toBe(
      false,
    );
  });

  it("refuses to verify against a too-short secret", () => {
    // Telegram allows a one-character secret_token. That is not a secret, and
    // accepting it would make the header a formality — so a misconfigured
    // workflow fails closed rather than accepting anything.
    expect(verifyTelegramSecret({ provided: "x", expected: "x" })).toBe(false);
  });

  it("rejects an empty expected secret, so an unset value opens nothing", () => {
    expect(verifyTelegramSecret({ provided: "", expected: "" })).toBe(false);
  });
});

describe("parseTelegramUpdate (AF-M10-21)", () => {
  it("reads a plain message", () => {
    const update = parseTelegramUpdate({
      update_id: 1,
      message: {
        chat: { id: 42 },
        from: { id: 7, username: "ada" },
        text: "/report weekly",
      },
    });

    expect(update).toMatchObject({
      updateId: 1,
      kind: "message",
      chatId: 42,
      text: "/report weekly",
      from: { id: 7, username: "ada" },
    });
  });

  it("takes the LARGEST photo, not the thumbnail", () => {
    // Telegram sends photo sizes ascending. Taking the first would silently
    // fetch a thumbnail and the workflow would process a blurry image.
    const update = parseTelegramUpdate({
      update_id: 2,
      message: {
        chat: { id: 1 },
        photo: [
          { file_id: "small" },
          { file_id: "medium" },
          { file_id: "large" },
        ],
      },
    });

    expect(update?.fileId).toBe("large");
  });

  it("reads a document with its filename", () => {
    const update = parseTelegramUpdate({
      update_id: 3,
      message: {
        chat: { id: 1 },
        document: { file_id: "doc-1", file_name: "invoice.pdf" },
        caption: "Here you go",
      },
    });

    expect(update).toMatchObject({
      fileId: "doc-1",
      fileName: "invoice.pdf",
      text: "Here you go",
    });
  });

  it("reports an update kind it does not model rather than failing", () => {
    // A poll answer or a chat-member change is a valid, signed update with
    // nothing to run.
    const update = parseTelegramUpdate({
      update_id: 4,
      poll_answer: { poll_id: "p1" },
    });
    expect(update?.kind).toBe("unsupported");
  });

  it("returns null for something that is not an update at all", () => {
    expect(parseTelegramUpdate({ hello: "world" })).toBeNull();
    expect(parseTelegramUpdate(null)).toBeNull();
  });
});

describe("matchTelegramTrigger (AF-M10-21)", () => {
  const snapshot = (data: Record<string, unknown>) => ({
    nodes: [{ id: "t1", type: "TELEGRAM_TRIGGER", data }],
  });

  const update = (over: Record<string, unknown> = {}) =>
    parsed({
      update_id: 1,
      message: { chat: { id: 42 }, text: "/report", ...over },
    });

  it("matches when no filters are set", () => {
    const match = matchTelegramTrigger({
      graphSnapshot: snapshot({}),
      update: update(),
      workflowId: "w1",
    });
    expect(match?.matched).toBe(true);
  });

  it("strips the @botname Telegram appends in groups", () => {
    // "/report@my_bot" is what a group message actually contains, so a plain
    // equality check against "/report" would never match there.
    const match = matchTelegramTrigger({
      graphSnapshot: snapshot({ commandFilter: "/report" }),
      update: update({ text: "/report@my_bot weekly" }),
      workflowId: "w1",
    });
    expect(match?.matched).toBe(true);
  });

  it("rejects a different command", () => {
    const match = matchTelegramTrigger({
      graphSnapshot: snapshot({ commandFilter: "/report" }),
      update: update({ text: "/status" }),
      workflowId: "w1",
    });
    expect(match?.matched).toBe(false);
  });

  it("applies the chat allowlist", () => {
    const match = matchTelegramTrigger({
      graphSnapshot: snapshot({ allowedChatIds: "99,100" }),
      update: update(),
      workflowId: "w1",
    });
    expect(match?.matched).toBe(false);
  });

  it("returns null when the workflow has no enabled trigger", () => {
    // Distinct from "the filters excluded it": the route reports one as a
    // misconfiguration and the other as a normal no-op.
    expect(
      matchTelegramTrigger({
        graphSnapshot: { nodes: [] },
        update: update(),
        workflowId: "w1",
      }),
    ).toBeNull();

    expect(
      matchTelegramTrigger({
        graphSnapshot: {
          nodes: [{ id: "t1", type: "TELEGRAM_TRIGGER", disabled: true }],
        },
        update: update(),
        workflowId: "w1",
      }),
    ).toBeNull();
  });

  it("survives an unparseable snapshot", () => {
    expect(
      matchTelegramTrigger({
        graphSnapshot: "{not json",
        update: update(),
        workflowId: "w1",
      }),
    ).toBeNull();
  });
});

describe("splitMessage (AF-M10-21)", () => {
  it("leaves a short message alone", () => {
    expect(splitMessage("hello", TELEGRAM_MAX_MESSAGE_CHARS)).toEqual([
      "hello",
    ]);
  });

  it("splits rather than losing the tail", () => {
    // Telegram REJECTS an over-long message rather than truncating, so the
    // alternative to splitting is sending nothing.
    const long = "x".repeat(TELEGRAM_MAX_MESSAGE_CHARS + 500);
    const chunks = splitMessage(long, TELEGRAM_MAX_MESSAGE_CHARS);

    expect(chunks.length).toBe(2);
    expect(chunks.join("")).toBe(long);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_CHARS);
    }
  });

  it("prefers a line boundary near the end", () => {
    const body = `${"a".repeat(90)}\n${"b".repeat(30)}`;
    const chunks = splitMessage(body, 100);
    expect(chunks[0].endsWith("\n")).toBe(true);
  });

  it("does not produce a tiny chunk for an early newline", () => {
    // A boundary at character 5 of a 100-character window would make the
    // first chunk 5 characters and the rest of the split pointless.
    const body = `a\n${"b".repeat(200)}`;
    const chunks = splitMessage(body, 100);
    expect(chunks[0].length).toBeGreaterThan(50);
  });
});

describe("telegramFetch — the ok:false envelope (AF-M10-21)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fails on ok:false even at HTTP 200", async () => {
    stubTelegram([
      { body: { ok: false, error_code: 400, description: "chat not found" } },
    ]);

    await expect(
      telegramFetch(secret, { method: "sendMessage", where: "test" }),
    ).rejects.toThrow(/chat not found/);
  });

  it("honours retry_after, which Telegram states explicitly", async () => {
    stubTelegram([
      {
        body: { ok: false, error_code: 429, parameters: { retry_after: 42 } },
      },
    ]);

    await expect(
      telegramFetch(secret, { method: "sendMessage", where: "test" }),
    ).rejects.toBeInstanceOf(RetryAfterError);
  });

  it("explains a 403 in terms of who can be messaged", async () => {
    // Telegram's own wording does not say that a bot cannot start a chat.
    stubTelegram([
      { body: { ok: false, error_code: 403, description: "bot was blocked" } },
    ]);

    const error = (await telegramFetch(secret, {
      method: "sendMessage",
      where: "test",
    }).catch((e) => e)) as Error;

    expect(error).toBeInstanceOf(NonRetriableError);
    expect(error.message).toMatch(/has not started a chat|blocked/i);
  });

  it("refuses a node with no credential bound", async () => {
    await expect(
      telegramFetch(undefined, { method: "getMe", where: "Test node" }),
    ).rejects.toThrow(/no Telegram credential/i);
  });
});

describe("downloadTelegramFile (AF-M10-21)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("resolves the path then fetches the bytes", async () => {
    const { calls } = stubTelegram([
      {
        body: { ok: true, result: { file_id: "f1", file_path: "docs/a.pdf" } },
      },
      { body: null, raw: Buffer.from("%PDF-1.4") },
    ]);

    const file = await downloadTelegramFile({
      secret,
      fileId: "f1",
      where: "test",
    });

    expect(calls[0]).toContain("getFile");
    expect(calls[1]).toContain("/file/bot");
    expect(file.filename).toBe("a.pdf");
    expect(file.mimeType).toBe("application/pdf");
    expect(file.size).toBeGreaterThan(0);
  });

  it("says why a file over 20 MB cannot be fetched", async () => {
    // getFile answers with an error rather than a path, which on its own reads
    // like the file does not exist.
    stubTelegram([
      { body: { ok: true, result: { file_id: "f1", file_size: 999 } } },
    ]);

    await expect(
      downloadTelegramFile({ secret, fileId: "f1", where: "test" }),
    ).rejects.toThrow(/20 MB/);
  });

  it("retries an expired download link", async () => {
    // Paths expire after about an hour; re-running the step gets a fresh one.
    stubTelegram([
      { body: { ok: true, result: { file_id: "f1", file_path: "a.pdf" } } },
      { body: null, status: 404 },
    ]);

    await expect(
      downloadTelegramFile({ secret, fileId: "f1", where: "test" }),
    ).rejects.toBeInstanceOf(RetryAfterError);
  });
});

describe("telegramTriggerContext (AF-M10-21)", () => {
  it("carries the file id, which is what makes Get File usable", () => {
    const update = parsed({
      update_id: 9,
      message: {
        chat: { id: 5 },
        document: { file_id: "doc-9", file_name: "report.pdf" },
      },
    });

    const context = telegramTriggerContext({ update, body: { update_id: 9 } });

    expect(context.telegram).toMatchObject({
      chatId: 5,
      fileId: "doc-9",
      fileName: "report.pdf",
    });
  });
});
