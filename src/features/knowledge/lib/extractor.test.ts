import { describe, expect, it, vi } from "vitest";
import {
  ensureDomMatrix,
  extractTextFromBuffer,
  extractTextFromHtml,
  extractTextFromUrl,
  normalizeText,
} from "./extractor";

vi.mock("@/features/executions/components/http-request/egress-guard", () => ({
  assertSafeEndpoint: async (url: string) => new URL(url),
  safeFetch: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, init),
}));

describe("normalizeText", () => {
  it("trims and collapses excessive whitespace", () => {
    const input = "  Hello   world!  \n\n\n\n  New line   here.  ";
    const expected = "Hello world!\n\nNew line here.";
    expect(normalizeText(input)).toBe(expected);
  });
});

describe("extractTextFromHtml", () => {
  it("strips scripts, styles, and html tags and decodes entities", () => {
    const html = `
      <html>
        <head>
          <title>Test Page</title>
          <style>body { color: red; }</style>
          <script>console.log("bad");</script>
        </head>
        <body>
          <h1>Headline &amp; Title</h1>
          <p>This is a paragraph with <b>bold</b> text.</p>
        </body>
      </html>
    `;

    const extracted = extractTextFromHtml(html);
    expect(extracted).toContain("Headline & Title");
    expect(extracted).toContain("This is a paragraph with bold text.");
    expect(extracted).not.toContain("console.log");
    expect(extracted).not.toContain("color: red");
  });
});

describe("ensureDomMatrix", () => {
  /**
   * pdfjs needs a real `DOMMatrix`, and in the lambda it cannot get one:
   * it resolves `@napi-rs/canvas` through `createRequire(import.meta.url)`,
   * and webpack bakes the *build* machine's path into that, so the require is
   * rooted outside the deployed tree and finds nothing.
   *
   * `api/inngest/route.ts` used to paper over the resulting `ReferenceError`
   * with `globalThis.DOMMatrix = class DOMMatrix {}`. That stopped the crash
   * and left pdfjs holding a matrix that cannot transform anything, so this
   * pins the part that actually matters: what gets installed has to work.
   */
  it("installs a DOMMatrix that can actually transform", async () => {
    const globals = globalThis as { DOMMatrix?: unknown };
    const original = globals.DOMMatrix;
    globals.DOMMatrix = undefined;

    try {
      await ensureDomMatrix();

      const matrix = new globalThis.DOMMatrix()
        .translateSelf(2, 3)
        .scaleSelf(4);
      expect(matrix.e).toBe(2);
      expect(matrix.f).toBe(3);
      expect(matrix.a).toBe(4);
    } finally {
      globals.DOMMatrix = original;
    }
  });

  it("leaves an existing DOMMatrix alone", async () => {
    // The browser and any future Node that ships one are already correct;
    // replacing theirs would be the same overreach as the stub.
    const globals = globalThis as { DOMMatrix?: unknown };
    const original = globals.DOMMatrix;
    const sentinel = class DOMMatrix {};
    globals.DOMMatrix = sentinel;

    try {
      await ensureDomMatrix();
      expect(globals.DOMMatrix).toBe(sentinel);
    } finally {
      globals.DOMMatrix = original;
    }
  });
});

describe("extractTextFromBuffer", () => {
  it("extracts text from plain text and markdown buffers", async () => {
    const txtBuffer = Buffer.from("Simple plain text document content.");
    const result = await extractTextFromBuffer(txtBuffer, "readme.txt");
    expect(result.text).toBe("Simple plain text document content.");
    expect(result.mimeType).toBe("text/plain");

    const mdBuffer = Buffer.from("# Heading\n\n* item 1\n* item 2");
    const mdResult = await extractTextFromBuffer(mdBuffer, "guide.md");
    expect(mdResult.text).toContain("# Heading");
    expect(mdResult.mimeType).toBe("text/markdown");
  });
});

describe("extractTextFromUrl", () => {
  it("fetches URL safely and extracts title and clean text", async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Product Documentation</title></head>
        <body>
          <h1>Product Documentation</h1>
          <p>Welcome to our docs.</p>
        </body>
      </html>
    `;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => html,
    });

    const result = await extractTextFromUrl("https://example.com/docs");

    expect(result.title).toBe("Product Documentation");
    expect(result.text).toContain("Product Documentation");
    expect(result.text).toContain("Welcome to our docs.");
  });

  it("throws on HTTP errors", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    await expect(extractTextFromUrl("https://example.com/404")).rejects.toThrow(
      /HTTP 404/,
    );
  });
});
