import { beforeAll, describe, expect, it } from "vitest";
import { credentialDefsById } from "../credential-types";
import { buildOAuthSecret } from "./oauth-exchange";
import { buildAuthorizeUrl, oauthProviders } from "./oauth-providers";
import { STATE_TTL_SECONDS, signState, verifyState } from "./oauth-state";

beforeAll(() => {
  process.env.CREDENTIAL_MASTER_KEY = "12345678901234567890123456789012";
  process.env.GOOGLE_CLIENT_ID = "google-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";
});

describe("OAuth State", () => {
  it("signs and verifies state payload successfully", () => {
    const state = {
      userId: "user-123",
      organizationId: "org-123",
      providerId: "google.sheets",
      nonce: "random-nonce",
    };

    const token = signState(state);
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(2);

    expect(verifyState(token)).toMatchObject(state);
  });

  it("throws error on invalid signature", () => {
    const token =
      "eyJ1c2VySWQiOiJ1c2VyLTEyMyIsInByb3ZpZGVySWQiOiJnb29nbGUub2F1dGgyIiwibm9uY2UiOiJyYW5kb20tbm9uY2UifQ.invalid-signature";
    expect(() => verifyState(token)).toThrow("State signature mismatch");
  });

  it("carries the organization through the redirect (AF-M10-03)", () => {
    // The callback arrives from the provider; the app's own cookies are not
    // guaranteed to still select the same org. Without this the credential was
    // created with a null organizationId and no org-scoped read could see it.
    const verified = verifyState(
      signState({
        userId: "user-1",
        organizationId: "org-42",
        providerId: "google.gmail",
        nonce: "n",
      }),
    );
    expect(verified.organizationId).toBe("org-42");
  });

  it("refuses a state token older than its TTL", () => {
    const stale = Math.floor(Date.now() / 1000) - STATE_TTL_SECONDS - 60;
    const payload = Buffer.from(
      JSON.stringify({
        userId: "u",
        providerId: "google.sheets",
        nonce: "n",
        iat: stale,
      }),
    ).toString("base64url");
    // Sign it the same way signState does, so only the age is wrong.
    const { createHmac } =
      require("node:crypto") as typeof import("node:crypto");
    const sig = createHmac(
      "sha256",
      process.env.CREDENTIAL_MASTER_KEY as string,
    )
      .update(payload)
      .digest("base64url");
    expect(() => verifyState(`${payload}.${sig}`)).toThrow(/expired/i);
  });
});

describe("Google scoped credentials (AF-M10-03)", () => {
  const authorize = (providerId: string) =>
    new URL(
      buildAuthorizeUrl({
        provider: oauthProviders[providerId],
        redirectUri: "https://app.example.com/api/oauth/x/callback",
        state: "state-token",
      }),
    );

  it("registers one provider per Google service", () => {
    for (const id of [
      "google.sheets",
      "google.gmail",
      "google.drive",
      "google.calendar",
      "google.docs",
    ]) {
      expect(oauthProviders[id], `${id} provider`).toBeDefined();
      expect(credentialDefsById.get(id), `${id} credential type`).toBeDefined();
    }
  });

  it("asks for only that service's scopes on the consent screen", () => {
    // The acceptance: a user connecting Sheets must not be asked for Gmail.
    // Asserted on the authorize URL, because the consent screen shows exactly
    // what this parameter says and nothing else does.
    const scopeOf = (id: string) =>
      (authorize(id).searchParams.get("scope") ?? "").split(" ");

    expect(scopeOf("google.sheets")).toEqual([
      "https://www.googleapis.com/auth/spreadsheets",
    ]);
    expect(scopeOf("google.calendar")).toEqual([
      "https://www.googleapis.com/auth/calendar.readonly",
    ]);

    const gmail = scopeOf("google.gmail");
    expect(gmail).toContain("https://www.googleapis.com/auth/gmail.send");
    expect(gmail.every((s) => s.includes("/gmail."))).toBe(true);

    const drive = scopeOf("google.drive");
    expect(drive.every((s) => s.includes("/drive"))).toBe(true);

    // The one that matters most: no scoped type may drag in another service.
    for (const id of ["google.sheets", "google.calendar", "google.docs"]) {
      expect(scopeOf(id).some((s) => s.includes("/gmail."))).toBe(false);
    }
  });

  it("requests offline access so a refresh token is actually issued", () => {
    // Without prompt=consent, re-authorizing an already-granted client returns
    // an access token and no refresh token, and the credential dies in an hour.
    const url = authorize("google.sheets");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("keeps the deprecated google.oauth2 resolvable but out of the palette", () => {
    // ADR-0011's rule for credentials: a saved node holds this type by id and
    // must keep running. Removing it would break workflows to tidy a registry.
    expect(oauthProviders["google.oauth2"]).toBeDefined();
    const def = credentialDefsById.get("google.oauth2");
    expect(def?.deprecated?.replacedBy).toBe("google.sheets");
  });

  it("builds a state-bearing authorize URL with the redirect it will use", () => {
    const url = authorize("google.drive");
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("google-client-id");
    expect(url.searchParams.get("state")).toBe("state-token");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/api/oauth/x/callback",
    );
  });
});

describe("buildOAuthSecret", () => {
  const provider = oauthProviders["google.sheets"];

  it("keeps a refresh token the provider did not return", () => {
    // Google omits refresh_token on a refresh exchange. Dropping the stored
    // one would end the connection at the next expiry.
    const secret = buildOAuthSecret({
      provider,
      token: { accessToken: "new-access", raw: {} },
      query: new URLSearchParams(),
      previous: { accessToken: "old-access", refreshToken: "keep-me" },
    });
    expect(secret).toMatchObject({
      accessToken: "new-access",
      refreshToken: "keep-me",
    });
  });

  it("records the granted scopes when the provider reports them", () => {
    const secret = buildOAuthSecret({
      provider,
      token: {
        accessToken: "a",
        scope: "https://www.googleapis.com/auth/spreadsheets",
        raw: {},
      },
      query: new URLSearchParams(),
    });
    expect(secret.scopes).toBe("https://www.googleapis.com/auth/spreadsheets");
  });
});

// ---------------------------------------------------------------------------
// AF-M10-04 — the seven providers the automation library's services need.
// ---------------------------------------------------------------------------

const NEW_PROVIDERS = [
  "intuit.oauth2",
  "github.oauth2",
  "atlassian.oauth2",
  "notion.oauth2",
  "shopify.oauth2",
  "linkedin.oauth2",
  "x.oauth2",
] as const;

describe("OAuth providers (AF-M10-04)", () => {
  beforeAll(() => {
    process.env.INTUIT_CLIENT_ID = "intuit-id";
    process.env.INTUIT_CLIENT_SECRET = "intuit-secret";
    process.env.GITHUB_OAUTH_CLIENT_ID = "github-id";
    process.env.GITHUB_OAUTH_CLIENT_SECRET = "github-secret";
    process.env.ATLASSIAN_CLIENT_ID = "atlassian-id";
    process.env.ATLASSIAN_CLIENT_SECRET = "atlassian-secret";
    process.env.NOTION_CLIENT_ID = "notion-id";
    process.env.NOTION_CLIENT_SECRET = "notion-secret";
    process.env.SHOPIFY_CLIENT_ID = "shopify-id";
    process.env.SHOPIFY_CLIENT_SECRET = "shopify-secret";
    process.env.LINKEDIN_CLIENT_ID = "linkedin-id";
    process.env.LINKEDIN_CLIENT_SECRET = "linkedin-secret";
    process.env.X_CLIENT_ID = "x-id";
    process.env.X_CLIENT_SECRET = "x-secret";
  });

  const authorize = (id: string, params?: URLSearchParams) =>
    new URL(
      buildAuthorizeUrl({
        provider: oauthProviders[id],
        redirectUri: `https://app.example.com/api/oauth/${id}/callback`,
        state: "state-token",
        codeChallenge: "challenge-value",
        params,
      }),
    );

  it("registers all seven with a credential type and env-backed client", () => {
    for (const id of NEW_PROVIDERS) {
      const provider = oauthProviders[id];
      expect(provider, `${id} provider`).toBeDefined();
      expect(provider.clientId, `${id} clientId`).toBeTruthy();
      expect(provider.clientSecret, `${id} clientSecret`).toBeTruthy();
      expect(credentialDefsById.get(id), `${id} credential type`).toBeDefined();
    }
  });

  it("builds Intuit's authorize URL with the accounting scope", () => {
    const url = authorize("intuit.oauth2");
    expect(url.origin + url.pathname).toBe(
      "https://appcenter.intuit.com/connect/oauth2",
    );
    expect(url.searchParams.get("scope")).toBe(
      "com.intuit.quickbooks.accounting",
    );
    expect(url.searchParams.get("client_id")).toBe("intuit-id");
  });

  it("captures Intuit's realmId from the callback query", () => {
    // The company id arrives on the redirect, not in the token body, and
    // every QBO API path needs it. Without this the connection is unusable.
    const secret = buildOAuthSecret({
      provider: oauthProviders["intuit.oauth2"],
      token: { accessToken: "at", refreshToken: "rt1", raw: {} },
      query: new URLSearchParams("realmId=4620816365000000000"),
    });
    expect(secret.realmId).toBe("4620816365000000000");
    expect(secret.environment).toBe("production");
  });

  it("records Intuit's sandbox choice, defaulting to production", () => {
    const sandbox = buildOAuthSecret({
      provider: oauthProviders["intuit.oauth2"],
      token: { accessToken: "at", raw: {} },
      query: new URLSearchParams("realmId=1&environment=sandbox"),
    });
    expect(sandbox.environment).toBe("sandbox");
  });

  it("replaces Intuit's rotating refresh token rather than keeping the old one", () => {
    // Intuit invalidates the previous refresh token the moment it issues a
    // new one. Keeping the stored value would lose the connection at the next
    // refresh, with no way back but reconnecting by hand.
    const provider = oauthProviders["intuit.oauth2"];
    expect(provider.rotatesRefreshToken).toBe(true);

    const secret = buildOAuthSecret({
      provider,
      token: { accessToken: "at2", refreshToken: "rt2-new", raw: {} },
      query: new URLSearchParams(),
      previous: { accessToken: "at1", refreshToken: "rt1-dead", realmId: "42" },
    });
    expect(secret.refreshToken).toBe("rt2-new");
    // Extras the refresh does not return survive.
    expect(secret.realmId).toBe("42");
  });

  it("puts X behind PKCE and Basic token auth", () => {
    const provider = oauthProviders["x.oauth2"];
    expect(provider.usePkce).toBe(true);
    expect(provider.tokenAuth).toBe("basic");

    const url = authorize("x.oauth2");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-value");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain("offline.access");
  });

  it("records the scopes X actually granted", () => {
    const secret = buildOAuthSecret({
      provider: oauthProviders["x.oauth2"],
      token: {
        accessToken: "at",
        scope: "tweet.read tweet.write users.read",
        raw: { scope: "tweet.read tweet.write users.read" },
      },
      query: new URLSearchParams(),
    });
    expect(secret.grantedScopes).toBe("tweet.read tweet.write users.read");
  });

  it("treats Shopify tokens as non-expiring", () => {
    // Shopify offline tokens have no expires_in. Without this flag the refresh
    // cron would see a null expiry and treat every store as already stale.
    expect(oauthProviders["shopify.oauth2"].tokensExpire).toBe(false);
    expect(oauthProviders["github.oauth2"].tokensExpire).toBe(false);
    expect(oauthProviders["notion.oauth2"].tokensExpire).toBe(false);
  });

  it("derives Shopify's endpoints from the shop domain", () => {
    const url = authorize(
      "shopify.oauth2",
      new URLSearchParams("shop=my-store"),
    );
    expect(url.origin + url.pathname).toBe(
      "https://my-store.myshopify.com/admin/oauth/authorize",
    );
    expect(
      oauthProviders["shopify.oauth2"].resolveUrls?.(
        new URLSearchParams("shop=https://my-store.myshopify.com/"),
      )?.tokenUrl,
    ).toBe("https://my-store.myshopify.com/admin/oauth/access_token");
  });

  it("refuses a shop parameter that is not a myshopify host", () => {
    // The shop decides the authorize ORIGIN. An unvalidated value would send
    // the user — and the client id — to any host an attacker chooses.
    for (const shop of [
      "evil.example.com",
      "my-store.myshopify.com.evil.example",
      "",
    ]) {
      expect(
        oauthProviders["shopify.oauth2"].resolveUrls?.(
          new URLSearchParams(`shop=${shop}`),
        ),
        `shop=${shop}`,
      ).toBeNull();
    }
  });

  it("captures Shopify's shop domain into the credential", () => {
    const secret = buildOAuthSecret({
      provider: oauthProviders["shopify.oauth2"],
      token: { accessToken: "at", raw: {} },
      query: new URLSearchParams("shop=my-store.myshopify.com"),
    });
    expect(secret.shopDomain).toBe("my-store.myshopify.com");
  });

  it("asks Atlassian for offline access and the api.atlassian.com audience", () => {
    const url = authorize("atlassian.oauth2");
    expect(url.searchParams.get("audience")).toBe("api.atlassian.com");
    expect(url.searchParams.get("scope")).toContain("offline_access");
  });

  it("sends Notion a JSON token body with Basic auth and no scopes", () => {
    const provider = oauthProviders["notion.oauth2"];
    expect(provider.tokenBodyFormat).toBe("json");
    expect(provider.tokenAuth).toBe("basic");
    expect(authorize("notion.oauth2").searchParams.get("owner")).toBe("user");
  });

  it("captures Notion's workspace identifiers from the token response", () => {
    const secret = buildOAuthSecret({
      provider: oauthProviders["notion.oauth2"],
      token: {
        accessToken: "at",
        raw: {
          workspace_id: "ws-1",
          workspace_name: "Acme",
          bot_id: "bot-1",
        },
      },
      query: new URLSearchParams(),
    });
    expect(secret).toMatchObject({
      workspaceId: "ws-1",
      workspaceName: "Acme",
      botId: "bot-1",
    });
  });

  it("uses a GitHub client separate from the sign-in app", () => {
    // Sharing the login app's client would silently widen what the sign-in
    // button asks every user to grant.
    expect(oauthProviders["github.oauth2"].clientId).toBe("github-id");
    expect(oauthProviders["github.oauth2"].defaultScopes).toContain("repo");
  });

  it("asks LinkedIn for the permission a post actually needs", () => {
    expect(authorize("linkedin.oauth2").searchParams.get("scope")).toContain(
      "w_member_social",
    );
  });

  it("declares every connect-time parameter it reads", () => {
    // A parameter the provider does not declare is dropped at connect time,
    // so a `resolveUrls`/`captureExtras` reading an undeclared key would work
    // in dev (same request) and fail after the redirect.
    expect(oauthProviders["shopify.oauth2"].connectParams).toContain("shop");
    expect(oauthProviders["intuit.oauth2"].connectParams).toContain(
      "environment",
    );
  });
});
