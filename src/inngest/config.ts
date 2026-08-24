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

export const truncateStack = (stack: string | undefined): string | null =>
  stack ? stack.slice(0, MAX_STACK_LENGTH) : null;
