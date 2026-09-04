import "server-only";
import type { JSDOM } from "jsdom";
import type { TDocumentDefinitions } from "pdfmake/interfaces";

/** `pdfmake`'s server entry, as the default export of its module. */
type PdfMake = typeof import("pdfmake");

/**
 * HTML → PDF rendering (AF-M10-12).
 *
 * ## Renderer choice, and why it is not a headless browser
 *
 * The obvious implementation is Puppeteer or Playwright driving headless
 * Chrome, and it is rejected here for two reasons:
 *
 * 1. **Deployment.** Chromium is ~300 MB of binary that has to exist in the
 *    runtime image. This app deploys to Vercel, where it does not, so it would
 *    mean a second deployment target for one node. That is a platform decision,
 *    not an implementation detail, and it should not be made by a node.
 * 2. **Safety by construction.** The acceptance requires that rendering
 *    performs no network access and executes no JavaScript from the input
 *    document. With a browser those are *configuration* — request interception
 *    and a JS-disabled context — and a configuration mistake fails open, with
 *    the document fetching whatever it likes from inside our network.
 *
 * The stack used instead is `jsdom` → `html-to-pdfmake` → `pdfmake`
 * (~27 MB installed, pure JavaScript, no binaries):
 *
 * - **jsdom parses; it never executes.** `runScripts` is left at its default,
 *   which does not run inline or external scripts, and `resources` is left
 *   unset, which fetches nothing. A `<script>` in the input is parsed as an
 *   element and dropped.
 * - **pdfmake's access policies are set to deny.** `setUrlAccessPolicy` refuses
 *   every URL, so a remote `<img>` cannot be fetched; `setLocalAccessPolicy`
 *   allows only the fourteen PDF standard font names, so nothing else on the
 *   filesystem is reachable either. Both are process-wide and set once here.
 *
 * ## What it costs
 *
 * CSS support is what `html-to-pdfmake` supports: headings, paragraphs, lists,
 * tables, inline styles, basic text formatting. Floats, flexbox, grid and
 * page-break control are not honoured. That is adequate for a generated report
 * — the shape #28 needs — and not adequate for rendering an arbitrary web page.
 * The node's docs say so rather than letting a user discover it.
 */

/** The fourteen PDF standard fonts, the only local reads the renderer may make. */
const STANDARD_FONTS = new Set([
  "Courier",
  "Courier-Bold",
  "Courier-Oblique",
  "Courier-BoldOblique",
  "Helvetica",
  "Helvetica-Bold",
  "Helvetica-Oblique",
  "Helvetica-BoldOblique",
  "Times-Roman",
  "Times-Bold",
  "Times-Italic",
  "Times-BoldItalic",
  "Symbol",
  "ZapfDingbats",
]);

export const PAGE_SIZES = ["A4", "LETTER", "LEGAL", "A3", "A5"] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export const PAGE_ORIENTATIONS = ["portrait", "landscape"] as const;
export type PageOrientation = (typeof PAGE_ORIENTATIONS)[number];

/** Input HTML cap. Past this the parse itself is the cost, not the render. */
export const MAX_HTML_CHARACTERS = 2_000_000;

/** Output cap. A report past this is a bug upstream, not a document. */
export const MAX_PDF_BYTES = 25 * 1024 * 1024;

let configured = false;

/**
 * Apply the deny-by-default policies exactly once.
 *
 * `pdfmake`'s server entry is a singleton, so this is process-wide state. It
 * is set here rather than at import time so the reason lives next to the
 * policy, and it is idempotent so a second call cannot loosen it.
 */
function configureRenderer(pdfmake: PdfMake): void {
  if (configured) {
    return;
  }
  // No URL is ever fetched: not an image, not a font, not a stylesheet.
  pdfmake.setUrlAccessPolicy(() => false);
  // The only filesystem reads allowed are the bundled standard fonts.
  pdfmake.setLocalAccessPolicy((path: string) => STANDARD_FONTS.has(path));
  pdfmake.setFonts({
    Helvetica: {
      normal: "Helvetica",
      bold: "Helvetica-Bold",
      italics: "Helvetica-Oblique",
      bolditalics: "Helvetica-BoldOblique",
    },
    Times: {
      normal: "Times-Roman",
      bold: "Times-Bold",
      italics: "Times-Italic",
      bolditalics: "Times-BoldItalic",
    },
    Courier: {
      normal: "Courier",
      bold: "Courier-Bold",
      italics: "Courier-Oblique",
      bolditalics: "Courier-BoldOblique",
    },
  });
  configured = true;
}

/**
 * Elements that could only render by fetching or executing something.
 *
 * They are removed rather than relied on to fail: the pdfmake URL policy would
 * refuse the fetch, but refusing it aborts the whole render, so a single stray
 * remote `<img>` in an otherwise fine report would produce no document at all.
 * A report missing one decorative image is a far better outcome than no report.
 *
 * The deny policies stay as the backstop. This is the layer that makes the
 * common case pleasant; that is the layer that makes the bad case impossible.
 */
const UNRENDERABLE_SELECTORS = [
  "script",
  "noscript",
  "iframe",
  "frame",
  "object",
  "embed",
  "applet",
  "link",
  "meta",
  // Inline <style> can carry @import, and html-to-pdfmake reads inline `style`
  // attributes rather than stylesheets, so nothing of value is lost.
  "style",
  "base",
] as const;

/**
 * Strip everything unrenderable, and every image that is not already inline.
 *
 * Done on the parsed DOM rather than with a regex: a regex over HTML is a
 * bypass waiting to be written, and the parser is already here.
 */
function sanitizeHtml(html: string, dom: JSDOM): string {
  const doc = dom.window.document.implementation.createHTMLDocument("render");
  doc.body.innerHTML = html;

  for (const selector of UNRENDERABLE_SELECTORS) {
    for (const element of Array.from(doc.body.querySelectorAll(selector))) {
      element.remove();
    }
  }

  // Event-handler attributes cannot fire (nothing executes), but leaving them
  // in means the next person to read this has to work that out for themselves.
  for (const element of Array.from(doc.body.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.toLowerCase().startsWith("on")) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  // Only already-inline images survive; anything else needs a fetch.
  for (const image of Array.from(doc.body.querySelectorAll("img"))) {
    const src = image.getAttribute("src") ?? "";
    if (!src.toLowerCase().startsWith("data:image/")) {
      image.remove();
    }
  }

  return doc.body.innerHTML;
}

export interface HtmlToPdfOptions {
  html: string;
  pageSize?: PageSize;
  orientation?: PageOrientation;
  /** Margins in points, clockwise from the left. Defaults to 40 all round. */
  margins?: [number, number, number, number];
  /** Rendered at the top of every page. */
  header?: string;
  /** Rendered at the foot of every page, with the page number appended. */
  footer?: string;
  font?: "Helvetica" | "Times" | "Courier";
}

export class HtmlToPdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HtmlToPdfError";
  }
}

/**
 * Render HTML to PDF bytes.
 *
 * Throws `HtmlToPdfError` for anything the caller can fix — oversized input,
 * unparseable HTML, an oversized result — so a node can turn it into a
 * non-retriable failure rather than retrying a document that will not improve.
 */
export async function renderHtmlToPdf(
  options: HtmlToPdfOptions,
): Promise<Buffer> {
  const { html } = options;

  if (html.trim().length === 0) {
    throw new HtmlToPdfError(
      "the HTML resolved to nothing, so there is no document to render.",
    );
  }
  if (html.length > MAX_HTML_CHARACTERS) {
    throw new HtmlToPdfError(
      `the HTML is ${html.length} characters, over the ${MAX_HTML_CHARACTERS}-character limit.`,
    );
  }

  // Loaded here rather than at module scope, for the same reason `pdf-parse`
  // is: `src/nodes/registry.ts` imports every executor, so anything this file
  // imports is loaded by every page and every tRPC call, none of which render
  // a PDF. That is not merely wasteful - `jsdom` reaches
  // `html-encoding-sniffer`, a CommonJS package that `require()`s the ESM-only
  // `@exodus/bytes`. Those packages need Node ^20.19 || ^22.12 || >=24 (where
  // `require(esm)` works); on anything older it throws ERR_REQUIRE_ESM while
  // the module body evaluates, which took production down while every local
  // run on Node 24 stayed green.
  const [jsdomModule, pdfmakeModule, htmlToPdfmakeModule] = await Promise.all([
    import("jsdom"),
    import("pdfmake"),
    import("html-to-pdfmake"),
  ]);
  const { JSDOM } = jsdomModule;
  // `pdfmake` is CommonJS with named exports and no `default`, so under
  // interop the module object arrives either as the namespace itself or
  // under `default`, depending on who did the bundling.
  const pdfmake: PdfMake =
    (pdfmakeModule as { default?: PdfMake }).default ?? pdfmakeModule;
  const htmlToPdfmake = htmlToPdfmakeModule.default;

  configureRenderer(pdfmake);

  // Parses only. `runScripts` is not set, so no inline or external script
  // runs; `resources` is not set, so nothing is fetched. Both are jsdom's
  // defaults and both are the point — this is the "no JS, no network"
  // guarantee, held by construction rather than by configuration.
  const dom = new JSDOM("<!doctype html><html><body></body></html>");

  let content: unknown;
  try {
    content = htmlToPdfmake(sanitizeHtml(html, dom), {
      window: dom.window,
      imagesByReference: false,
    });
  } catch (error) {
    throw new HtmlToPdfError(
      `the HTML could not be converted: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    dom.window.close();
  }

  const font = options.font ?? "Helvetica";
  const document: TDocumentDefinitions = {
    pageSize: options.pageSize ?? "A4",
    pageOrientation: options.orientation ?? "portrait",
    pageMargins: options.margins ?? [40, 40, 40, 40],
    defaultStyle: { font, fontSize: 10, lineHeight: 1.3 },
    content: content as TDocumentDefinitions["content"],
  };

  if (options.header) {
    document.header = {
      text: options.header,
      margin: [40, 20, 40, 0],
      fontSize: 8,
      color: "#666666",
    };
  }

  // The page number is appended unconditionally: a multi-page legal document
  // with no page numbers is the kind of thing that gets noticed after it has
  // been sent.
  document.footer = (currentPage: number, pageCount: number) => ({
    columns: [
      { text: options.footer ?? "", fontSize: 8, color: "#666666" },
      {
        text: `${currentPage} / ${pageCount}`,
        alignment: "right",
        fontSize: 8,
        color: "#666666",
      },
    ],
    margin: [40, 0, 40, 20],
  });

  let buffer: Buffer;
  try {
    buffer = await pdfmake.createPdf(document).getBuffer();
  } catch (error) {
    throw new HtmlToPdfError(
      `the document could not be rendered: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (buffer.byteLength > MAX_PDF_BYTES) {
    throw new HtmlToPdfError(
      `the rendered PDF is ${buffer.byteLength} bytes, over the ${MAX_PDF_BYTES}-byte limit.`,
    );
  }

  return buffer;
}
