import { ensureEnv } from "@/lib/env";

/**
 * OAuth 2.0 providers, keyed by the credential type they produce
 * (AF-M3, extended by AF-M10-03 and AF-M10-04).
 *
 * A provider entry is data, not code: the connect route builds an authorize
 * URL from it and the callback exchanges the code with it. The three things
 * that used to be hard-coded in the routes — Google's `access_type=offline`,
 * the credential's display name, whether tokens expire — are fields here, so
 * adding a provider is an entry rather than another `if (provider === ...)`.
 */

export interface OAuthCallbackContext {
  /** The callback's own query string (Intuit's `realmId`, Shopify's `shop`). */
  query: URLSearchParams;
  /** The parsed token-endpoint response. */
  token: Record<string, unknown>;
}

export interface OAuthProvider {
  /** Credential type id this provider produces. */
  id: string;
  /** Display name — used for the credential created by the callback. */
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string | undefined;
  clientSecret: string | undefined;
  /** Space-separated scopes requested at connect time. */
  defaultScopes: string;
  /** Extra authorize-URL parameters (e.g. Google's offline access). */
  authorizeParams?: Record<string, string>;
  /**
   * PKCE (RFC 7636). X requires it; it is harmless elsewhere but only enabled
   * where the provider supports it, since a stray `code_challenge` makes some
   * token endpoints reject the exchange.
   */
  usePkce?: boolean;
  /**
   * How the client credentials reach the token endpoint. `basic` sends them
   * as an HTTP Basic header — Intuit, Notion and X require this and reject the
   * body form with an opaque `invalid_client`.
   */
  tokenAuth?: "body" | "basic";
  /**
   * Body encoding for the token request. Notion's endpoint is JSON-only and
   * answers a form-encoded body with `invalid_request`; everything else here
   * takes the OAuth-standard form encoding.
   */
  tokenBodyFormat?: "form" | "json";
  /**
   * Connect-time query parameters this provider needs, carried through the
   * redirect in the signed state and handed back to `captureExtras` /
   * `resolveUrls` at the callback. Shopify needs the shop domain to build a
   * URL at all; Intuit needs to know whether this connection is for the
   * sandbox company or the real one.
   */
  connectParams?: readonly string[];
  /**
   * A second call the connection needs before it is usable — Atlassian's
   * `cloudId`, which identifies the Jira site and is not in the token
   * response. Returns extra secret fields. Failing here fails the connect,
   * because a credential without them is one that every node using it will
   * reject at run time with a less obvious error.
   */
  postExchange?: (ctx: {
    accessToken: string;
  }) => Promise<Record<string, string>>;
  /**
   * Provider-specific identifiers returned alongside the token, persisted
   * into the credential secret. Intuit's `realmId` is the company id and every
   * QBO call needs it; Shopify's `shop` is the store's host. Before AF-M10-04
   * there was nowhere to put these and the connection was unusable without
   * asking the user to paste them back in.
   */
  captureExtras?: (ctx: OAuthCallbackContext) => Record<string, string>;
  /**
   * False when the provider issues non-expiring tokens (Shopify). The refresh
   * cron skips these; without the flag a null `expires_in` would look like an
   * immediately-stale credential.
   */
  tokensExpire?: boolean;
  /**
   * True when the provider invalidates the old refresh token on every
   * exchange (Intuit). The refresh job must persist the returned one in the
   * same write or the connection is lost — there is no second chance.
   */
  rotatesRefreshToken?: boolean;
  /**
   * Builds the authorize/token URLs from connect-time parameters. Shopify's
   * endpoints live on the merchant's own domain, so they cannot be constants.
   */
  resolveUrls?: (params: URLSearchParams) => {
    authorizeUrl: string;
    tokenUrl: string;
  } | null;
}

const googleClient = {
  get clientId() {
    return ensureEnv().GOOGLE_CLIENT_ID;
  },
  get clientSecret() {
    return ensureEnv().GOOGLE_CLIENT_SECRET;
  },
};

const GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";

/**
 * Google asks for consent every time so a refresh token is always returned.
 * Without `prompt=consent`, a second authorization of an already-granted
 * client returns an access token and **no** refresh token, and the credential
 * silently stops working an hour later.
 */
const GOOGLE_AUTHORIZE_PARAMS = {
  access_type: "offline",
  prompt: "consent",
  include_granted_scopes: "false",
};

const googleProvider = (
  id: string,
  label: string,
  scopes: string,
): OAuthProvider => ({
  id,
  label,
  authorizeUrl: GOOGLE_AUTHORIZE,
  tokenUrl: GOOGLE_TOKEN,
  get clientId() {
    return googleClient.clientId;
  },
  get clientSecret() {
    return googleClient.clientSecret;
  },
  defaultScopes: scopes,
  authorizeParams: GOOGLE_AUTHORIZE_PARAMS,
});

export const oauthProviders: Record<string, OAuthProvider> = {
  /**
   * Deprecated (ADR-0023). Kept registered so the credentials created before
   * the split keep refreshing; nothing new connects through it.
   */
  "google.oauth2": googleProvider(
    "google.oauth2",
    "Google Account",
    "https://www.googleapis.com/auth/userinfo.email",
  ),

  // --- AF-M10-03: one Google credential per service ------------------------
  "google.sheets": googleProvider(
    "google.sheets",
    "Google Sheets",
    "https://www.googleapis.com/auth/spreadsheets",
  ),
  "google.gmail": googleProvider(
    "google.gmail",
    "Gmail",
    [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      // `gmail.modify` is what lets a workflow mark a message read or move it
      // between labels, which is how a polling trigger avoids reprocessing the
      // same mail. It does not grant permanent deletion.
      "https://www.googleapis.com/auth/gmail.modify",
    ].join(" "),
  ),
  "google.drive": googleProvider(
    "google.drive",
    "Google Drive",
    // Full `drive`, deliberately, and documented in ADR-0023: `drive.file`
    // only ever sees files this app created, so "watch a folder the user drops
    // contracts into" and "move a processed file to /approved" — the shape of
    // automations #28, #29 and #30 — are both impossible under it.
    "https://www.googleapis.com/auth/drive",
  ),
  "google.youtube": googleProvider(
    "google.youtube",
    "YouTube",
    // `youtube.upload` only — it can add a video and nothing else. The wider
    // `youtube` scope would also let a workflow delete the channel's back
    // catalogue, which no automation here needs.
    "https://www.googleapis.com/auth/youtube.upload",
  ),
  "google.calendar": googleProvider(
    "google.calendar",
    "Google Calendar",
    "https://www.googleapis.com/auth/calendar.readonly",
  ),
  "google.docs": googleProvider(
    "google.docs",
    "Google Docs",
    [
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/drive.readonly",
    ].join(" "),
  ),

  "slack.oauth2": {
    id: "slack.oauth2",
    label: "Slack Workspace",
    authorizeUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    get clientId() {
      return process.env.SLACK_CLIENT_ID;
    },
    get clientSecret() {
      return process.env.SLACK_CLIENT_SECRET;
    },
    defaultScopes:
      "chat:write chat:write.public channels:read channels:manage groups:read users:read users:read.email im:write",
  },

  // --- AF-M10-04: the seven providers the library's services need ----------

  /**
   * QuickBooks Online. Two quirks that are not optional to get right:
   *
   * - `realmId` (the company id) arrives on the **callback query**, not in the
   *   token response, and every QBO API call needs it in the path. Without
   *   capturing it here the connection is unusable and the user has to find
   *   the number in Intuit's UI and paste it into every node.
   * - The refresh token **rotates on every exchange** and the old one dies
   *   immediately. The refresh job persists the new one in the same write.
   */
  "intuit.oauth2": {
    id: "intuit.oauth2",
    label: "QuickBooks Online",
    authorizeUrl: "https://appcenter.intuit.com/connect/oauth2",
    tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    get clientId() {
      return process.env.INTUIT_CLIENT_ID;
    },
    get clientSecret() {
      return process.env.INTUIT_CLIENT_SECRET;
    },
    defaultScopes: "com.intuit.quickbooks.accounting",
    tokenAuth: "basic",
    rotatesRefreshToken: true,
    // Sandbox vs production is a property of the connection, not of a node —
    // it decides the API base URL, and putting it in node config is how the
    // source templates ended up shipping sandbox company ids (AF-M10-16).
    connectParams: ["environment"],
    captureExtras: ({ query }) => {
      const extras: Record<string, string> = {};
      const realmId = query.get("realmId");
      if (realmId) {
        extras.realmId = realmId;
      }
      extras.environment =
        query.get("environment") === "sandbox" ? "sandbox" : "production";
      return extras;
    },
  },

  /**
   * GitHub OAuth app. Deliberately a *different* client from the sign-in app
   * (`GITHUB_CLIENT_ID`): connecting a repo integration must not silently
   * widen what the login button asks for.
   */
  "github.oauth2": {
    id: "github.oauth2",
    label: "GitHub",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    get clientId() {
      return process.env.GITHUB_OAUTH_CLIENT_ID;
    },
    get clientSecret() {
      return process.env.GITHUB_OAUTH_CLIENT_SECRET;
    },
    defaultScopes: "repo read:org",
    // Classic OAuth-app tokens do not expire unless the app opts in.
    tokensExpire: false,
  },

  /**
   * Atlassian (Jira Cloud). `offline_access` is what makes a refresh token
   * appear at all, and `cloudId` — the site identifier every v3 REST path
   * needs — is not in the token response, so it is fetched immediately after
   * the exchange.
   */
  "atlassian.oauth2": {
    id: "atlassian.oauth2",
    label: "Jira (Atlassian)",
    authorizeUrl: "https://auth.atlassian.com/authorize",
    tokenUrl: "https://auth.atlassian.com/oauth/token",
    get clientId() {
      return process.env.ATLASSIAN_CLIENT_ID;
    },
    get clientSecret() {
      return process.env.ATLASSIAN_CLIENT_SECRET;
    },
    defaultScopes:
      "read:jira-work write:jira-work read:jira-user manage:jira-project offline_access",
    authorizeParams: { audience: "api.atlassian.com", prompt: "consent" },
    postExchange: async ({ accessToken }) => {
      const response = await fetch(
        "https://api.atlassian.com/oauth/token/accessible-resources",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!response.ok) {
        throw new Error(
          `Atlassian: could not list accessible sites (${response.status}).`,
        );
      }
      const sites = (await response.json()) as Array<{
        id?: string;
        url?: string;
      }>;
      const site = sites?.[0];
      if (!site?.id) {
        throw new Error(
          "Atlassian: the authorizing account has no accessible Jira site.",
        );
      }
      return {
        cloudId: site.id,
        ...(site.url ? { siteUrl: site.url } : {}),
      };
    },
  },

  /**
   * Notion. No scopes — access is decided by the pages the user picks in the
   * consent UI — and a JSON-only token endpoint that requires HTTP Basic.
   */
  "notion.oauth2": {
    id: "notion.oauth2",
    label: "Notion",
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    get clientId() {
      return process.env.NOTION_CLIENT_ID;
    },
    get clientSecret() {
      return process.env.NOTION_CLIENT_SECRET;
    },
    defaultScopes: "",
    authorizeParams: { owner: "user" },
    tokenAuth: "basic",
    tokenBodyFormat: "json",
    tokensExpire: false,
    captureExtras: ({ token }) => {
      const extras: Record<string, string> = {};
      if (typeof token.workspace_id === "string") {
        extras.workspaceId = token.workspace_id;
      }
      if (typeof token.workspace_name === "string") {
        extras.workspaceName = token.workspace_name;
      }
      if (typeof token.bot_id === "string") {
        extras.botId = token.bot_id;
      }
      return extras;
    },
  },

  /**
   * Shopify. The only provider whose endpoints are not constants: authorize
   * and token both live on the merchant's own domain, so the shop is a
   * connect-time parameter and the URLs are derived from it.
   */
  "shopify.oauth2": {
    id: "shopify.oauth2",
    label: "Shopify",
    authorizeUrl: "",
    tokenUrl: "",
    get clientId() {
      return process.env.SHOPIFY_CLIENT_ID;
    },
    get clientSecret() {
      return process.env.SHOPIFY_CLIENT_SECRET;
    },
    defaultScopes:
      "read_orders write_orders read_products read_customers write_customers",
    // Offline access tokens never expire; the refresh cron must not treat a
    // missing `expires_in` as "already stale".
    tokensExpire: false,
    connectParams: ["shop"],
    resolveUrls: (params) => {
      const shop = normalizeShopDomain(params.get("shop"));
      if (!shop) {
        return null;
      }
      return {
        authorizeUrl: `https://${shop}/admin/oauth/authorize`,
        tokenUrl: `https://${shop}/admin/oauth/access_token`,
      };
    },
    captureExtras: ({ query }): Record<string, string> => {
      const shop = normalizeShopDomain(query.get("shop"));
      return shop ? { shopDomain: shop } : {};
    },
  },

  "linkedin.oauth2": {
    id: "linkedin.oauth2",
    label: "LinkedIn",
    authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    get clientId() {
      return process.env.LINKEDIN_CLIENT_ID;
    },
    get clientSecret() {
      return process.env.LINKEDIN_CLIENT_SECRET;
    },
    // `w_member_social` is the post-on-behalf-of permission; `openid profile`
    // is what yields the member URN a UGC post has to be authored by.
    defaultScopes: "openid profile w_member_social",
  },

  /**
   * X (Twitter) API v2. PKCE is mandatory — the authorize endpoint rejects a
   * request without a challenge — and the token endpoint requires HTTP Basic.
   * `offline.access` is what yields a refresh token.
   */
  "x.oauth2": {
    id: "x.oauth2",
    label: "X (Twitter)",
    authorizeUrl: "https://x.com/i/oauth2/authorize",
    tokenUrl: "https://api.x.com/2/oauth2/token",
    get clientId() {
      return process.env.X_CLIENT_ID;
    },
    get clientSecret() {
      return process.env.X_CLIENT_SECRET;
    },
    defaultScopes: "tweet.read tweet.write users.read offline.access",
    usePkce: true,
    tokenAuth: "basic",
    captureExtras: ({ token }): Record<string, string> =>
      typeof token.scope === "string" ? { grantedScopes: token.scope } : {},
  },
};

/**
 * `my-store`, `my-store.myshopify.com` and `https://my-store.myshopify.com/`
 * are all things a user types. Only the bare host is a valid OAuth host, and
 * the domain is restricted to `*.myshopify.com` so a shop parameter cannot
 * point the authorize step at an arbitrary origin.
 */
function normalizeShopDomain(raw: string | null): string | null {
  if (!raw) {
    return null;
  }
  const host = raw
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
  const full = host.includes(".") ? host : `${host}.myshopify.com`;
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(full) ? full : null;
}

/** Providers a user may connect right now — deprecated ones stay resolvable. */
export const connectableOAuthProviders = (): OAuthProvider[] =>
  Object.values(oauthProviders).filter((p) => p.id !== "google.oauth2");

/**
 * Build the authorize URL for a provider.
 *
 * Extracted from the route so the scope actually requested per credential type
 * is assertable in a unit test — AF-M10-03's acceptance — rather than only
 * observable by clicking Connect and reading the consent screen.
 */
export function buildAuthorizeUrl(args: {
  provider: OAuthProvider;
  redirectUri: string;
  state: string;
  /** PKCE challenge, when `provider.usePkce`. */
  codeChallenge?: string;
  /** Connect-time params, for providers whose URLs are host-dependent. */
  params?: URLSearchParams;
}): string {
  const { provider, redirectUri, state, codeChallenge } = args;
  const resolved = provider.resolveUrls?.(args.params ?? new URLSearchParams());
  const authorizeUrl = resolved?.authorizeUrl ?? provider.authorizeUrl;

  const url = new URL(authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", provider.clientId ?? "");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", provider.defaultScopes);
  url.searchParams.set("state", state);

  for (const [key, value] of Object.entries(provider.authorizeParams ?? {})) {
    url.searchParams.set(key, value);
  }

  if (provider.usePkce && codeChallenge) {
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }

  return url.toString();
}
