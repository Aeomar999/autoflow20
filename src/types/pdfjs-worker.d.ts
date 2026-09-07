/**
 * pdfjs publishes its worker as a built bundle with no declaration file beside
 * it, so importing it directly is otherwise an error under `strict`.
 *
 * The extractor imports this module for its side effect on `globalThis`, not
 * for anything it exports — see `src/features/knowledge/lib/extractor.ts` and
 * the failure recorded in `extractor.pdf-worker.test.ts`.
 */
declare module "pdfjs-dist/legacy/build/pdf.worker.min.mjs" {
  /**
   * pdfjs's in-process message handler. Only pdfjs itself ever calls it, and
   * it reads it back off `globalThis.pdfjsWorker` rather than from this
   * export, so the shape is deliberately left opaque.
   */
  export const WorkerMessageHandler: unknown;
}
