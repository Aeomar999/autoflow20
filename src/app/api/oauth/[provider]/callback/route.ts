import { type NextRequest, NextResponse } from "next/server";
import { oauthProviders } from "@/features/credentials/server/oauth-providers";
import { verifyState } from "@/features/credentials/server/oauth-state";
import { sealSecret } from "@/features/credentials/server/vault";
import prisma from "@/lib/db";
import { publicAppUrl } from "@/lib/env";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const stateToken = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(`${publicAppUrl}/credentials?error=${error}`);
  }

  if (!code || !stateToken) {
    return new NextResponse("Missing code or state", { status: 400 });
  }

  let state: ReturnType<typeof verifyState>;
  try {
    state = verifyState(stateToken);
  } catch (_e) {
    return new NextResponse("Invalid state token", { status: 400 });
  }

  if (state.providerId !== provider) {
    return new NextResponse("Provider mismatch", { status: 400 });
  }

  const config = oauthProviders[provider];
  if (!config || !config.clientId || !config.clientSecret) {
    return new NextResponse("Provider not configured", { status: 501 });
  }

  const redirectUri = `${publicAppUrl}/api/oauth/${provider}/callback`;

  // Exchange code for token
  const tokenParams = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri,
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
    console.error(`OAuth token exchange failed for ${provider}:`, errText);
    return NextResponse.redirect(
      `${publicAppUrl}/credentials?error=token_exchange_failed`,
    );
  }

  const tokenData = await response.json();
  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token;
  const expiresIn = tokenData.expires_in;

  if (!accessToken) {
    return NextResponse.redirect(
      `${publicAppUrl}/credentials?error=missing_access_token`,
    );
  }

  const oauthExpiresAt = expiresIn
    ? new Date(Date.now() + expiresIn * 1000)
    : null;

  const secretPayload: Record<string, string> = {
    accessToken,
  };
  if (refreshToken) {
    secretPayload.refreshToken = refreshToken;
  }
  if (tokenData.scope) {
    secretPayload.scopes = tokenData.scope;
  }

  const envelope = sealSecret(secretPayload);
  const preview = "••••••••";

  // Check if we already have a credential for this provider+user
  const existing = await prisma.credential.findFirst({
    where: {
      userId: state.userId,
      type: provider,
    },
  });

  if (existing) {
    await prisma.credential.update({
      where: { id: existing.id },
      data: {
        ...envelope,
        preview,
        oauthExpiresAt,
        refreshError: null,
      },
    });
  } else {
    // Determine a nice name
    let name = "OAuth Credential";
    if (provider === "google.oauth2") name = "Google Account";
    if (provider === "slack.oauth2") name = "Slack Workspace";

    await prisma.credential.create({
      data: {
        name,
        type: provider,
        userId: state.userId,
        ...envelope,
        preview,
        oauthExpiresAt,
      },
    });
  }

  return NextResponse.redirect(
    `${publicAppUrl}/credentials?success=oauth_connected`,
  );
}
