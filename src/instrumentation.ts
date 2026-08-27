import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureEnv } = await import("./lib/env");
    ensureEnv();
    if (process.env.SKIP_ENV_VALIDATION !== "1") {
      const { assertCredentialMasterKey } = await import("./lib/crypto");
      assertCredentialMasterKey(process.env.CREDENTIAL_MASTER_KEY);
    }
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
