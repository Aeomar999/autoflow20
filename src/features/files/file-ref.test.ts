import { describe, expect, it } from "vitest";
import {
  collectFileRefs,
  FILE_REF_KEY,
  formatFileSize,
  isFileRef,
  makeFileRef,
} from "./file-ref";

const ref = (id = "f_1") =>
  makeFileRef({
    id,
    filename: "invoice.pdf",
    mimeType: "application/pdf",
    size: 3_145_728,
    sha256: "a".repeat(64),
  });

describe("FileRef (AF-M10-06)", () => {
  it("stays small enough to travel in a run context", () => {
    // The point of the whole design: a 3 MB PDF is represented by a few
    // hundred bytes, so it cannot breach the ADR-0018 per-node output cap.
    const serialized = JSON.stringify(ref());
    expect(serialized.length).toBeLessThan(512);
    expect(serialized).not.toContain("%PDF");
  });

  it("recognises a reference that has been through JSON", () => {
    // A FileRef is persisted into NodeExecution.output and read back as a
    // plain object, so identification has to be structural.
    const roundTripped = JSON.parse(JSON.stringify(ref()));
    expect(isFileRef(roundTripped)).toBe(true);
  });

  it("rejects anything that only looks like one", () => {
    expect(isFileRef(null)).toBe(false);
    expect(isFileRef("f_1")).toBe(false);
    expect(isFileRef({ filename: "x.pdf", size: 1 })).toBe(false);
    expect(isFileRef({ [FILE_REF_KEY]: { id: "f_1" } })).toBe(false);
    // An id must be present and non-empty, or nothing can fetch the bytes.
    expect(
      isFileRef({
        [FILE_REF_KEY]: {
          id: "",
          filename: "a",
          mimeType: "a",
          size: 1,
          sha256: "a",
        },
      }),
    ).toBe(false);
  });

  it("finds every reference at any depth", () => {
    const found = collectFileRefs({
      result: { attachments: [ref("f_1"), ref("f_2")] },
      other: { nested: { deep: ref("f_3") } },
      scalar: 42,
    });
    expect(found.map((f) => f[FILE_REF_KEY].id).sort()).toEqual([
      "f_1",
      "f_2",
      "f_3",
    ]);
  });

  it("returns nothing for a value with no files", () => {
    expect(collectFileRefs({ a: 1, b: ["x"], c: null })).toEqual([]);
  });

  it("formats sizes for messages a user reads", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
