import "server-only";
import { Worker } from "node:worker_threads";
import {
  CODE_HEAP_CEILING_MB,
  CODE_HEAP_DEFAULT_MB,
  CODE_OUTPUT_CEILING_BYTES,
  CODE_OUTPUT_DEFAULT_BYTES,
  CODE_WALL_CLOCK_CEILING_MS,
  CODE_WALL_CLOCK_DEFAULT_MS,
} from "./definition";

/**
 * Sandboxed user-code runner for the CODE node (AF-M9-13, ADR-0020).
 *
 * The main thread never executes user code. It spawns a dedicated Worker whose
 * only job is to run the code inside a `node:vm` context (hard `resourceLimits`)
 * and return a structured-cloned value. The vm context is a fresh realm with
 * the standard intrinsics and no host bindings — no `require`/`import`/
 * `process`/`fetch`/timers/filesystem/network, and no reachable parent
 * `Object.prototype`.
 *
 * Every cap breach is a loud error naming the limit; there is no silent
 * truncation anywhere.
 */

export interface CodeCaps {
  wallClockMs: number;
  heapMb: number;
  outputBytes: number;
}

export class CodeExecutionError extends Error {
  readonly userLineNumber?: number;
  constructor(message: string, userLineNumber?: number) {
    super(message);
    this.name = "CodeExecutionError";
    this.userLineNumber = userLineNumber;
  }
}

interface SandboxOk {
  ok: true;
  value: unknown;
}

interface SandboxErr {
  ok: false;
  message: string;
  /** 1-based line number within the USER'S code body, if parseable. */
  userLineNumber?: number;
}

/**
 * Resolve the sandbox caps from a node's config, clamped to their declared
 * ceilings. Absent values take the defaults. Values are re-clamped defensively
 * even though `configSchema` already bounds them.
 */
export function resolveCaps(caps?: Partial<CodeCaps>): CodeCaps {
  const wallClockMs = Math.min(
    CODE_WALL_CLOCK_CEILING_MS,
    Math.max(1, caps?.wallClockMs ?? CODE_WALL_CLOCK_DEFAULT_MS),
  );
  const heapMb = Math.min(
    CODE_HEAP_CEILING_MB,
    Math.max(1, caps?.heapMb ?? CODE_HEAP_DEFAULT_MB),
  );
  const outputBytes = Math.min(
    CODE_OUTPUT_CEILING_BYTES,
    Math.max(1024, caps?.outputBytes ?? CODE_OUTPUT_DEFAULT_BYTES),
  );
  return { wallClockMs, heapMb, outputBytes };
}

/**
 * The inline Worker source. Runs entirely in the worker thread. It wraps the
 * user's body as `(async function(input){ … })`, creates a fresh vm context
 * with no host bindings (only `input` injected), executes it, and posts either
 * `{ ok:true, value }` or `{ ok:false, message, userLineNumber }`.
 *
 * The user's body is passed via `workerData` (not string-inlined), so this
 * template is static and `PREFIX_LINES` is computable here once. The wrapper
 * function occupies line 1; the user's body starts on line 2, so a thrown
 * error's `code.js:N` line is rebased to `N - 1`.
 */
const WORKER_SOURCE = [
  `"use strict";`,
  `const vm = require("node:vm");`,
  `const { workerData, parentPort } = require("node:worker_threads");`,
  `const PREFIX = "(input) => {\\n";`,
  `(async () => {`,
  `  try {`,
  `    const script = new vm.Script(PREFIX + workerData.code + "\\n}", { filename: "code.js" });`,
  `    const context = vm.createContext({ input: workerData.input });`,
  `    const fn = script.runInContext(context);`,
  `    const value = await fn(context.input);`,
  `    parentPort.postMessage({ ok: true, value });`,
  `  } catch (err) {`,
  `    const e = err instanceof Error ? err : new Error(String(err));`,
  `    const match = /code\\.js:(\\d+)/.exec(e.stack || e.message || "");`,
  `    const rawLine = match ? Number(match[1]) : undefined;`,
  `    const userLineNumber = rawLine ? Math.max(1, rawLine - 1) : undefined;`,
  `    parentPort.postMessage({ ok: false, message: e.message, userLineNumber });`,
  `  }`,
  `})();`,
].join("\n");

/**
 * Run user code to completion inside the sandboxed Worker.
 *
 * @throws {CodeExecutionError} for any user-code failure, timeout, heap
 *   breach, or output-cap breach — every one names the limit that was hit.
 */
export function runUserCode(
  code: string,
  input: unknown,
  caps: CodeCaps,
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      resourceLimits: {
        maxOldGenerationSizeMb: caps.heapMb,
        maxYoungGenerationSizeMb: Math.max(16, Math.round(caps.heapMb / 4)),
      },
      workerData: { code, input },
    });

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate().catch(() => undefined);
      reject(
        new CodeExecutionError(
          `Code execution exceeded the ${caps.wallClockMs.toLocaleString()}ms wall-clock limit`,
        ),
      );
    }, caps.wallClockMs);

    worker.on("message", (msg: SandboxOk | SandboxErr) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!msg.ok) {
        worker.terminate().catch(() => undefined);
        reject(new CodeExecutionError(msg.message, msg.userLineNumber));
        return;
      }
      const size = estimateJsonSize(msg.value);
      if (size > caps.outputBytes) {
        worker.terminate().catch(() => undefined);
        reject(
          new CodeExecutionError(
            `Code execution exceeded the ${caps.outputBytes.toLocaleString()}-byte output limit`,
          ),
        );
        return;
      }
      worker.terminate().catch(() => undefined);
      resolve(msg.value);
    });

    worker.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const text = (err && err.message) || String(err);
      const isHeap = /heap|memory|allocation failed|out of memory/i.test(text);
      reject(
        new CodeExecutionError(
          isHeap
            ? `Code execution exceeded the ${caps.heapMb}MB heap limit`
            : `Code execution failed: ${text}`,
        ),
      );
    });

    worker.on("exit", (code) => {
      // A worker that exits without a message (e.g. killed by the heap limit)
      // must not resolve silently.
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new CodeExecutionError(
          `Code execution exited unexpectedly (code ${code})`,
        ),
      );
    });
  });
}

/**
 * Size a structured-clone-able value as its UTF-8 JSON byte length. Used to
 * enforce the output cap on the main thread before the value reaches the
 * engine. `undefined` counts as 0 because it cannot be a node result anyway.
 */
function estimateJsonSize(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const s = JSON.stringify(value);
  return s ? Buffer.byteLength(s, "utf8") : 0;
}
