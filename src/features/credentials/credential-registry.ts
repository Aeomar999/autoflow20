import "server-only";
import nodemailer from "nodemailer";
import { Client as PgClient } from "pg";
import {
  CREDENTIAL_KINDS,
  CREDENTIAL_TYPE_DEFINITIONS,
  type CredentialKind,
  type CredentialTypeDef,
} from "./credential-types";

/**
 * Server-side credential registry (AF-M3-02). Mirrors `src/nodes/registry.ts`:
 * malformed definitions and duplicate ids fail at construction, and the def's
 * `fields` array is the ONLY shape a secret object may take (input schema is
 * generated from it in the router, so no history of the schema can diverge).
 * Client-safe metadata lives in `credential-types.ts`; this file adds
 * validation and connection testers.
 *
 * Spec: docs/architecture/security.md §3, docs/decisions/0008.
 */

export type CredentialTestError =
  | "AUTH"
  | "CONNECTION"
  | "TIMEOUT"
  | "NOT_TESTABLE";

export type CredentialTestResult =
  | { ok: true }
  | { ok: false; error: CredentialTestError };

export type CredentialTester = (
  secret: Record<string, string | undefined>,
) => Promise<CredentialTestResult>;

export class UnknownCredentialTypeError extends Error {
  constructor(type: string, known: string[]) {
    super(
      `Unknown credential type: "${type}". Registered types: ${known.join(", ")}`,
    );
    this.name = "UnknownCredentialTypeError";
  }
}

export interface CredentialRegistry {
  resolve: (type: string) => CredentialTypeDef;
  has: (type: string) => boolean;
  list: () => CredentialTypeDef[];
  /** @throws if no tester is registered for the type */
  tester: (type: string) => CredentialTester;
  isTestable: (type: string) => boolean;
}

function validateDefinition(def: CredentialTypeDef): void {
  const where = `credential "${def?.type ?? "<missing type>"}"`;

  if (typeof def.type !== "string" || def.type.length === 0) {
    throw new Error(`${where}: "type" must be a non-empty string`);
  }
  if (!CREDENTIAL_KINDS.includes(def.kind as CredentialKind)) {
    throw new Error(`${where}: invalid kind "${String(def.kind)}"`);
  }
  if (typeof def.label !== "string" || def.label.length === 0) {
    throw new Error(`${where}: "label" is required`);
  }
  if (typeof def.description !== "string" || def.description.length === 0) {
    throw new Error(`${where}: "description" is required`);
  }
  if (!Array.isArray(def.fields) || def.fields.length === 0) {
    throw new Error(`${where}: "fields" must be a non-empty array`);
  }
  const keys = new Set<string>();
  let hasSecret = false;
  for (const field of def.fields) {
    if (typeof field.key !== "string" || field.key.length === 0) {
      throw new Error(`${where}: field "key" must be a non-empty string`);
    }
    if (keys.has(field.key)) {
      throw new Error(
        `${where}: duplicate field key "${field.key}" in "fields"`,
      );
    }
    keys.add(field.key);
    if (typeof field.label !== "string" || field.label.length === 0) {
      throw new Error(`${where}: field "${field.key}" needs a "label"`);
    }
    if (field.secret) {
      hasSecret = true;
    }
  }
  if (!hasSecret) {
    throw new Error(`${where}: at least one field must be secret material`);
  }
}

export function createCredentialRegistry(
  definitions: CredentialTypeDef[],
  testers: Record<string, CredentialTester> = {},
): CredentialRegistry {
  const byType = new Map<string, CredentialTypeDef>();

  for (const def of definitions) {
    validateDefinition(def);
    if (byType.has(def.type)) {
      throw new Error(
        `Duplicate credential type: "${def.type}" is registered more than once`,
      );
    }
    byType.set(def.type, def);
  }

  for (const type of Object.keys(testers)) {
    if (!byType.has(type)) {
      throw new Error(
        `Tester registered for unknown credential type "${type}"`,
      );
    }
  }

  return {
    resolve(type: string): CredentialTypeDef {
      const def = byType.get(type);
      if (!def) {
        throw new UnknownCredentialTypeError(type, [...byType.keys()]);
      }
      return def;
    },
    has: (type: string) => byType.has(type),
    list: () => [...byType.values()],
    tester(type: string): CredentialTester {
      const tester = testers[type];
      if (!tester) {
        throw new UnknownCredentialTypeError(
          `tester for "${type}"`,
          [...byType.keys()].filter((t) => t in testers),
        );
      }
      return tester;
    },
    isTestable: (type: string) => type in testers,
  };
}

const TIMEOUT_MS = 10_000;

/**
 * Race a promise against a timeout. The losing promise gets a rejection
 * guard so a slow network op can never surface as an unhandled rejection
 * after the timeout already won.
 */
async function runWithTimeout<T>(
  promise: Promise<T>,
  ms: number = TIMEOUT_MS,
): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guarded = promise.catch(() => undefined as T);
  const timeout = new Promise<T | "timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  try {
    return await Promise.race([guarded, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function classifySmtpError(error: unknown): CredentialTestResult {
  if (error instanceof Error) {
    const code = (error as { code?: string }).code;
    if (code === "EAUTH" || code === "EENVELOPE") {
      return { ok: false, error: "AUTH" };
    }
    const message = error.message.toLowerCase();
    if (message.includes("timeout") || message.includes("timed out")) {
      return { ok: false, error: "TIMEOUT" };
    }
  }
  return { ok: false, error: "CONNECTION" };
}

function classifyPgError(error: unknown): CredentialTestResult {
  if (error instanceof Error) {
    const code = (error as { code?: string }).code;
    // 28P01 = invalid_password, 28000 = invalid_authorization_specification
    if (code === "28P01" || code === "28000") {
      return { ok: false, error: "AUTH" };
    }
    const message = error.message.toLowerCase();
    if (message.includes("timeout") || message.includes("timed out")) {
      return { ok: false, error: "TIMEOUT" };
    }
  }
  return { ok: false, error: "CONNECTION" };
}

async function checkAuth(
  url: string,
  headers: Record<string, string>,
): Promise<CredentialTestResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (response.ok) {
      return { ok: true };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: "AUTH" };
    }
    return { ok: false, error: "CONNECTION" };
  } catch (_error) {
    if (controller.signal.aborted) {
      return { ok: false, error: "TIMEOUT" };
    }
    return { ok: false, error: "CONNECTION" };
  } finally {
    clearTimeout(timer);
  }
}

export const credentialTesters: Record<string, CredentialTester> = {
  "openai.apiKey": async (secret) => {
    const key = secret.apiKey;
    if (!key) {
      return { ok: false, error: "AUTH" };
    }
    return checkAuth("https://api.openai.com/v1/models", {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    });
  },
  "anthropic.apiKey": async (secret) => {
    const key = secret.apiKey;
    if (!key) {
      return { ok: false, error: "AUTH" };
    }
    return checkAuth("https://api.anthropic.com/v1/models", {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      Accept: "application/json",
    });
  },
  "gemini.apiKey": async (secret) => {
    const key = secret.apiKey;
    if (!key) {
      return { ok: false, error: "AUTH" };
    }
    const url = new URL(
      "https://generativelanguage.googleapis.com/v1beta/models",
    );
    url.searchParams.set("key", key);
    return checkAuth(url.toString(), { Accept: "application/json" });
  },
  "airtable.apiKey": async (secret) => {
    const key = secret.apiKey;
    if (!key) {
      return { ok: false, error: "AUTH" };
    }
    return checkAuth("https://api.airtable.com/v0/meta/whoami", {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    });
  },
  "hubspot.apiKey": async (secret) => {
    const key = secret.apiKey;
    if (!key) {
      return { ok: false, error: "AUTH" };
    }
    return checkAuth("https://api.hubapi.com/crm/v3/objects/contacts?limit=1", {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    });
  },
  postgres: async (secret) => {
    const host = secret.host;
    const database = secret.database;
    const username = secret.username;
    const password = secret.password;
    if (!host || !database || !username || !password) {
      return { ok: false, error: "AUTH" };
    }
    const client = new PgClient({
      host,
      port: Number(secret.port ?? 5432),
      database,
      user: username,
      password,
      ssl: secret.ssl === "require" ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: TIMEOUT_MS,
    });
    try {
      const outcome = await runWithTimeout(client.connect());
      if (outcome === "timeout") {
        return { ok: false, error: "TIMEOUT" };
      }
      return { ok: true };
    } catch (error) {
      return classifyPgError(error);
    } finally {
      try {
        await client.end();
      } catch {
        // Cleanup only — the test outcome is already decided above.
      }
    }
  },
  smtp: async (secret) => {
    const host = secret.host;
    const username = secret.username;
    const password = secret.password;
    if (!host || !username || !password) {
      return { ok: false, error: "AUTH" };
    }
    const tlsMode = secret.tls ?? "starttls";
    const transport = nodemailer.createTransport({
      host,
      port: Number(secret.port ?? 587),
      secure: tlsMode === "ssl",
      auth: { user: username, pass: password },
      requireTLS: tlsMode === "starttls",
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });
    try {
      const outcome = await runWithTimeout(transport.verify());
      if (outcome === "timeout") {
        return { ok: false, error: "TIMEOUT" };
      }
      return outcome === true
        ? { ok: true }
        : { ok: false, error: "CONNECTION" };
    } catch (error) {
      return classifySmtpError(error);
    }
  },
};

export const credentialRegistry = createCredentialRegistry(
  CREDENTIAL_TYPE_DEFINITIONS,
  credentialTesters,
);

export const getCredentialDefinition = (type: string): CredentialTypeDef =>
  credentialRegistry.resolve(type);

// Re-exported for server consumers; the implementations live in the
// isomorphic module so client components and the data-migration script (both
// of which must not reach `server-only`) can share them.
export {
  computePreview,
  maskSecretValue,
  secretFromInput,
} from "./credential-types";
