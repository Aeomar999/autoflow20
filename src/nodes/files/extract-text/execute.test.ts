import { describe, expect, it, vi } from "vitest";
import type { NodeRunParams } from "@/nodes/types";

const { readFileMock } = vi.hoisted(() => ({
  readFileMock: vi.fn(async () => ({
    data: Buffer.from("hello from a text file"),
    filename: "notes.txt",
    mimeType: "text/plain",
  })),
}));

vi.mock("@/features/files/server/file-service", () => ({
  readFile: readFileMock,
}));

import { makeFileRef } from "@/features/files/file-ref";
import { withResolve } from "@/nodes/shared/test-params";
import { execute } from "./execute";

const step = {
  run: async <T>(_id: string, fn: () => Promise<T>): Promise<T> => fn(),
} as unknown as NodeRunParams["step"];

const publish = vi.fn(async () => {});

const fileRef = makeFileRef({
  id: "file_1",
  filename: "notes.txt",
  mimeType: "text/plain",
  size: 22,
  sha256: "a".repeat(64),
});

const run = (
  data: Record<string, unknown>,
  opts: {
    context?: Record<string, unknown>;
    organizationId?: string | undefined;
  } = {},
) =>
  execute(
    withResolve({
      data,
      nodeId: "node_extract",
      userId: "user_1",
      workflowId: "wf_1",
      organizationId: "organizationId" in opts ? opts.organizationId : "org_1",
      context: opts.context ?? { download: { file: fileRef } },
      step,
      publish,
    }) as unknown as NodeRunParams,
  );

describe("EXTRACT_DOCUMENT_TEXT (AF-M10-11)", () => {
  it("reads a FileRef rendered as JSON and returns its text", async () => {
    readFileMock.mockResolvedValueOnce({
      data: Buffer.from("hello from a text file"),
      filename: "notes.txt",
      mimeType: "text/plain",
    });

    const result = await run({
      variableName: "extracted",
      file: "{{{json download.file}}}",
    });

    expect(readFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: "file_1", organizationId: "org_1" }),
    );
    expect(result.extracted).toMatchObject({
      text: "hello from a text file",
      truncated: false,
      format: "plain text",
      filename: "notes.txt",
    });
  });

  it("accepts a bare file id, which a CODE node might carry forward", async () => {
    readFileMock.mockResolvedValueOnce({
      data: Buffer.from("plain"),
      filename: "a.txt",
      mimeType: "text/plain",
    });
    await run({ variableName: "extracted", file: "file_42" });
    expect(readFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: "file_42" }),
    );
  });

  it("reports truncation instead of applying it silently", async () => {
    // A contract analysed from its first half produces a confident, wrong
    // answer — the caller has to be able to see the text was cut.
    readFileMock.mockResolvedValueOnce({
      data: Buffer.from("x".repeat(5000)),
      filename: "long.txt",
      mimeType: "text/plain",
    });

    const result = await run({
      variableName: "extracted",
      file: "file_1",
      maxCharacters: 1000,
    });

    expect(result.extracted).toMatchObject({
      truncated: true,
      characterCount: 1000,
    });
  });

  it("reports no page count for a format that has no pages", async () => {
    // A fabricated `1` would make a downstream "page 3 of 1" look sane.
    readFileMock.mockResolvedValueOnce({
      data: Buffer.from("no pages here"),
      filename: "a.txt",
      mimeType: "text/plain",
    });
    const result = await run({ variableName: "extracted", file: "file_1" });
    expect((result.extracted as { pageCount: unknown }).pageCount).toBeNull();
  });

  it("refuses an unsupported type, naming it and the supported ones", async () => {
    // The extractor's own fallback decodes anything unknown as UTF-8, which
    // would "succeed" on a PNG with a page of binary garbage.
    readFileMock.mockResolvedValueOnce({
      data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      filename: "photo.png",
      mimeType: "image/png",
    });

    await expect(
      run({ variableName: "extracted", file: "file_1" }),
    ).rejects.toThrow(/image\/png[\s\S]*cannot read/i);
  });

  it("names the mistake when the file expression renders as [object Object]", async () => {
    await expect(
      run({ variableName: "extracted", file: "{{download.file}}" }),
    ).rejects.toThrow(/\[object Object\]/);
  });

  it("fails when the run has no organization to scope the read to", async () => {
    await expect(
      run(
        { variableName: "extracted", file: "file_1" },
        { organizationId: undefined },
      ),
    ).rejects.toThrow(/no organization/i);
  });
});
