import {
  buildOAuthSecret,
  exchangeToken,
} from "@/features/credentials/server/oauth-exchange";
import { oauthProviders } from "@/features/credentials/server/oauth-providers";
import { openSecret, sealSecret } from "@/features/credentials/server/vault";
import prisma from "@/lib/db";
import { inngest } from "./client";

export const refreshOAuthTokens = inngest.createFunction(
  {
    id: "refresh-oauth-tokens",
    // Prevent overlapping runs if it takes too long
    concurrency: [{ limit: 1 }],
  },
  { cron: "*/15 * * * *" }, // Every 15 minutes
  async ({ step }) => {
    // Find credentials expiring within the next 30 minutes
    const threshold = new Date(Date.now() + 30 * 60 * 1000);

    const expiringCredentials = await step.run("find-expiring", async () => {
      return prisma.credential.findMany({
        where: {
          oauthExpiresAt: {
            lte: threshold,
          },
          // Only attempt refresh if not already failing
          refreshError: null,
        },
      });
    });

    for (const cred of expiringCredentials) {
      await step.run(`refresh-${cred.id}`, async () => {
        const config = oauthProviders[cred.type];
        if (!config || !config.clientId || !config.clientSecret) {
          // Can't refresh if provider is unknown or not configured
          await prisma.credential.update({
            where: { id: cred.id },
            data: { refreshError: "OAuth provider is not configured" },
          });
          return;
        }

        try {
          const secretPayload = openSecret(cred);
          const refreshToken = secretPayload.refreshToken;

          if (!refreshToken) {
            await prisma.credential.update({
              where: { id: cred.id },
              data: { refreshError: "No refresh token available" },
            });
            return;
          }

          const token = await exchangeToken({
            provider: config,
            body: {
              grant_type: "refresh_token",
              refresh_token: refreshToken,
            },
          });

          /**
           * `previous` carries the fields a refresh does not return —
           * provider extras like Intuit's `realmId`, and the existing refresh
           * token for providers that do not rotate one.
           *
           * For providers that DO rotate (Intuit invalidates the old refresh
           * token the moment it issues a new one), `buildOAuthSecret` writes
           * the returned token over the previous one and the update below
           * persists it in the same statement. There is no second chance: a
           * process that reads a new refresh token and fails to store it has
           * lost the connection, and the user has to reconnect by hand.
           */
          const newPayload = buildOAuthSecret({
            provider: config,
            token,
            query: new URLSearchParams(),
            previous: secretPayload,
          });

          const envelope = sealSecret(newPayload);
          const oauthExpiresAt =
            config.tokensExpire === false || !token.expiresIn
              ? null
              : new Date(Date.now() + token.expiresIn * 1000);

          await prisma.credential.update({
            where: { id: cred.id },
            data: {
              ...envelope,
              oauthExpiresAt,
              refreshError: null,
            },
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : "Unknown error";
          await prisma.credential.update({
            where: { id: cred.id },
            data: { refreshError: msg },
          });
        }
      });
    }

    return { refreshed: expiringCredentials.length };
  },
);
