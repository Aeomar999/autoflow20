import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { oauthProviders } from "@/features/credentials/server/oauth-providers";
import { signState } from "@/features/credentials/server/oauth-state";
import { auth } from "@/lib/auth";
import { publicAppUrl } from "@/lib/env";

export async function GET(
  _request: NextRequest,
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

  const stateToken = signState({
    userId: session.user.id,
    providerId: provider,
    nonce: crypto.randomUUID(),
  });

  const redirectUri = `${publicAppUrl}/api/oauth/${provider}/callback`;

  const url = new URL(config.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", config.defaultScopes);
  url.searchParams.set("state", stateToken);

  // Some providers require access_type=offline and prompt=consent to get a refresh token
  if (provider === "google.oauth2") {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
  }

  return NextResponse.redirect(url.toString());
}
