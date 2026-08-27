/**
 * Credential type definitions (AF-M3-02) — isomorphic, safe for the client
 * bundle. Mirror of the node SDK split (`definitions` vs `registry`):
 * this file carries metadata + form fields only; the server registry adds
 * validation (`credential-registry.ts`) and connection testers.
 *
 * Spec: docs/architecture/security.md §3, docs/decisions/0004.
 */

export const CREDENTIAL_KINDS = [
  "apiKey",
  "bearer",
  "basic",
  "header",
  "oauth2",
] as const;

export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

export interface CredentialSecretField {
  /** Key in the encrypted secret JSON object. */
  key: string;
  label: string;
  placeholder?: string;
  /** Secret material — stored only inside the encrypted envelope. */
  secret: boolean;
  /** False fields carry metadata like scopes / header names. */
  optional?: boolean;
}

export interface CredentialTypeDef {
  /** Registry id, persisted as `Credential.type`. Never rename saved rows. */
  type: string;
  /** Structural kind; drives which fields the secret object has. */
  kind: CredentialKind;
  label: string;
  description: string;
  /** Client-side form fields, in display order. One must be secret. */
  fields: CredentialSecretField[];
  /** Avatar used by the credentials list. */
  logo?: string;
  /** OAuth-type credential with expiry bookkeeping (`oauthExpiresAt`). */
  oauth?: boolean;
}

export const credentialKindLabel = (kind: CredentialKind): string => {
  switch (kind) {
    case "apiKey":
      return "API key";
    case "bearer":
      return "Bearer token";
    case "basic":
      return "Basic auth";
    case "header":
      return "Custom header";
    case "oauth2":
      return "OAuth 2.0";
  }
};

/**
 * Registered credential types. Provider-scoped ids (`openai.apiKey`) migrate
 * the pre-vault OPENAI/ANTHROPIC/GEMINI rows; the bare-kind ids are generic
 * (any API, any header, any OAuth provider).
 */
export const CREDENTIAL_TYPE_DEFINITIONS: CredentialTypeDef[] = [
  {
    type: "apiKey",
    kind: "apiKey",
    label: "API Key",
    description: "Generic API key for any service",
    logo: "/logos/logo.svg",
    fields: [
      { key: "apiKey", label: "API key", secret: true, placeholder: "sk-..." },
    ],
  },
  {
    type: "bearer",
    kind: "bearer",
    label: "Bearer token",
    description: "Single token sent as `Authorization: Bearer <token>`",
    logo: "/logos/logo.svg",
    fields: [{ key: "token", label: "Token", secret: true }],
  },
  {
    type: "basic",
    kind: "basic",
    label: "Username & password",
    description: "HTTP Basic auth credentials",
    logo: "/logos/logo.svg",
    fields: [
      { key: "username", label: "Username", secret: false },
      { key: "password", label: "Password", secret: true },
    ],
  },
  {
    type: "header",
    kind: "header",
    label: "Custom header",
    description: "A named header with its value (API-key-style auth)",
    logo: "/logos/logo.svg",
    fields: [
      {
        key: "name",
        label: "Header name",
        secret: false,
        placeholder: "X-API-Token",
      },
      { key: "value", label: "Header value", secret: true },
    ],
  },
  {
    type: "oauth2",
    kind: "oauth2",
    label: "OAuth 2.0",
    description: "Access token with optional refresh token and expiry",
    logo: "/logos/logo.svg",
    oauth: true,
    fields: [
      { key: "accessToken", label: "Access token", secret: true },
      {
        key: "refreshToken",
        label: "Refresh token",
        secret: true,
        optional: true,
      },
      {
        key: "scopes",
        label: "Scopes (space-separated)",
        secret: false,
        optional: true,
      },
    ],
  },
  {
    type: "openai.apiKey",
    kind: "apiKey",
    label: "OpenAI API key",
    description: "API key for api.openai.com (existing rows migrated)",
    logo: "/logos/openai.svg",
    fields: [
      { key: "apiKey", label: "API key", secret: true, placeholder: "sk-..." },
    ],
  },
  {
    type: "anthropic.apiKey",
    kind: "apiKey",
    label: "Anthropic API key",
    description: "API key for api.anthropic.com (existing rows migrated)",
    logo: "/logos/anthropic.svg",
    fields: [
      {
        key: "apiKey",
        label: "API key",
        secret: true,
        placeholder: "sk-ant-...",
      },
    ],
  },
  {
    type: "gemini.apiKey",
    kind: "apiKey",
    label: "Gemini API key",
    description: "API key for generativelanguage.googleapis.com",
    logo: "/logos/gemini.svg",
    fields: [{ key: "apiKey", label: "API key", secret: true }],
  },
];

export const credentialDefsById = new Map(
  CREDENTIAL_TYPE_DEFINITIONS.map((def) => [def.type, def]),
);

export const CREDENTIAL_TYPE_IDS = CREDENTIAL_TYPE_DEFINITIONS.map(
  (def) => def.type,
) as readonly string[];

/** Client-safe alias — components consume this, exactly like `manifest.ts`. */
export const credentialManifest = CREDENTIAL_TYPE_DEFINITIONS;

/**
 * Build the canonical secret object from validated form/router input.
 * Non-optional fields are required non-empty strings; optional fields are
 * dropped when empty so stale blanks never encrypt into the envelope.
 */
export function secretFromInput(
  def: CredentialTypeDef,
  input: Record<string, unknown>,
): Record<string, string> {
  const secret: Record<string, string> = {};
  for (const field of def.fields) {
    const raw = input[field.key];
    if (field.optional) {
      if (typeof raw === "string" && raw.length > 0 && raw.trim().length > 0) {
        secret[field.key] = raw;
      }
      continue;
    }
    if (typeof raw !== "string" || raw.length === 0) {
      throw new Error(
        `Credential "${def.type}": missing required field "${field.key}"`,
      );
    }
    secret[field.key] = raw;
  }
  return secret;
}

/** Write-time fragment, never a reversible form of the value. */
export function maskSecretValue(value: string, maxReveal = 4): string {
  if (value.length <= maxReveal * 2) {
    return "••••••••";
  }
  return `${value.slice(0, maxReveal)}••••••${value.slice(-maxReveal)}`;
}

/** Preview comes from the first secret field only (matches the form's order). */
export function computePreview(
  def: CredentialTypeDef,
  secret: Record<string, string>,
): string | null {
  const firstSecret = def.fields.find((field) => field.secret);
  if (!firstSecret) {
    return null;
  }
  const value = secret[firstSecret.key];
  return typeof value === "string" && value.length > 0
    ? maskSecretValue(value)
    : null;
}
