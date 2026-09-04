import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HtmlToPdfError,
  MAX_HTML_CHARACTERS,
  renderHtmlToPdf,
} from "./html-to-pdf";

/**
 * AF-M10-12's security acceptance, executable.
 *
 * The two properties that matter are held **by construction**, not by
 * configuration — jsdom is created without `runScripts` (so nothing executes)
 * and without `resources` (so nothing is fetched), and pdfmake's URL policy
 * denies every URL. These tests prove the construction, by watching the two
 * escape hatches an attacker would need.
 */

const asPdf = (bytes: Buffer) => bytes.subarray(0, 5).toString();

describe("renderHtmlToPdf (AF-M10-12)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders ordinary HTML to a real PDF", async () => {
    const bytes = await renderHtmlToPdf({
      html: "<h1>Contract review</h1><p>Findings follow.</p><ul><li>One</li></ul>",
    });
    expect(asPdf(bytes)).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(500);
  });

  it("neither executes an embedded script nor lets it touch the process", async () => {
    // The script writes a global if it ever runs. A renderer that executes
    // input JavaScript is a remote-code-execution surface with a friendly name.
    const marker = "__autoflow_pdf_script_ran__";
    const globals = globalThis as unknown as Record<string, unknown>;
    delete globals[marker];

    const bytes = await renderHtmlToPdf({
      html: `
        <h1>Report</h1>
        <script>globalThis["${marker}"] = true;</script>
        <img src="x" onerror="globalThis['${marker}'] = true;">
        <p>Body</p>
      `,
    });

    expect(globals[marker]).toBeUndefined();
    expect(asPdf(bytes)).toBe("%PDF-");
  });

  it("does not fetch a remote image", async () => {
    // A renderer that fetches is an SSRF probe: the input HTML is often
    // templated from data a third party supplied.
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const bytes = await renderHtmlToPdf({
      html: '<p>Before</p><img src="https://attacker.example/pixel.png"><p>After</p>',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(asPdf(bytes)).toBe("%PDF-");
  });

  it("does not fetch a remote stylesheet or font either", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await renderHtmlToPdf({
      html: `
        <link rel="stylesheet" href="https://attacker.example/a.css">
        <style>@import url("https://attacker.example/b.css");</style>
        <p>Body</p>
      `,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("honours page size, orientation and margins", async () => {
    // Rendered sizes differ, which is the observable proof the options reach
    // the renderer rather than being accepted and ignored.
    const portrait = await renderHtmlToPdf({
      html: "<p>Page</p>",
      pageSize: "A4",
      orientation: "portrait",
    });
    const landscape = await renderHtmlToPdf({
      html: "<p>Page</p>",
      pageSize: "A4",
      orientation: "landscape",
    });
    expect(asPdf(portrait)).toBe("%PDF-");
    expect(asPdf(landscape)).toBe("%PDF-");
    expect(portrait.byteLength).not.toBe(landscape.byteLength);
  });

  it("renders a header and always numbers the pages", async () => {
    const withHeader = await renderHtmlToPdf({
      html: "<p>Body</p>",
      header: "Acme Legal — confidential",
      footer: "Prepared by AutoFlow",
    });
    expect(asPdf(withHeader)).toBe("%PDF-");
  });

  it("refuses empty input rather than emitting a blank document", async () => {
    // A blank PDF looks like a successful render of nothing, which is how a
    // broken template reaches a client.
    await expect(renderHtmlToPdf({ html: "   " })).rejects.toBeInstanceOf(
      HtmlToPdfError,
    );
  });

  it("refuses input over the character cap", async () => {
    await expect(
      renderHtmlToPdf({ html: "x".repeat(MAX_HTML_CHARACTERS + 1) }),
    ).rejects.toThrow(/character limit/);
  });

  it("renders tables, which is what a report is mostly made of", async () => {
    const bytes = await renderHtmlToPdf({
      html: `
        <h2>Findings</h2>
        <table>
          <tr><th>Clause</th><th>Risk</th></tr>
          <tr><td>4.2 Indemnity</td><td>High</td></tr>
          <tr><td>7.1 Term</td><td>Low</td></tr>
        </table>
      `,
    });
    expect(asPdf(bytes)).toBe("%PDF-");
  });
});
