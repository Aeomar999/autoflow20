import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import {
  buildAuthorizeUrl,
  oauthProviders,
} from "@/features/credentials/server/oauth-providers";
import { signState } from "@/features/credentials/server/oauth-state";
import { auth } from "@/lib/auth";
import { publicAppUrl } from "@/lib/env";
import { resolveActiveOrg } from "@/trpc/init";

/** RFC 7636 S256 challenge from a fresh verifier. */
const pkcePair = () => {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return { codeVerifier, codeChallenge };
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const config = oauthProviders[provider];
  if (!config) {
    return new NextResponse("Provider not supported", { status: 400 });
  }

  if (!config.clientId || !config.clientSecret) {
    return new NextResponse("Provider not configured on this server", {
      status: 501,
    });
  }

  // AF-M10-03: the credential must land in the org the user is acting as.
  // Resolved here, while the app's own cookies are present, and carried
  // through the redirect in the signed state — the provider's callback arrives
  // with nothing of ours guaranteed to still select the same org.
  const org = await resolveActiveOrg(
    session.user.id,
    session.user.email,
    session.user.name,
  );

  const pkce = config.usePkce ? pkcePair() : undefined;

  // Only the parameters the provider declared are carried forward. An
  // allowlist, not the whole query string: the state is trusted at the
  // callback, so anything that rides it must be something a provider asked
  // for by name.
  const connectParams: Record<string, string> = {};
  for (const key of config.connectParams ?? []) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) {
      connectParams[key] = value;
    }
  }

  const stateToken = signState({
    userId: session.user.id,
    organizationId: org.id,
    providerId: provider,
    nonce: crypto.randomUUID(),
    codeVerifier: pkce?.codeVerifier,
    ...(Object.keys(connectParams).length > 0 ? { connectParams } : {}),
  });

  const redirectUri = `${publicAppUrl}/api/oauth/${provider}/callback`;

  // Providers whose endpoints live on the user's own host (Shopify) cannot
  // build an authorize URL without their connect-time parameters. Refuse here
  // with a readable message rather than redirecting to a malformed URL.
  if (config.resolveUrls && !config.resolveUrls(request.nextUrl.searchParams)) {
    return new NextResponse(
      `Provider "${provider}" needs additional connection parameters (e.g. the shop domain).`,
      { status: 400 },
    );
  }

  const url = buildAuthorizeUrl({
    provider: config,
    redirectUri,
    state: stateToken,
    codeChallenge: pkce?.codeChallenge,
    params: request.nextUrl.searchParams,
  });

  return NextResponse.redirect(url);
}
