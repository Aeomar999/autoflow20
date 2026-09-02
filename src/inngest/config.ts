/** Inngest accepts an integer retry count between 0 and 20. */
export type RetryCount =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20;

/**
 * Single retry policy for the workflow engine (AF-A-07).
 * Used identically in dev and production; override per environment with
 * ENGINE_RETRIES if you intentionally want fewer/more attempts locally.
 */
export const ENGINE_RETRIES: RetryCount = (() => {
  const override = Number.parseInt(process.env.ENGINE_RETRIES ?? "", 10);
  if (Number.isInteger(override) && override >= 0 && override <= 20) {
    return override as RetryCount;
  }
  return 3;
})();

/** Upper bound for stored stack traces so error rows stay bounded. */
export const MAX_STACK_LENGTH = 8_000;

/**
 * Upper bound (in bytes, UTF-8) for a node executor's returned payload, in
 * bytes of its JSON serialization. Exceeding it fails the node with a
 * NonRetriableError naming the node and the size, rather than letting the run
 * die opaquely on an Inngest state/step cap several nodes later.
 *
 * Rationale and provenance: ADR-0018. The value is provisional (derived from
 * Inngest's published 4 MiB per-step cap, not measured against a real account);
 * AF-M2-00 records how to close that. Change it here and every executor is
 * covered in one place.
 */
export const MAX_NODE_OUTPUT_BYTES = 1024 * 1024; // 1 MiB

export const truncateStack = (stack: string | undefined): string | null =>
  stack ? stack.slice(0, MAX_STACK_LENGTH) : null;

/**
 * Size in UTF-8 bytes of a node's JSON-serialized output. This is the working
 * measure for the node-output bound: the executor's return value is what
 * Inngest memoises and caps, so its serialized size is the number that matters.
 */
export const serializedBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value), "utf-8");

/** Whether a serialized output size exceeds MAX_NODE_OUTPUT_BYTES. */
export const nodeOutputIsOverLimit = (bytes: number): boolean =>
  bytes > MAX_NODE_OUTPUT_BYTES;
