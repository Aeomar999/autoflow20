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

export interface CredentialDeprecation {
  /** ISO date the type stopped being offered. */
  since: string;
  /** `type` of the credential type that supersedes it. */
  replacedBy: string;
  /** One line telling the user what to connect instead. */
  reason: string;
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
  /**
   * Retirement marker (AF-M10-03), mirroring `NodeDefinition.deprecated` and
   * the ADR-0011 rule it encodes: a deprecated type stays registered,
   * resolvable and refreshable — saved workflows hold credentials of it by id
   * and must keep running — but disappears from the "new credential" picker,
   * so its population can only shrink.
   */
  deprecated?: CredentialDeprecation;
  /** True when a server-side connection tester exists for this type. */
  testable?: boolean;
  /**
   * (AF-M10-02) Why this type has no connection tester. Required on every
   * def without one — `credential-registry.test.ts` enforces it.
   *
   * The rule exists because "untested" and "untestable" look identical in a
   * registry: a type nobody got around to wiring and a type whose provider
   * has no cheap authenticated GET both simply lack a tester. Stating the
   * reason turns the second into a decision and leaves the first failing CI.
   */
  notTestableReason?: string;
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
/**
 * The scoped Google credential types (AF-M10-03; YouTube added in AF-M10-22). Every OAuth credential
 * has the same three fields, so they are generated rather than copied — the
 * only thing that differs is the service, and that difference lives in
 * `oauth-providers.ts` as the scope set.
 */
const googleServiceCredential = (
  type: string,
  label: string,
  description: string,
): CredentialTypeDef => ({
  type,
  kind: "oauth2",
  label,
  description,
  logo:
    type === "google.sheets"
      ? "/logos/google-sheets.png"
      : type === "google.gmail"
        ? "/logos/gmail.png"
        : type === "google.drive"
          ? "/logos/google-drive.svg"
          : type === "google.calendar"
            ? "/logos/google-calendar.svg"
            : type === "google.youtube"
              ? "/logos/youtube.svg"
              : "/logos/google-docs.png",
  oauth: true,
  testable: false,
  notTestableReason:
    "Google has no free endpoint that proves a specific scope was granted; a token that reads userinfo tells you nothing about Sheets access.",
  fields: [
    { key: "accessToken", label: "Access token", secret: true },
    {
      key: "refreshToken",
      label: "Refresh token",
      secret: true,
      optional: true,
    },
    { key: "scopes", label: "Scopes", secret: false, optional: true },
  ],
});

const GOOGLE_SERVICE_CREDENTIALS: CredentialTypeDef[] = [
  googleServiceCredential(
    "google.sheets",
    "Google Sheets",
    "Read and write spreadsheets. Grants the Sheets scope only.",
  ),
  googleServiceCredential(
    "google.gmail",
    "Gmail",
    "Read, label and send mail. Grants Gmail scopes only.",
  ),
  googleServiceCredential(
    "google.drive",
    "Google Drive",
    "List, download, upload and move files. Grants Drive scopes only.",
  ),
  googleServiceCredential(
    "google.youtube",
    "YouTube",
    "Upload and manage videos on the connected channel. Grants the YouTube upload scope only.",
  ),
  googleServiceCredential(
    "google.calendar",
    "Google Calendar",
    "Read upcoming events and their attendees. Read-only.",
  ),
  googleServiceCredential(
    "google.docs",
    "Google Docs",
    "Read and write documents. Grants Docs scopes only.",
  ),
];

/**
 * The seven OAuth providers added by AF-M10-04. Same three base fields as any
 * OAuth credential, plus whatever the provider hands back at callback time and
 * `captureExtras` persists — Intuit's company id, Shopify's shop, Atlassian's
 * cloud id. Those extras are declared here as optional, non-secret fields so
 * the write schema accepts them and the credentials UI can show them; they are
 * filled by the callback, never typed by a user.
 */
const oauthServiceCredential = (args: {
  type: string;
  label: string;
  description: string;
  logo: string;
  extras?: CredentialSecretField[];
  notTestableReason: string;
}): CredentialTypeDef => ({
  type: args.type,
  kind: "oauth2",
  label: args.label,
  description: args.description,
  logo: args.logo,
  oauth: true,
  testable: false,
  notTestableReason: args.notTestableReason,
  fields: [
    { key: "accessToken", label: "Access token", secret: true },
    {
      key: "refreshToken",
      label: "Refresh token",
      secret: true,
      optional: true,
    },
    { key: "scopes", label: "Scopes", secret: false, optional: true },
    ...(args.extras ?? []),
  ],
});

const OAUTH_SERVICE_CREDENTIALS: CredentialTypeDef[] = [
  oauthServiceCredential({
    type: "intuit.oauth2",
    label: "QuickBooks Online",
    description:
      "Connect a QuickBooks company. The company id and sandbox/production choice are captured at connect time.",
    logo: "/logos/quickbooks.png",
    notTestableReason:
      "A QBO company query is billed against the connection's API quota, and the realm may legitimately be empty on a fresh sandbox.",
    extras: [
      {
        key: "realmId",
        label: "Company id (realmId)",
        secret: false,
        optional: true,
      },
      {
        key: "environment",
        label: "Environment (sandbox or production)",
        secret: false,
        optional: true,
      },
    ],
  }),
  oauthServiceCredential({
    type: "github.oauth2",
    label: "GitHub",
    description: "Connect GitHub for pull requests, commits and webhooks.",
    logo: "/logos/github.svg",
    notTestableReason:
      "Covered by the credential's own scopes: a token that reads /user says nothing about repo access, which is what every node here needs.",
  }),
  oauthServiceCredential({
    type: "atlassian.oauth2",
    label: "Jira (Atlassian)",
    description:
      "Connect a Jira Cloud site. The site's cloud id is captured at connect time.",
    logo: "/logos/jira.png",
    notTestableReason:
      "The connect flow already calls accessible-resources and fails loudly when no site is reachable, so a separate test would assert what connecting proved.",
    extras: [
      { key: "cloudId", label: "Cloud id", secret: false, optional: true },
      { key: "siteUrl", label: "Site URL", secret: false, optional: true },
    ],
  }),
  oauthServiceCredential({
    type: "notion.oauth2",
    label: "Notion",
    description: "Connect Notion pages and databases you choose at consent.",
    logo: "/logos/notion.png",
    notTestableReason:
      "Notion grants access per page at consent time; a successful /users/me proves the token is live but nothing about the pages a node will use.",
    extras: [
      {
        key: "workspaceId",
        label: "Workspace id",
        secret: false,
        optional: true,
      },
      {
        key: "workspaceName",
        label: "Workspace name",
        secret: false,
        optional: true,
      },
      { key: "botId", label: "Bot id", secret: false, optional: true },
    ],
  }),
  oauthServiceCredential({
    type: "shopify.oauth2",
    label: "Shopify (OAuth)",
    description:
      "Connect a Shopify store through OAuth. For a single store, a custom-app Admin token is simpler.",
    logo: "/logos/shopify.png",
    notTestableReason:
      "The shop host is captured at connect time and already proven by the exchange, which happens on that host.",
    extras: [
      {
        key: "shopDomain",
        label: "Shop domain",
        secret: false,
        optional: true,
      },
    ],
  }),
  oauthServiceCredential({
    type: "linkedin.oauth2",
    label: "LinkedIn",
    description: "Connect LinkedIn to publish posts as the member.",
    logo: "/logos/linkedin.svg",
    notTestableReason:
      "LinkedIn's userinfo endpoint answers for any valid token; it does not prove the w_member_social permission a post needs.",
  }),
  oauthServiceCredential({
    type: "x.oauth2",
    label: "X (Twitter)",
    description: "Connect X to post on the authorizing account's behalf.",
    logo: "/logos/x.svg",
    notTestableReason:
      "X meters reads on the same quota as writes; a test call would spend part of a tier the user is paying for.",
    extras: [
      {
        key: "grantedScopes",
        label: "Granted scopes",
        secret: false,
        optional: true,
      },
    ],
  }),
];

export const CREDENTIAL_TYPE_DEFINITIONS: CredentialTypeDef[] = [
  {
    type: "apiKey",
    kind: "apiKey",
    label: "API Key",
    description: "Generic API key for any service",
    logo: "/logos/logo.svg",
    notTestableReason:
      "Generic type — there is no provider to call, so there is nothing to test against.",
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
    notTestableReason:
      "Generic type — there is no provider to call, so there is nothing to test against.",
    fields: [{ key: "token", label: "Token", secret: true }],
  },
  {
    type: "basic",
    kind: "basic",
    label: "Username & password",
    description: "HTTP Basic auth credentials",
    logo: "/logos/logo.svg",
    notTestableReason:
      "Generic type — there is no provider to call, so there is nothing to test against.",
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
    notTestableReason:
      "Generic type — there is no provider to call, so there is nothing to test against.",
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
    notTestableReason:
      "Generic type — the provider is unknown, so there is no endpoint to call.",
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
    testable: true,
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
    testable: true,
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
    testable: true,
    fields: [{ key: "apiKey", label: "API key", secret: true }],
  },
  {
    type: "slack.oauth2",
    kind: "oauth2",
    label: "Slack (OAuth)",
    description: "Connect your Slack workspace",
    logo: "/logos/slack.svg",
    oauth: true,
    testable: false,
    notTestableReason:
      "Slack's auth.test needs a scope the connect flow does not always grant; a failure here would read as a bad token when it is a missing scope.",
    fields: [
      { key: "accessToken", label: "Access token", secret: true },
      {
        key: "refreshToken",
        label: "Refresh token",
        secret: true,
        optional: true,
      },
      { key: "scopes", label: "Scopes", secret: false, optional: true },
    ],
  },
  {
    type: "google.oauth2",
    kind: "oauth2",
    label: "Google (OAuth)",
    description:
      "Legacy single Google connection. Superseded by the per-service types below.",
    logo: "/logos/google.svg",
    oauth: true,
    testable: false,
    notTestableReason:
      "Scope-dependent: the one endpoint every Google grant can reach is userinfo, which proves nothing about the scopes a node needs.",
    deprecated: {
      since: "2026-09-03",
      replacedBy: "google.sheets",
      reason:
        "One Google connection meant one scope set for every workflow. Connect the per-service type your node needs instead — a sheet-appending workflow should not be able to read your mail.",
    },
    fields: [
      { key: "accessToken", label: "Access token", secret: true },
      {
        key: "refreshToken",
        label: "Refresh token",
        secret: true,
        optional: true,
      },
      { key: "scopes", label: "Scopes", secret: false, optional: true },
    ],
  },
  // --- AF-M10-03: one Google credential per service (ADR-0023) -------------
  ...GOOGLE_SERVICE_CREDENTIALS,
  // --- AF-M10-04: OAuth providers for the library's services ---------------
  ...OAUTH_SERVICE_CREDENTIALS,
  {
    type: "postgres",
    kind: "basic",
    label: "PostgreSQL",
    description: "Credentials for a PostgreSQL server",
    logo: "/logos/logo.svg",
    testable: true,
    fields: [
      {
        key: "host",
        label: "Host",
        secret: false,
        placeholder: "db.example.com",
      },
      { key: "port", label: "Port", secret: false, placeholder: "5432" },
      { key: "database", label: "Database", secret: false },
      { key: "username", label: "Username", secret: false },
      { key: "password", label: "Password", secret: true },
      {
        key: "ssl",
        label: "SSL (require or disable)",
        secret: false,
        optional: true,
        placeholder: "require",
      },
    ],
  },
  {
    type: "smtp",
    kind: "basic",
    label: "SMTP",
    description: "Outbound email relay",
    logo: "/logos/logo.svg",
    testable: true,
    fields: [
      {
        key: "host",
        label: "Host",
        secret: false,
        placeholder: "smtp.example.com",
      },
      { key: "port", label: "Port", secret: false, placeholder: "587" },
      { key: "username", label: "Username", secret: false },
      { key: "password", label: "Password", secret: true },
      {
        key: "tls",
        label: "TLS (none, starttls, ssl)",
        secret: false,
        optional: true,
        placeholder: "starttls",
      },
    ],
  },
  {
    type: "airtable.apiKey",
    kind: "apiKey",
    label: "Airtable API key",
    description: "Personal access token for api.airtable.com",
    logo: "/logos/airtable.png",
    testable: true,
    fields: [
      {
        key: "apiKey",
        label: "API key",
        secret: true,
        placeholder: "pat...",
      },
    ],
  },
  {
    type: "hubspot.apiKey",
    kind: "apiKey",
    label: "HubSpot API key",
    description: "Private app access token for api.hubapi.com",
    logo: "/logos/hubspot.png",
    testable: true,
    fields: [
      {
        key: "apiKey",
        label: "API key",
        secret: true,
        placeholder: "pat-eu1-...",
      },
    ],
  },
  {
    type: "groq.apiKey",
    kind: "apiKey",
    label: "Groq API key",
    description:
      "Low-latency inference on Groq LPU-accelerated hardware (OpenAI-compatible)",
    logo: "/logos/logo.svg",
    testable: true,
    fields: [
      {
        key: "apiKey",
        label: "API key",
        secret: true,
        placeholder: "gsk_...",
      },
    ],
  },
  {
    type: "deepseek.apiKey",
    kind: "apiKey",
    label: "DeepSeek API key",
    description: "DeepSeek chat and reasoner models (OpenAI-compatible)",
    logo: "/logos/logo.svg",
    testable: true,
    fields: [
      {
        key: "apiKey",
        label: "API key",
        secret: true,
        placeholder: "sk-...",
      },
    ],
  },
  {
    type: "openaiCompatible.apiKey",
    kind: "apiKey",
    label: "OpenAI-compatible API key",
    description: "Bearer key for a custom OpenAI-compatible endpoint",
    logo: "/logos/logo.svg",
    testable: false,
    notTestableReason:
      "The endpoint is per-workflow config, not part of the credential, so there is no fixed URL to test against.",
    fields: [
      {
        key: "apiKey",
        label: "API key",
        secret: true,
        placeholder: "sk-...",
      },
    ],
  },
  // -------------------------------------------------------------------------
  // AF-M10-02 — the automation library's services. API-key/token shapes only;
  // the seven OAuth providers land in AF-M10-04 and the scoped Google types in
  // AF-M10-03. Non-secret fields (a site URL, a shop domain, a search engine
  // id) still live inside the encrypted envelope: they identify the tenant the
  // key belongs to, and splitting them into node config would let one
  // workflow point a colleague's key at a different account.
  // -------------------------------------------------------------------------
  {
    type: "apify.apiKey",
    kind: "apiKey",
    label: "Apify API token",
    description: "Personal API token for api.apify.com (actor runs, datasets)",
    logo: "/logos/apify.svg",
    testable: true,
    fields: [
      {
        key: "apiKey",
        label: "API token",
        secret: true,
        placeholder: "apify_api_...",
      },
    ],
  },
  {
    type: "apollo.apiKey",
    kind: "apiKey",
    label: "Apollo.io API key",
    description: "Master API key for api.apollo.io (people & org enrichment)",
    logo: "/logos/apollo.svg",
    testable: true,
    fields: [{ key: "apiKey", label: "API key", secret: true }],
  },
  {
    type: "mailerlite.apiKey",
    kind: "apiKey",
    label: "MailerLite API key",
    description: "API token for connect.mailerlite.com",
    logo: "/logos/mailerlite.svg",
    testable: true,
    fields: [{ key: "apiKey", label: "API key", secret: true }],
  },
  {
    type: "pinecone.apiKey",
    kind: "apiKey",
    label: "Pinecone API key",
    description: "API key for a Pinecone vector index",
    logo: "/logos/pinecone.svg",
    testable: true,
    fields: [
      { key: "apiKey", label: "API key", secret: true },
      {
        key: "environment",
        label: "Environment (legacy pod indexes)",
        secret: false,
        optional: true,
        placeholder: "us-east-1-aws",
      },
      {
        key: "indexHost",
        label: "Index host",
        secret: false,
        optional: true,
        placeholder: "my-index-abc123.svc.us-east-1-aws.pinecone.io",
      },
    ],
  },
  {
    type: "openrouter.apiKey",
    kind: "apiKey",
    label: "OpenRouter API key",
    description:
      "API key for openrouter.ai — an OpenAI-compatible gateway to many models",
    logo: "/logos/openrouter.svg",
    testable: true,
    fields: [
      {
        key: "apiKey",
        label: "API key",
        secret: true,
        placeholder: "sk-or-v1-...",
      },
    ],
  },
  {
    type: "creatomate.apiKey",
    kind: "apiKey",
    label: "Creatomate API key",
    description: "API key for api.creatomate.com (template video rendering)",
    logo: "/logos/creatomate.svg",
    testable: true,
    fields: [{ key: "apiKey", label: "API key", secret: true }],
  },
  {
    type: "telegram.botToken",
    kind: "apiKey",
    label: "Telegram bot token",
    description: "Bot token issued by @BotFather",
    logo: "/logos/telegram.svg",
    testable: true,
    fields: [
      {
        key: "botToken",
        label: "Bot token",
        secret: true,
        placeholder: "123456789:AA...",
      },
    ],
  },
  {
    type: "waha.apiKey",
    kind: "apiKey",
    label: "WAHA (WhatsApp HTTP API)",
    description: "API key and base URL of a self-hosted WAHA instance",
    logo: "/logos/waha.svg",
    testable: true,
    fields: [
      { key: "apiKey", label: "API key", secret: true },
      {
        key: "baseUrl",
        label: "Base URL",
        secret: false,
        placeholder: "https://waha.example.com",
      },
    ],
  },
  {
    type: "uploadPost.apiKey",
    kind: "apiKey",
    label: "Upload-Post API key",
    description:
      "API key for upload-post.com (publishes to Instagram, TikTok and others)",
    logo: "/logos/upload-post.svg",
    testable: true,
    fields: [{ key: "apiKey", label: "API key", secret: true }],
  },
  {
    type: "googleCustomSearch.apiKey",
    kind: "apiKey",
    label: "Google Custom Search",
    description:
      "API key plus the search-engine id (cx) for the Custom Search JSON API",
    logo: "/logos/google.svg",
    testable: false,
    notTestableReason:
      "Every Custom Search call is metered against a 100-query free daily quota; a connection test would spend one of the user's queries.",
    fields: [
      { key: "apiKey", label: "API key", secret: true },
      {
        key: "cx",
        label: "Search engine id (cx)",
        secret: false,
        placeholder: "a1b2c3d4e5f6g7h8i",
      },
    ],
  },
  {
    type: "stripe.apiKey",
    kind: "apiKey",
    label: "Stripe secret key",
    description: "Secret API key for api.stripe.com (customers, payment links)",
    logo: "/logos/stripe.svg",
    testable: true,
    fields: [
      {
        key: "apiKey",
        label: "Secret key",
        secret: true,
        placeholder: "sk_live_... or sk_test_...",
      },
    ],
  },
  {
    type: "googleMaps.apiKey",
    kind: "apiKey",
    label: "Google Maps Platform",
    description: "API key for the Places API (text search, place details)",
    logo: "/logos/google-maps.svg",
    testable: false,
    notTestableReason:
      "Every Places call is billed per request, so a connection test would spend the user's money to learn nothing they could not learn from the first run.",
    fields: [{ key: "apiKey", label: "API key", secret: true }],
  },
  {
    type: "shopify.accessToken",
    kind: "apiKey",
    label: "Shopify Admin API token",
    description: "Admin API access token for a single shop",
    logo: "/logos/shopify.png",
    testable: true,
    fields: [
      {
        key: "accessToken",
        label: "Admin API access token",
        secret: true,
        placeholder: "shpat_...",
      },
      {
        key: "shopDomain",
        label: "Shop domain",
        secret: false,
        placeholder: "my-store.myshopify.com",
      },
    ],
  },
  {
    type: "jira.apiToken",
    kind: "basic",
    label: "Jira API token",
    description: "Atlassian account email + API token for a Jira Cloud site",
    logo: "/logos/jira.png",
    testable: true,
    fields: [
      {
        key: "email",
        label: "Atlassian account email",
        secret: false,
        placeholder: "you@example.com",
      },
      { key: "apiToken", label: "API token", secret: true },
      {
        key: "siteUrl",
        label: "Site URL",
        secret: false,
        placeholder: "https://your-team.atlassian.net",
      },
    ],
  },
];

/**
 * What the "new credential" picker offers (AF-M10-03). Deprecated types stay
 * in `CREDENTIAL_TYPE_DEFINITIONS` — an existing credential of that type must
 * still render, resolve and refresh — but are not offered for creation, so
 * their population can only shrink. Look types up through
 * `credentialDefsById`, never through this list.
 */
export const credentialPalette: CredentialTypeDef[] =
  CREDENTIAL_TYPE_DEFINITIONS.filter((def) => !def.deprecated);

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
