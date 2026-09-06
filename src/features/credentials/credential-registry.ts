import "server-only";
import nodemailer from "nodemailer";
import { Client as PgClient } from "pg";
import {
  assertSafeEndpoint,
  safeFetch,
} from "@/features/executions/components/http-request/egress-guard";
import { serviceEndpoint } from "@/lib/server/service-endpoints";
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

/**
 * A connection test against a host the *user* supplied — a self-hosted WAHA
 * instance, a Shopify shop domain, a Jira site (AF-M10-02).
 *
 * `checkAuth` calls `fetch` directly, which is fine for a fixed provider host
 * baked into this file. It is not fine for a URL out of a credential: that URL
 * is attacker-controllable input reaching a server-side fetch, and
 * `http://169.254.169.254/...` in a "Base URL" field would make the
 * connection-test button an SSRF probe. Everything user-supplied goes through
 * the same egress guard the HTTP node uses — blocklist, DNS pinning, redirect
 * re-vetting (ADR-0015, ADR-0017).
 */
async function checkGuardedAuth(
  rawUrl: string,
  headers: Record<string, string>,
): Promise<CredentialTestResult> {
  let url: URL;
  try {
    url = await assertSafeEndpoint(rawUrl);
  } catch {
    // A blocked or unparseable host is a connection problem from the user's
    // point of view; the specific reason is deliberately not echoed back, so
    // the test cannot be used to map the internal network.
    return { ok: false, error: "CONNECTION" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await safeFetch(url, {
      headers,
      signal: controller.signal,
    });
    if (response.ok) {
      return { ok: true };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: "AUTH" };
    }
    return { ok: false, error: "CONNECTION" };
  } catch {
    if (controller.signal.aborted) {
      return { ok: false, error: "TIMEOUT" };
    }
    return { ok: false, error: "CONNECTION" };
  } finally {
    clearTimeout(timer);
  }
}

/** Strip a trailing slash so `${base}/api/x` never becomes `//api/x`. */
const trimBase = (value: string): string => value.replace(/\/+$/, "");

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
  "groq.apiKey": async (secret) => {
    const key = secret.apiKey;
    if (!key) {
      return { ok: false, error: "AUTH" };
    }
    return checkAuth("https://api.groq.com/openai/v1/models", {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    });
  },
  "deepseek.apiKey": async (secret) => {
    const key = secret.apiKey;
    if (!key) {
      return { ok: false, error: "AUTH" };
    }
    return checkAuth("https://api.deepseek.com/models", {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    });
  },
  // --- AF-M10-02: the automation library's services -------------------------
  "apify.apiKey": async (secret) => {
    const key = secret.apiKey;
    if (!key) {
      return { ok: false, error: "AUTH" };
    }
    return checkAuth("https://api.apify.com/v2/users/me", {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    });
  },
  "stripe.apiKey": async (secret) => {
    const key = secret.apiKey;
    if (!key) {
      return { ok: false, error: "AUTH" };
    }
    // The cheapest authenticated read Stripe offers: it returns the account
    // the key belongs to and costs nothing.
    return checkAuth("https://api.stripe.com/v1/balance", {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    });
  },
  "apollo.apiKey": async (secret) => {
    const key = secret.apiKey;
    if (!key) {
      return { ok: false, error: "AUTH" };
    }
    return checkAuth("https://api.apollo.io/v1/auth/health", {
      "X-Api-Key": key,
      Accept: "application/json",
    });
  },
  "mailerlite.apiKey": async (secret) => {
    const key = secret.apiKey;
    if (!key) {
      return { ok: false, error: "AUTH" };
    }
    return checkAuth("https://connect.mailerlite.com/api/subscribers?limit=1", {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    });
  },
  "pinecone.apiKey": async (secret) => {
    const key = secret.apiKey;
    if (!key) {
      return { ok: false, error: "AUTH" };
    }
    return checkAuth("https://api.pinecone.io/indexes", {
      "Api-Key": key,
      "X-Pinecone-API-Version": "2025-01",
      Accept: "application/json",
    });
  },
  "openrouter.apiKey": async (secret) => {
    const key = secret.apiKey;
    if (!key) {
      return { ok: false, error: "AUTH" };
    }
    return checkAuth("https://openrouter.ai/api/v1/key", {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    });
  },
  "creatomate.apiKey": async (secret) => {
    const key = secret.apiKey;
    if (!key) {
      return { ok: false, error: "AUTH" };
    }
    return checkAuth("https://api.creatomate.com/v1/renders?limit=1", {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    });
  },
  "telegram.botToken": async (secret) => {
    const token = secret.botToken;
    if (!token) {
      return { ok: false, error: "AUTH" };
    }
    // Telegram puts the token in the path, not a header — that is the API's
    // shape, not a shortcut. `getMe` is the cheapest call it offers.
    return checkAuth(
      `https://api.telegram.org/bot${encodeURIComponent(token)}/getMe`,
      { Accept: "application/json" },
    );
  },
  "uploadPost.apiKey": async (secret) => {
    const key = secret.apiKey;
    if (!key) {
      return { ok: false, error: "AUTH" };
    }
    return checkAuth("https://api.upload-post.com/api/uploadposts/users", {
      Authorization: `ApiKey ${key}`,
      Accept: "application/json",
    });
  },
  "waha.apiKey": async (secret) => {
    const key = secret.apiKey;
    const baseUrl = secret.baseUrl;
    if (!key || !baseUrl) {
      return { ok: false, error: "AUTH" };
    }
    return checkGuardedAuth(`${trimBase(baseUrl)}/api/sessions`, {
      "X-Api-Key": key,
      Accept: "application/json",
    });
  },
  "shopify.accessToken": async (secret) => {
    const token = secret.accessToken;
    const shopDomain = secret.shopDomain;
    if (!token || !shopDomain) {
      return { ok: false, error: "AUTH" };
    }
    const host = shopDomain.includes("://")
      ? trimBase(shopDomain)
      : `https://${trimBase(shopDomain)}`;
    return checkGuardedAuth(`${host}/admin/api/2025-01/shop.json`, {
      "X-Shopify-Access-Token": token,
      Accept: "application/json",
    });
  },
  "jira.apiToken": async (secret) => {
    const email = secret.email;
    const token = secret.apiToken;
    const siteUrl = secret.siteUrl;
    if (!email || !token || !siteUrl) {
      return { ok: false, error: "AUTH" };
    }
    const encoded = Buffer.from(`${email}:${token}`).toString("base64");
    return checkGuardedAuth(`${trimBase(siteUrl)}/rest/api/3/myself`, {
      Authorization: `Basic ${encoded}`,
      Accept: "application/json",
    });
  },
  // --- AF-M11-10: HR systems ------------------------------------------------
  "bamboohr.apiKey": async (secret) => {
    const key = secret.apiKey;
    const companyDomain = secret.companyDomain;
    if (!key || !companyDomain) {
      return { ok: false, error: "AUTH" };
    }
    // The domain is a PATH segment on a fixed host, but a value like
    // "acme/../..@evil.example" would re-point the URL's authority, so it is
    // charset-checked here and the request still goes through the egress
    // guard. BambooHR subdomains are alphanumerics and hyphens.
    if (!/^[A-Za-z0-9-]{1,64}$/.test(companyDomain)) {
      return { ok: false, error: "CONNECTION" };
    }
    // BambooHR authenticates as Basic <apiKey>:<anything>; "x" is the value
    // their own documentation uses for the unused password half.
    const encoded = Buffer.from(`${key}:x`).toString("base64");
    return checkGuardedAuth(
      `${serviceEndpoint("bamboohr")}/${companyDomain}/v1/meta/fields`,
      { Authorization: `Basic ${encoded}`, Accept: "application/json" },
    );
  },
  "greenhouse.apiKey": async (secret) => {
    const key = secret.apiKey;
    if (!key) {
      return { ok: false, error: "AUTH" };
    }
    // Harvest is Basic auth with the key as the username and no password.
    const encoded = Buffer.from(`${key}:`).toString("base64");
    return checkAuth(`${serviceEndpoint("greenhouse")}/users?per_page=1`, {
      Authorization: `Basic ${encoded}`,
      Accept: "application/json",
    });
  },
  "lever.apiKey": async (secret) => {
    const key = secret.apiKey;
    if (!key) {
      return { ok: false, error: "AUTH" };
    }
    const encoded = Buffer.from(`${key}:`).toString("base64");
    return checkAuth(`${serviceEndpoint("lever")}/opportunities?limit=1`, {
      Authorization: `Basic ${encoded}`,
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
