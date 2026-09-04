# OAuth Workflow Connectors — Setup Manual

AF-M10-04 added seven OAuth providers to AutoFlow's credential vault (on top of
the existing Google and Slack connectors, for nine total). Each provider is a
standalone entry in `src/features/credentials/server/oauth-providers.ts`; adding
a new provider means adding a new object, not another `if` branch.

This manual covers every provider, the env vars each requires, the quirks that
trip people up, and how to verify a connection is alive.

---

## Table of Contents

1. [How the system works](#1-how-the-system-works)
2. [Redirect URIs](#2-redirect-uris)
3. [Provider-by-provider setup](#3-provider-by-provider-setup)
   - [Google (5 variants)](#google-5-variants)
   - [Slack](#slack)
   - [Intuit (QuickBooks Online)](#intuit-quickbooks-online)
   - [GitHub](#github)
   - [Atlassian (Jira Cloud)](#atlassian-jira-cloud)
   - [Notion](#notion)
   - [Shopify](#shopify)
   - [LinkedIn](#linkedin)
   - [X (Twitter)](#x-twitter)
4. [Environment variable reference](#4-environment-variable-reference)
5. [Provider extras captured in the credential](#5-provider-extras-captured-in-the-credential)
6. [How refresh works](#6-how-refresh-works)
7. [Troubleshooting](#7-troubleshooting)
8. [Adding a new provider](#8-adding-a-new-provider)

---

## 1. How the system works

The OAuth flow has three phases:

1. **Connect** (`/api/oauth/<provider>/connect`): the user clicks "Connect"
   in the credentials UI. The route builds an authorize URL and redirects the
   user to the provider. A signed state token (HMAC-SHA256, keyed by
   `CREDENTIAL_MASTER_KEY`) carries the user id, the active organization, and
   any connect-time parameters through the redirect.

2. **Callback** (`/api/oauth/<provider>/callback`): the provider redirects back
   with an authorization `code` and (for some providers) extra query parameters.
   The callback route verifies the state, exchanges the code for tokens, runs
   any `postExchange` step (Atlassian's cloudId lookup), seals the secret with
   the vault, and upserts one credential per `(org, provider)`.

3. **Refresh** (Inngest cron): tokens with an expiry are refreshed
   automatically. Intuit's refresh token rotates on every exchange; Shopify,
   GitHub, and Notion tokens never expire.

Each provider declares:
- `tokenAuth`: `"body"` (default) or `"basic"` — how client credentials reach
  the token endpoint.
- `tokenBodyFormat`: `"form"` (default) or `"json"` — Notion requires JSON.
- `usePkce`: `true` for X; harmless elsewhere but some providers reject the
  stray `code_challenge`.
- `tokensExpire`: `false` for GitHub, Notion, Shopify — the refresh cron skips
  them.
- `rotatesRefreshToken`: `true` for Intuit — the old refresh token dies
  immediately when a new one is issued.
- `captureExtras`: extracts provider-specific identifiers (Intuit's `realmId`,
  Shopify's `shop`, X's `scope`) into the sealed secret.
- `connectParams`: parameters declared at connect time and carried through the
  signed state (Intuit's `environment`, Shopify's `shop`).
- `postExchange`: a second API call needed after the token exchange (Atlassian's
  cloudId).
- `resolveUrls`: builds authorize/token URLs dynamically from connect-time
  params (Shopify's per-merchant domain).

---

## 2. Redirect URIs

Every provider needs a redirect URI registered in its OAuth app settings. The
pattern is:

```
<NEXT_PUBLIC_APP_URL>/api/oauth/<credential-type>/callback
```

For local dev with `NEXT_PUBLIC_APP_URL=http://localhost:3000`:

| Provider      | Redirect URI                                              |
|---------------|----------------------------------------------------------|
| Google (all)  | `http://localhost:3000/api/oauth/google.sheets/callback` |
| Slack         | `http://localhost:3000/api/oauth/slack.oauth2/callback`  |
| Intuit        | `http://localhost:3000/api/oauth/intuit.oauth2/callback` |
| GitHub        | `http://localhost:3000/api/oauth/github.oauth2/callback` |
| Atlassian     | `http://localhost:3000/api/oauth/atlassian.oauth2/callback` |
| Notion        | `http://localhost:3000/api/oauth/notion.oauth2/callback` |
| Shopify       | `http://localhost:3000/api/oauth/shopify.oauth2/callback` |
| LinkedIn      | `http://localhost:3000/api/oauth/linkedin.oauth2/callback` |
| X             | `http://localhost:3000/api/oauth/x.oauth2/callback`      |

Google uses the same OAuth app for all five variants; you only register one
redirect URI — the callback route resolves which credential type from the URL
path.

---

## 3. Provider-by-provider setup

### Google (5 variants)

**Env vars:**
```
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
```

**Google Cloud Console setup:**
1. Go to https://console.cloud.google.com/apis/credentials
2. Create an OAuth 2.0 Client ID (type: Web Application)
3. Add `http://localhost:3000/api/oauth/google.sheets/callback` as an
   Authorized redirect URI (one URI covers all five variants)
4. Enable the APIs your workflows need (Sheets API, Gmail API, Drive API,
   Calendar API, Docs API) under Library

**Scopes per variant:**

| Credential type   | Scopes                                                                |
|-------------------|-----------------------------------------------------------------------|
| `google.oauth2`   | `userinfo.email` (deprecated, ADR-0023 — kept for old credentials)    |
| `google.sheets`   | `spreadsheets`                                                        |
| `google.gmail`    | `gmail.readonly`, `gmail.send`, `gmail.modify`                        |
| `google.drive`    | `drive` (full, not `drive.file` — ADR-0023)                          |
| `google.calendar` | `calendar.readonly`                                                   |
| `google.docs`     | `documents`, `drive.readonly`                                         |

**Quirks:**
- `access_type=offline` and `prompt=consent` are always sent. Without
  `prompt=consent`, re-authorizing an already-granted client returns an access
  token and **no** refresh token, and the credential silently dies in an hour.
- `google.oauth2` is deprecated (ADR-0023). Old credentials referencing it
  still refresh. New connections must use the scoped variant.
- Google Drive uses the full `drive` scope, not `drive.file`, because
  `drive.file` only sees files this app created — watch-folder automations
  are impossible under it.

---

### Slack

**Env vars:**
```
SLACK_CLIENT_ID=""
SLACK_CLIENT_SECRET=""
```

**Slack API setup:**
1. Go to https://api.slack.com/apps → Create New App → From scratch
2. Under OAuth & Permissions, add the required scopes (Bot Token Scopes)
3. Install to workspace
4. The `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` come from Basic Information

**Default scopes:** `chat:write`, `chat:write.public`, `channels:read`,
`channels:manage`, `groups:read`, `users:read`, `users:read.email`,
`im:write`

**Quirk:** Slack's token endpoint may return form-encoded even when
`Accept: application/json` is set. The exchange parser handles this by
falling back to URLSearchParams parsing.

---

### Intuit (QuickBooks Online)

**Env vars:**
```
INTUIT_CLIENT_ID=""
INTUIT_CLIENT_SECRET=""
```

**Intuit Developer setup:**
1. Go to https://developer.intuit.com/app/developer/dashboard
2. Create an app → OAuth 2.0
3. Set redirect URI to `http://localhost:3000/api/oauth/intuit.oauth2/callback`
4. Enable scopes: `com.intuit.quickbooks.accounting`
5. For testing: create a sandbox company in QuickBooks Online Accountant

**Quirks (three of them):**

1. **Rotating refresh token.** Intuit invalidates the old refresh token the
   moment it issues a new one. The refresh job must persist the new token in
   the same write — there is no second chance. The `rotatesRefreshToken: true`
   flag on the provider ensures this.

2. **`realmId` arrives on the callback query, not in the token response.**
   Every QBO API call needs it in the URL path. The `captureExtras` function
   extracts it automatically — without it the connection is unusable and the
   user would have to paste the company id into every node.

3. **Sandbox vs. production.** The `environment` parameter is a connect-time
   choice (passed via `?environment=sandbox` or `?environment=production`).
   It decides the API base URL and is stored in the credential. Default is
   production.

**Token auth:** HTTP Basic (`tokenAuth: "basic"`). The body form returns an
opaque `invalid_client` error when credentials are sent in the body — this
looks like wrong credentials but is actually a protocol mismatch.

---

### GitHub

**Env vars:**
```
GITHUB_OAUTH_CLIENT_ID=""
GITHUB_OAUTH_CLIENT_SECRET=""
```

**IMPORTANT:** These are a *different* GitHub OAuth app from the sign-in app
(`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`). Connecting a workflow
integration must not widen what the login button asks for.

**GitHub Developer setup:**
1. Go to https://github.com/settings/developers → OAuth Apps → New OAuth App
2. Set authorization callback URL to
   `http://localhost:3000/api/oauth/github.oauth2/callback`
3. Scopes: `repo`, `read:org`

**Default scopes:** `repo read:org`

**Quirks:**
- Classic OAuth-app tokens do not expire unless the app opts in
  (`tokensExpire: false`). The refresh cron skips this provider.
- The credential is org-scoped: two members connecting GitHub for the same
  workspace update one connection.

---

### Atlassian (Jira Cloud)

**Env vars:**
```
ATLASSIAN_CLIENT_ID=""
ATLASSIAN_CLIENT_SECRET=""
```

**Atlassian Developer setup:**
1. Go to https://developer.atlassian.com/console/myapps/
2. Create an OAuth 2.0 app (3LO)
3. Set redirect URI to
   `http://localhost:3000/api/oauth/atlassian.oauth2/callback`
4. Enable API scopes: `read:jira-work`, `write:jira-work`, `read:jira-user`,
   `manage:jira-project`, `offline_access`
5. Enable the Jira API in the app's API permissions

**Default scopes:** `read:jira-work write:jira-work read:jira-user
manage:jira-project offline_access`

**Quirks:**

1. **`offline_access` is mandatory.** Without it Atlassian issues no refresh
   token and the credential dies when the access token expires.

2. **`cloudId` is not in the token response.** After the token exchange, a
   `postExchange` step calls `GET /oauth/token/accessible-resources` to fetch
   the Jira site's `cloudId` (and optionally `siteUrl`). This is stored in the
   credential — every Jira v3 REST path needs it. If this call fails, the
   entire connection fails (storing a credential without `cloudId` would make
   every Jira node reject it at runtime with an opaque error).

3. **`prompt: consent`** and **`audience: api.atlassian.com`** are always sent.
   Without `prompt: consent` the consent screen may not show the scope picker.

---

### Notion

**Env vars:**
```
NOTION_CLIENT_ID=""
NOTION_CLIENT_SECRET=""
```

**Notion integration setup:**
1. Go to https://www.notion.so/my-integrations
2. Create a new integration → capabilities: Read/Update/Insert content
3. Set redirect URI to
   `http://localhost:3000/api/oauth/notion.oauth2/callback`
4. Notion has no scopes — access is decided by the pages the user picks on the
   consent screen

**Default scopes:** (empty — Notion does not use OAuth scopes)

**Quirks:**

1. **No scopes.** The authorize URL omits the `scope` parameter entirely. The
   user picks which pages to share on the Notion consent screen.

2. **JSON-only token endpoint.** Notion's `/v1/oauth/token` rejects
   `application/x-www-form-urlencoded` with `invalid_request`. The provider
   declares `tokenBodyFormat: "json"`.

3. **HTTP Basic token auth.** Like Intuit and X, Notion requires client
   credentials in the `Authorization: Basic` header, not in the body.

4. **Non-expiring tokens.** `tokensExpire: false` — the refresh cron skips
   this provider.

5. **Workspace identifiers captured.** `captureExtras` extracts `workspaceId`,
   `workspaceName`, and `botId` from the token response.

---

### Shopify

**Env vars:**
```
SHOPIFY_CLIENT_ID=""
SHOPIFY_CLIENT_SECRET=""
```

**Shopify Partners setup:**
1. Go to https://partners.shopify.com → Apps → Create app
2. Set App URL and allowed redirect URL to
   `http://localhost:3000/api/oauth/shopify.oauth2/callback`
3. Scopes: `read_orders`, `write_orders`, `read_products`, `read_customers`,
   `write_customers`

**Connect-time parameter:** `?shop=<store>.myshopify.com` — the authorize
and token URLs are derived from this.

**Quirks (the most unusual provider):**

1. **Dynamic URLs.** Authorize and token endpoints live on the merchant's own
   domain (`https://<shop>.myshopify.com/admin/oauth/authorize`). The
   `resolveUrls` function builds them from the `shop` parameter. If the shop
   parameter is missing or invalid, the connect route refuses with a 400.

2. **Non-expiring tokens.** Shopify offline access tokens never expire.
   `tokensExpire: false`.

3. **Shop domain validation.** Only `*.myshopify.com` hosts are accepted.
   `my-store`, `my-store.myshopify.com`, and
   `https://my-store.myshopify.com/` all normalize to `my-store.myshopify.com`.
   Arbitrary domains like `evil.example.com` are rejected — the shop decides
   the authorize origin, so an unvalidated value would send the user and the
   client id to any host.

4. **`shopDomain` captured.** The store's host is stored in the credential
   secret.

---

### LinkedIn

**Env vars:**
```
LINKEDIN_CLIENT_ID=""
LINKEDIN_CLIENT_SECRET=""
```

**LinkedIn Developer setup:**
1. Go to https://www.linkedin.com/developers/apps → Create app
2. Under Products, enable **Share on LinkedIn** and **Sign In with LinkedIn**
   using OpenID Connect
3. Under Auth, set redirect URL to
   `http://localhost:3000/api/oauth/linkedin.oauth2/callback`
4. Scopes: `openid`, `profile`, `w_member_social`

**Default scopes:** `openid profile w_member_social`

**Quirks:**
- `w_member_social` is the post-on-behalf-of permission; it requires the
  **Share on LinkedIn** product to be enabled on the app, not just the scope
  in the OAuth flow.
- `openid profile` yields the member URN a UGC post must be authored by.
- Standard OAuth body token exchange (no special `tokenAuth` or format).

---

### X (Twitter)

**Env vars:**
```
X_CLIENT_ID=""
X_CLIENT_SECRET=""
```

**X Developer setup:**
1. Go to https://developer.x.com/en/portal/dashboard
2. Create a project and app → User authentication settings
3. Set Type of App: **Web App, Automated App or Bot**
4. Set Callback URI to
   `http://localhost:3000/api/oauth/x.oauth2/callback`
5. Website URL: your app URL
6. Scopes: `tweet.read`, `tweet.write`, `users.read`, `offline.access`
7. Enable OAuth 2.0 with PKCE

**Default scopes:** `tweet.read tweet.write users.read offline.access`

**Quirks (the most restrictive provider):**

1. **PKCE is mandatory.** The authorize endpoint rejects requests without a
   `code_challenge`. The connect route generates an S256 challenge automatically
   when `usePkce: true`.

2. **HTTP Basic token auth.** Like Intuit and Notion, X requires client
   credentials in the `Authorization: Basic` header.

3. **Write access is NOT on the free tier.** A token that authorizes fine will
   still 403 on a tweet post unless the developer account has elevated access.
   This is a billing issue on the X developer side, not an AutoFlow bug.

4. **`offline.access` scope is required** for a refresh token to be returned.

5. **Granted scopes captured.** X may grant a subset of the requested scopes.
   `captureExtras` stores `grantedScopes` in the credential so the UI can
   show what was actually authorized.

---

## 4. Environment variable reference

| Variable                    | Provider   | Notes                                          |
|-----------------------------|-----------|------------------------------------------------|
| `GOOGLE_CLIENT_ID`          | Google    | One app for all 5 variants                     |
| `GOOGLE_CLIENT_SECRET`      | Google    |                                                |
| `SLACK_CLIENT_ID`           | Slack     |                                                |
| `SLACK_CLIENT_SECRET`       | Slack     |                                                |
| `INTUIT_CLIENT_ID`          | Intuit    |                                                |
| `INTUIT_CLIENT_SECRET`      | Intuit    |                                                |
| `GITHUB_OAUTH_CLIENT_ID`    | GitHub    | Different from `GITHUB_CLIENT_ID` (sign-in)   |
| `GITHUB_OAUTH_CLIENT_SECRET`| GitHub    |                                                |
| `ATLASSIAN_CLIENT_ID`       | Atlassian |                                                |
| `ATLASSIAN_CLIENT_SECRET`   | Atlassian |                                                |
| `NOTION_CLIENT_ID`          | Notion    |                                                |
| `NOTION_CLIENT_SECRET`      | Notion    |                                                |
| `SHOPIFY_CLIENT_ID`         | Shopify   |                                                |
| `SHOPIFY_CLIENT_SECRET`     | Shopify   |                                                |
| `LINKEDIN_CLIENT_ID`        | LinkedIn  |                                                |
| `LINKEDIN_CLIENT_SECRET`    | LinkedIn  |                                                |
| `X_CLIENT_ID`               | X         |                                                |
| `X_CLIENT_SECRET`           | X         |                                                |
| `CREDENTIAL_MASTER_KEY`     | All       | Required. 32 bytes, base64-encoded. Used for    |
|                             |           | vault encryption and state signing.             |

All provider env vars are optional. A provider whose pair is unset returns 501
from its connect route and nothing else in the app is affected.

---

## 5. Provider extras captured in the credential

| Provider   | Extras stored in the sealed secret                           |
|-----------|--------------------------------------------------------------|
| Intuit    | `realmId` (company id), `environment` (sandbox/production)  |
| Notion    | `workspaceId`, `workspaceName`, `botId`                     |
| Shopify   | `shopDomain` (e.g. `my-store.myshopify.com`)                |
| X         | `grantedScopes` (what was actually authorized)              |
| Atlassian | `cloudId`, `siteUrl` (from postExchange)                    |
| Others    | (none — standard `accessToken`/`refreshToken`/`scopes`)     |

These extras are stored alongside the access/refresh tokens inside the sealed
vault. They are never returned to the client.

---

## 6. How refresh works

- **Tokens that expire** (Google, Slack, Intuit, Atlassian, LinkedIn, X):
  the Inngest cron checks `oauthExpiresAt` and refreshes before expiry.

- **Tokens that rotate** (Intuit only): the refresh response replaces the
  stored refresh token. The old one is invalid immediately — if the write
  fails, the connection is lost.

- **Tokens that never expire** (GitHub, Notion, Shopify): `tokensExpire: false`
  tells the cron to skip them entirely.

---

## 7. Troubleshooting

### "Provider not configured on this server" (501)
The env vars for that provider are not set. Add them to `.env` and restart.

### "Provider rejected the token request: 401 invalid_client"
The client id/secret are wrong, or the provider requires HTTP Basic auth
and they were sent in the body instead. Check `tokenAuth` on the provider
definition (Intuit, Notion, and X require `"basic"`).

### "Provider rejected the token request: 400 invalid_request"
Notion's token endpoint returns this when the body is form-encoded instead
of JSON. This should not happen if the provider is correctly configured —
check `tokenBodyFormat`.

### "Atlassian: the authorizing account has no accessible Jira site."
The user's Atlassian account has no Jira site. They need to create one at
https://www.atlassian.com/software/jira first.

### "State token has expired"
The user took more than 15 minutes to complete the authorization. Start
the connection again.

### Intuit connection stops working after a few hours
The refresh token was not persisted after rotation. This is a bug in the
refresh job, not a configuration issue — check logs for refresh errors.

### Shopify: "Provider ... needs additional connection parameters"
The `?shop=<store>` parameter was not included in the connect URL. Shopify
requires it to derive the authorize/token URLs.

### X: 403 on tweet post despite successful connection
Write access requires a paid X API tier. The connection is valid; the
authorization is insufficient for the operation.

---

## 8. Adding a new provider

1. Add an entry to `oauthProviders` in
   `src/features/credentials/server/oauth-providers.ts`
2. Register the credential type in
   `src/features/credentials/credential-types.ts`
3. Add env vars to `src/lib/env.ts` (with `z.string().optional()`) and
   `.env.example`
4. If the provider captures extras, add a `captureExtras` function
5. If the provider needs a post-exchange step (like Atlassian), add
   `postExchange`
6. If URLs are dynamic (like Shopify), add `resolveUrls` and `connectParams`
7. Write tests in `src/features/credentials/server/oauth.test.ts`
8. Update `docs/operations/oauth_connectors_setup.md` (this file)
