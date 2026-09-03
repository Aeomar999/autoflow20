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
 * Security: the sandboxed program must NEVER observe a host-realm object.
 * Cross-realm leaks are the canonical `node:vm` escape — a host object carries
 * its `constructor` chain back to the worker thread's `Function`, so
 * `x.constructor.constructor("return process")()` yields the worker's `process`
 * (full env, filesystem, arbitrary commands). To avoid this the input is passed
 * to the worker as a JSON string and materialized (`JSON.parse`) INSIDE the vm
 * context, so the user's code only ever reaches vm-realm objects whose
 * intrinsics cannot name the host. See `execute.test.ts`'s adversarial escape
 * cases.
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
 * with no host bindings, materializes the input INSIDE the vm realm (see the
 * module doc for why — host-realm injection is the vm escape), executes it,
 * and posts either `{ ok:true, value }` or
 * `{ ok:false, message, userLineNumber }`.
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
  `    const context = vm.createContext({});`,
  // Materialize the input in the vm realm. workerData.inputJson is a JSON
  // string; evaluating the literal inside the context produces a graph of
  // vm-realm objects, so `input.constructor` is the vm's Object, not the
  // worker's — closing the cross-realm escape.
  `    const input = vm.runInContext("(" + workerData.inputJson + ")", context);`,
  `    const script = new vm.Script(PREFIX + workerData.code + "\\n}", { filename: "code.js" });`,
  `    const fn = script.runInContext(context);`,
  `    const value = await fn(input);`,
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
 * `input` is serialized to JSON before crossing into the worker so the vm
 * context can rebuild it in its own realm (no host-realm reference leaks into
 * the sandbox — see the module doc). A value that cannot be serialized (e.g. a
 * BigInt or a cyclic graph, which a correct upstream node never produces) fails
 * loudly rather than being silently dropped.
 *
 * @throws {CodeExecutionError} for any user-code failure, timeout, heap
 *   breach, or output-cap breach — every one names the limit that was hit.
 */
export function runUserCode(
  code: string,
  input: unknown,
  caps: CodeCaps,
): Promise<unknown> {
  let inputJson: string;
  try {
    inputJson = JSON.stringify(input);
  } catch {
    throw new CodeExecutionError(
      "Code node: the node input contains a value that cannot be serialized (BigInt or a circular reference)",
    );
  }

  return new Promise<unknown>((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      resourceLimits: {
        maxOldGenerationSizeMb: caps.heapMb,
        maxYoungGenerationSizeMb: Math.max(16, Math.round(caps.heapMb / 4)),
      },
      workerData: {
        code,
        // A string, so the vm context materializes it in its own realm.
        inputJson,
      },
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
