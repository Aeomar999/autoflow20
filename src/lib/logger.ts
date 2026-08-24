/**
 * Structured logger with secret redaction (AF-M0-07).
 *
 * - Emits one JSON object per log line.
 * - Level from LOG_LEVEL, defaulting to `info` in production and `debug` elsewhere.
 * - Any key matching the sensitive pattern is replaced at any nesting depth,
 *   including inside arrays — use `redact()` directly for Sentry's `beforeSend`.
 */

export const REDACTED = "[REDACTED]";
export const MAX_LOG_DEPTH = 8;

const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|apikey|api_key|authorization|cookie|credential|private[_-]?key)/i;

export const isSensitiveKey = (key: string): boolean =>
  SENSITIVE_KEY_PATTERN.test(key);

export const redact = (value: unknown, depth = 0): unknown => {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (depth >= MAX_LOG_DEPTH) {
    return "[Truncated]";
  }

  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = isSensitiveKey(key) ? REDACTED : redact(item, depth + 1);
  }
  return output;
};

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const currentLevelOrder = (): number => {
  const configured = (process.env.LOG_LEVEL ?? "").toLowerCase();
  if (configured in LEVEL_ORDER) {
    return LEVEL_ORDER[configured as Level];
  }
  return process.env.NODE_ENV === "production"
    ? LEVEL_ORDER.info
    : LEVEL_ORDER.debug;
};

const sinks: Record<Level, (...args: unknown[]) => void> = {
  debug: (...args) => console.log(...args),
  info: (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

const serialize = (payload: Record<string, unknown>): string => {
  try {
    return JSON.stringify(payload);
  } catch {
    return JSON.stringify({
      level: "error",
      message: "Unserializable log payload dropped",
    });
  }
};

const emit = (
  level: Level,
  message: string,
  context?: Record<string, unknown>,
): void => {
  if (LEVEL_ORDER[level] < currentLevelOrder()) {
    return;
  }

  const payload: Record<string, unknown> = {
    level,
    time: new Date().toISOString(),
    message,
  };
  if (context !== undefined) {
    payload.context = redact(context);
  }

  sinks[level](serialize(payload));
};

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) =>
    emit("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) =>
    emit("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) =>
    emit("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) =>
    emit("error", message, context),
};
