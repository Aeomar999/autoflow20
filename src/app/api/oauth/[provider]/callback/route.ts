import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import {
  buildOAuthSecret,
  exchangeToken,
} from "@/features/credentials/server/oauth-exchange";
import { oauthProviders } from "@/features/credentials/server/oauth-providers";
import { verifyState } from "@/features/credentials/server/oauth-state";
import { sealSecret } from "@/features/credentials/server/vault";
import { auth } from "@/lib/auth";
import prisma from "@/lib/db";
import { publicAppUrl } from "@/lib/env";
import { resolveActiveOrg } from "@/trpc/init";

const back = (query: string) =>
  NextResponse.redirect(`${publicAppUrl}/credentials?${query}`);

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
    return back(`error=${encodeURIComponent(error)}`);
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

  // AF-M10-03: the org comes from the signed state, which was resolved while
  // the user's own session cookies were present. A state minted before the
  // field existed falls back to resolving it now, so a connection started
  // across a deploy still lands somewhere usable rather than nowhere.
  let organizationId = state.organizationId;
  if (!organizationId) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (session?.user.id === state.userId) {
      const org = await resolveActiveOrg(
        session.user.id,
        session.user.email,
        session.user.name,
      );
      organizationId = org.id;
    }
  }
  if (!organizationId) {
    return back("error=no_active_organization");
  }

  const redirectUri = `${publicAppUrl}/api/oauth/${provider}/callback`;

  // The provider echoes some identifiers back on the callback (Intuit's
  // realmId); others were chosen at connect time and only exist in the signed
  // state (Shopify's shop, Intuit's environment). Both are needed to build the
  // token URL and the credential's extras, so they are merged into one view.
  const callbackParams = new URLSearchParams(searchParams);
  for (const [key, value] of Object.entries(state.connectParams ?? {})) {
    if (!callbackParams.has(key)) {
      callbackParams.set(key, value);
    }
  }

  const tokenUrl = config.resolveUrls?.(callbackParams)?.tokenUrl;

  let token: Awaited<ReturnType<typeof exchangeToken>>;
  try {
    token = await exchangeToken({
      provider: config,
      tokenUrl,
      body: {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        ...(state.codeVerifier ? { code_verifier: state.codeVerifier } : {}),
      },
    });
  } catch (exchangeError) {
    console.error(
      `OAuth token exchange failed for ${provider}:`,
      exchangeError instanceof Error ? exchangeError.message : exchangeError,
    );
    return back("error=token_exchange_failed");
  }

  // A connection that needs a second call to be usable makes it now, and a
  // failure fails the connect. Storing a credential that every node will
  // reject at run time only moves the error somewhere less obvious.
  let postExchangeExtras: Record<string, string> = {};
  if (config.postExchange) {
    try {
      postExchangeExtras = await config.postExchange({
        accessToken: token.accessToken,
      });
    } catch (postError) {
      console.error(
        `OAuth post-exchange failed for ${provider}:`,
        postError instanceof Error ? postError.message : postError,
      );
      return back("error=post_exchange_failed");
    }
  }

  const secretPayload = {
    ...buildOAuthSecret({
      provider: config,
      token,
      query: callbackParams,
    }),
    ...postExchangeExtras,
  };

  const envelope = sealSecret(secretPayload);
  const preview = "••••••••";
  const oauthExpiresAt =
    config.tokensExpire === false || !token.expiresIn
      ? null
      : new Date(Date.now() + token.expiresIn * 1000);

  // One credential per (org, provider). Scoped to the org, not just the user:
  // two members connecting Google for the same workspace should update one
  // connection, and a user in two orgs must get one credential per org.
  const existing = await prisma.credential.findFirst({
    where: { organizationId, type: provider },
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
    await prisma.credential.create({
      data: {
        name: config.label,
        type: provider,
        userId: state.userId,
        organizationId,
        ...envelope,
        preview,
        oauthExpiresAt,
      },
    });
  }

  return back("success=oauth_connected");
}
