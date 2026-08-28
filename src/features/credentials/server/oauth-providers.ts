import { ensureEnv } from "@/lib/env";

export interface OAuthProvider {
  id: string;
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string | undefined;
  clientSecret: string | undefined;
  defaultScopes: string;
}

export const oauthProviders: Record<string, OAuthProvider> = {
  "google.oauth2": {
    id: "google.oauth2",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    get clientId() {
      return ensureEnv().GOOGLE_CLIENT_ID;
    },
    get clientSecret() {
      return ensureEnv().GOOGLE_CLIENT_SECRET;
    },
    defaultScopes: "https://www.googleapis.com/auth/userinfo.email",
  },
  "slack.oauth2": {
    id: "slack.oauth2",
    authorizeUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    get clientId() {
      return process.env.SLACK_CLIENT_ID;
    },
    get clientSecret() {
      return process.env.SLACK_CLIENT_SECRET;
    },
    defaultScopes: "chat:write channels:read",
  },
};
