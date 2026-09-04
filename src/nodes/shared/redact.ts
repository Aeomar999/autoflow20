/**
 * Output redaction for node executors (AF-M10-01).
 *
 * AF-M3-04 keeps the resolved credential map out of `context`, `output` and
 * the trace, which is enough while a secret only travels *outbound*. Once a
 * node authenticates a request, the secret can come back: an API that echoes
 * request headers (or a misconfigured endpoint pointed at a debug service)
 * puts the token in the response body, which the executor then returns as its
 * output and the engine persists into `NodeExecution.output`.
 *
 * So the invariant "plaintext never reaches the trace" needs one more step:
 * scrub the values this node actually sent from the value it returns.
 *
 * Isomorphic on purpose — the same helper is used by tests and by any future
 * client-side preview of a node's output.
 */

export const REDACTED = "[redacted]";

/**
 * Values shorter than this are not searched for. A two-character "secret"
 * would match everywhere and turn a response into confetti; anything that
 * short is not a credential worth protecting, and blanking real data would be
 * a worse failure than leaving it.
 */
const MIN_REDACTABLE_LENGTH = 6;

/**
 * Replace every occurrence of each secret with `[redacted]`, walking the whole
 * structure. Strings are searched for substrings; object keys are walked but
 * never rewritten (a key is a field name, not a value).
 *
 * Returns the input unchanged when there is nothing to redact, so the common
 * path (`authMode: "none"`) costs one array check.
 */
export function redactSecrets<T>(value: T, secrets: readonly string[]): T {
  const targets = secrets.filter(
    (secret) =>
      typeof secret === "string" && secret.length >= MIN_REDACTABLE_LENGTH,
  );
  if (targets.length === 0) {
    return value;
  }
  // Longest first: redacting a token before its own prefix means a secret that
  // contains another secret does not leave a half-scrubbed tail behind.
  targets.sort((a, b) => b.length - a.length);
  return walk(value, targets) as T;
}

function walk(value: unknown, targets: readonly string[]): unknown {
  if (typeof value === "string") {
    return redactString(value, targets);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => walk(entry, targets));
  }
  if (value !== null && typeof value === "object") {
    // Non-plain objects (Date, Buffer, class instances) are returned as-is:
    // rebuilding them from entries would silently change their type, and a
    // secret does not survive JSON serialization inside one anyway.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return value;
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = walk(entry, targets);
    }
    return out;
  }
  return value;
}

function redactString(value: string, targets: readonly string[]): string {
  let out = value;
  for (const target of targets) {
    if (out.includes(target)) {
      out = out.split(target).join(REDACTED);
    }
  }
  return out;
}
