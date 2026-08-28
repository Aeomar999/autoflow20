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

          const tokenParams = new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            client_id: config.clientId,
            client_secret: config.clientSecret,
          });

          const response = await fetch(config.tokenUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
            },
            body: tokenParams.toString(),
          });

          if (!response.ok) {
            const errText = await response.text();
            throw new Error(
              `Provider rejected refresh: ${response.status} ${errText}`,
            );
          }

          const tokenData = await response.json();
          const accessToken = tokenData.access_token;
          const newRefreshToken = tokenData.refresh_token || refreshToken; // keep old if not rotated
          const expiresIn = tokenData.expires_in;

          if (!accessToken) {
            throw new Error("Provider did not return an access token");
          }

          const newPayload = {
            ...secretPayload,
            accessToken,
            refreshToken: newRefreshToken,
          };

          const envelope = sealSecret(newPayload);
          const oauthExpiresAt = expiresIn
            ? new Date(Date.now() + expiresIn * 1000)
            : null;

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
