import "server-only";
import { NonRetriableError, RetryAfterError } from "inngest";
import type { CredentialSecret } from "@/features/credentials/server/vault";
import { serviceEndpoint } from "@/lib/server/service-endpoints";

/**
 * X (Twitter) v2 posting (AF-M10-22).
 *
 * The thing worth knowing before writing any of this: **v2 write endpoints are
 * not on the free tier.** A free-tier app authenticates fine, holds every
 * scope you asked for, and returns 403 on every post. That is why the node
 * carries an `accountRequirement` — it is the only one of these failures a
 * user cannot fix from inside the product, and a 403 alone reads like a scope
 * problem.
 *
 * Media upload is a *different API* on a different host with a different
 * protocol (chunked INIT/APPEND/FINALIZE), so this module posts text and
 * references media the caller has already uploaded rather than pretending the
 * two are one call.
 */

const REQUEST_TIMEOUT_MS = 30_000;

export interface XPost {
  id?: string;
  text?: string;
}

function classify(status: number, text: string, where: string): Error {
  let detail = "";
  try {
    const parsed = JSON.parse(text) as {
      title?: string;
      detail?: string;
      errors?: Array<{ message?: string }>;
    };
    detail =
      parsed.detail ??
      parsed.errors
        ?.map((e) => e.message)
        .filter(Boolean)
        .join("; ") ??
      parsed.title ??
      "";
  } catch {
    detail = text.slice(0, 200);
  }

  if (status === 401) {
    return new NonRetriableError(
      `${where}: X rejected the credential. Reconnect it — an X OAuth2 access token is short-lived and needs its refresh token to still be valid.`,
    );
  }

  if (status === 403) {
    // The one that is not a scope problem, however much it looks like one.
    return new NonRetriableError(
      `${where}: X refused the post (403)${detail ? `: ${detail}` : ""}. v2 write endpoints are not available on the free API tier — a free-tier app returns 403 no matter which scopes were granted. Check the app's tier before the scopes.`,
    );
  }

  if (status === 429) {
    // X's post limits are per 24 hours on the lower tiers, so a short retry is
    // usually pointless — but the header is authoritative when present.
    return new RetryAfterError(
      `${where}: X rate limit hit. Post limits on the lower tiers are counted per 24 hours, so this may not clear soon.`,
      900,
    );
  }

  if (status === 400) {
    return new NonRetriableError(
      `${where}: X rejected the post${detail ? `: ${detail}` : ""}.`,
    );
  }

  if (status >= 500) {
    return new RetryAfterError(`${where}: X is unavailable (${status}).`, 15);
  }

  return new NonRetriableError(
    `${where}: X refused the request (${status})${detail ? `: ${detail}` : ""}.`,
  );
}

/**
 * Count a post the way X does.
 *
 * X counts *weighted* characters, not JavaScript string length: emoji and
 * most non-Latin characters count as two. Using `.length` would let a post
 * through that X then rejects, and the rejection does not say by how much.
 * This is the conservative approximation — code points, with anything outside
 * the Basic Latin/Latin-1 ranges weighted 2 — which errs toward refusing early
 * rather than failing at the API.
 */
export function weightedLength(text: string): number {
  let total = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    total += code <= 0x10ff || (code >= 0x2000 && code <= 0x200d) ? 1 : 2;
  }
  return total;
}

export async function postToX(args: {
  secret: CredentialSecret | undefined;
  text: string;
  mediaIds?: string[];
  replyToId?: string;
  where: string;
}): Promise<XPost> {
  const accessToken = args.secret?.accessToken;
  if (!accessToken) {
    throw new NonRetriableError(
      `${args.where}: no X credential is bound to this node. Connect an X credential.`,
    );
  }

  const response = await fetch(`${serviceEndpoint("x")}/tweets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: args.text,
      ...(args.mediaIds && args.mediaIds.length > 0
        ? { media: { media_ids: args.mediaIds } }
        : {}),
      ...(args.replyToId
        ? { reply: { in_reply_to_tweet_id: args.replyToId } }
        : {}),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await response.text();
  if (!response.ok) {
    throw classify(response.status, text, args.where);
  }

  const parsed = JSON.parse(text) as { data?: XPost };
  if (!parsed.data?.id) {
    throw new NonRetriableError(
      `${args.where}: X accepted the request but returned no post id.`,
    );
  }
  return parsed.data;
}
