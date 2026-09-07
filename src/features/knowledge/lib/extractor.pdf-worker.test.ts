import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractTextFromBuffer } from "./extractor";

/**
 * PDF extraction must not depend on resolving a worker file from disk.
 *
 * **Why this exists.** pdfjs runs its parser in a worker. On Node it disables
 * real workers and loads the worker module in-process instead, defaulting
 * `GlobalWorkerOptions.workerSrc` to the relative specifier
 * `"./pdf.worker.mjs"` and then loading it with a dynamic import marked
 * `webpackIgnore`.
 *
 * That marker is the problem. It tells webpack to leave the specifier alone,
 * so webpack neither rewrites it nor emits the worker file — and a *relative*
 * specifier left alone resolves against whatever directory the importing
 * module ended up in. Unbundled that is
 * `node_modules/pdfjs-dist/legacy/build/`, where the worker really does sit.
 * In the Vercel build pdfjs is inlined into `.next/server/chunks/`, where it
 * does not, and every PDF failed with
 *
 *     Setting up fake worker failed: "Cannot find module
 *     '/var/task/.next/server/chunks/pdf.worker.mjs'"
 *
 * Nothing here could have caught it: `next build`, `tsc`, Biome and the whole
 * suite all run against `node_modules`, the one layout where the relative
 * path resolves. The failure was reachable only through a deploy.
 *
 * The extractor therefore hands pdfjs the worker directly through
 * `globalThis.pdfjsWorker`, which pdfjs checks *before* it looks at
 * `workerSrc` — a static specifier webpack can see, bundle and resolve. This
 * test reproduces the lambda by pointing `workerSrc` at a path that cannot
 * exist and requiring extraction to work anyway.
 *
 * **This test must own its file.** pdfjs memoises the loaded worker on first
 * use, so any earlier PDF parse in the same module registry caches a worker
 * resolved from the real path and makes the assertion below vacuously true.
 * Vitest isolates module state per file, not per test, so a sibling case in
 * `extractor.test.ts` would not be isolated from the rest of that file.
 */

/** The smallest valid PDF containing `text` — no binary fixture to check in. */
function minimalPdf(text: string): Buffer {
  const stream = `BT /F1 24 Tf 20 100 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] " +
      "/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  // The cross-reference table is a list of byte offsets into everything above
  // it, so it is built after the objects and its own offset taken before it.
  // Each entry is exactly 20 bytes; the trailing space before the newline is
  // load-bearing, not a typo.
  const startxref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${startxref}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

/** Verbatim what the Vercel bundle produced, and nowhere a file can be. */
const UNRESOLVABLE_WORKER = "/var/task/.next/server/chunks/pdf.worker.mjs";

describe("PDF extraction without a resolvable worker file", () => {
  it("extracts text when workerSrc points at a file that does not exist", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = UNRESOLVABLE_WORKER;

    const result = await extractTextFromBuffer(
      minimalPdf("Hello AutoFlow"),
      "note.pdf",
    );

    expect(result.text).toContain("Hello AutoFlow");
    expect(result.pageCount).toBe(1);
    expect(result.mimeType).toBe("application/pdf");

    // A future change that repaired `workerSrc` instead of bypassing it would
    // pass everything above while the lambda kept failing, because there the
    // path is unrepairable. Pin that the extraction above never needed it.
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe(UNRESOLVABLE_WORKER);
    expect(existsSync(UNRESOLVABLE_WORKER)).toBe(false);
  });
});
