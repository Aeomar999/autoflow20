import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NonRetriableError } from "inngest";
import { afterEach, describe, expect, it } from "vitest";
import { LocalBlobStore } from "@/features/files/server/blob-store";
import { formatBytes, parseSingleFileRef } from "./upload-stream";

/**
 * The streaming acceptance for AF-M10-22.
 *
 * The requirement is "a video is never buffered whole in memory", and the
 * check the acceptance names is a fixture LARGER than the per-node output cap.
 * That size is what makes the difference observable: a buffering
 * implementation has to hold all of it, a streaming one holds a chunk.
 */

/** Comfortably above the 1 MB per-node output cap. */
const OVERSIZED_BYTES = 8 * 1024 * 1024;

describe("blob store streaming (AF-M10-22)", () => {
  let root: string;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("streams a file larger than the per-node output cap in chunks", async () => {
    root = await mkdtemp(join(tmpdir(), "af-stream-"));
    const store = new LocalBlobStore(root);

    const payload = Buffer.alloc(OVERSIZED_BYTES, 0x41);
    await store.put("org/2026-09/big", payload, "video/mp4");

    const stream = await store.getStream("org/2026-09/big");
    const reader = stream.getReader();

    let received = 0;
    let chunks = 0;
    let largestChunk = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      chunks += 1;
      largestChunk = Math.max(largestChunk, value.byteLength);
    }

    expect(received).toBe(OVERSIZED_BYTES);

    // The whole point: more than one chunk, and no single chunk is the file.
    // A `get()`-based implementation would produce exactly one chunk of
    // 8 MB — which is the buffering this exists to avoid.
    expect(chunks).toBeGreaterThan(1);
    expect(largestChunk).toBeLessThan(OVERSIZED_BYTES);
  });

  it("reports a missing key as BlobNotFoundError, not an async stream error", async () => {
    // createReadStream defers ENOENT to an 'error' event, which would surface
    // as an unhandled rejection mid-upload rather than something the node can
    // report.
    root = await mkdtemp(join(tmpdir(), "af-stream-"));
    const store = new LocalBlobStore(root);

    await expect(store.getStream("org/2026-09/absent")).rejects.toThrow(
      /Blob not found/,
    );
  });

  it("round-trips the same bytes as get()", async () => {
    root = await mkdtemp(join(tmpdir(), "af-stream-"));
    const store = new LocalBlobStore(root);

    const payload = Buffer.from("the quick brown fox");
    await store.put("org/2026-09/small", payload, "text/plain");

    const buffered = await store.get("org/2026-09/small");
    const streamed = Buffer.from(
      await new Response(
        await store.getStream("org/2026-09/small"),
      ).arrayBuffer(),
    );

    expect(streamed.equals(buffered)).toBe(true);
  });
});

describe("parseSingleFileRef (AF-M10-22)", () => {
  const collect = (value: unknown) => {
    const refs: Array<{ $file: { id: string } }> = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      if ("$file" in (node as Record<string, unknown>)) {
        refs.push(node as { $file: { id: string } });
        return;
      }
      for (const child of Object.values(node as Record<string, unknown>)) {
        walk(child);
      }
    };
    walk(value);
    return refs;
  };

  it("names the three-brace fix on unparseable input", () => {
    // Two braces HTML-escape the quotes, which is the most common authoring
    // error with a file reference by a wide margin.
    expect(() =>
      parseSingleFileRef({
        rendered: "{&quot;$file&quot;:{&quot;id&quot;:&quot;f1&quot;}}",
        where: "Test node",
        collect,
      }),
    ).toThrow(/three braces/);
  });

  it("refuses several files rather than silently publishing the first", () => {
    expect(() =>
      parseSingleFileRef({
        rendered: JSON.stringify([
          { $file: { id: "a" } },
          { $file: { id: "b" } },
        ]),
        where: "Test node",
        collect,
      }),
    ).toThrow(/2 files/);
  });

  it("refuses a value with no file reference in it", () => {
    expect(() =>
      parseSingleFileRef({
        rendered: JSON.stringify({ text: "hello" }),
        where: "Test node",
        collect,
      }),
    ).toThrow(/no file reference/);
  });

  it("refuses an empty expression", () => {
    expect(() =>
      parseSingleFileRef({ rendered: "   ", where: "Test node", collect }),
    ).toThrow(NonRetriableError);
  });

  it("returns the id for one reference", () => {
    expect(
      parseSingleFileRef({
        rendered: JSON.stringify({ file: { $file: { id: "f-123" } } }),
        where: "Test node",
        collect,
      }),
    ).toBe("f-123");
  });
});

describe("formatBytes (AF-M10-22)", () => {
  it("names a size the way a person would", () => {
    // These strings end up in the limit errors, so they have to read well.
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.00 GB");
  });
});
