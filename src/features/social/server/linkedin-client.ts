import "server-only";
import { NonRetriableError, RetryAfterError } from "inngest";
import type { CredentialSecret } from "@/features/credentials/server/vault";
import { uploadStoredFile } from "./upload-stream";

/**
 * LinkedIn UGC posting (AF-M10-22).
 *
 * Posting an image is a **three-step dance**, and every step can fail in a way
 * that looks like the others:
 *
 *  1. `registerUpload` — ask LinkedIn where to put the bytes. Returns a
 *     one-time upload URL and an *asset URN*.
 *  2. PUT the bytes to that URL. This is a different host with different auth
 *     rules, and it answers 201 with an empty body.
 *  3. Create the UGC post referencing the asset URN.
 *
 * Doing 3 before 2 finishes produces a post with a broken image and no error,
 * which is why this is one function rather than three the caller sequences.
 */

const LINKEDIN_API = "https://api.linkedin.com/v2";
const REQUEST_TIMEOUT_MS = 30_000;

/** LinkedIn's own image ceiling. */
export const LINKEDIN_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function classify(status: number, text: string, where: string): Error {
  let message = "";
  try {
    const parsed = JSON.parse(text) as { message?: string };
    message = parsed.message ?? "";
  } catch {
    message = text.slice(0, 200);
  }

  if (status === 401) {
    return new NonRetriableError(
      `${where}: LinkedIn rejected the credential. Reconnect it — LinkedIn access tokens expire after 60 days and are not refreshed silently.`,
    );
  }

  if (status === 403) {
    return new NonRetriableError(
      `${where}: LinkedIn refused the post${message ? `: ${message}` : ""}. The app must be approved for the "Share on LinkedIn" product and the account must have granted w_member_social — neither is something reconnecting fixes.`,
    );
  }

  if (status === 422) {
    return new NonRetriableError(
      `${where}: LinkedIn rejected the post as invalid${message ? `: ${message}` : ""}.`,
    );
  }

  if (status === 429) {
    return new RetryAfterError(
      `${where}: LinkedIn rate limit hit (its daily quota is per app, not per user).`,
      300,
    );
  }

  if (status >= 500) {
    return new RetryAfterError(
      `${where}: LinkedIn is unavailable (${status}).`,
      15,
    );
  }

  return new NonRetriableError(
    `${where}: LinkedIn refused the request (${status})${message ? `: ${message}` : ""}.`,
  );
}

async function linkedinFetch<T>(
  accessToken: string,
  request: {
    path: string;
    method?: "GET" | "POST";
    body?: unknown;
    where: string;
  },
): Promise<T> {
  const response = await fetch(`${LINKEDIN_API}${request.path}`, {
    method: request.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      // Required on every v2 call. Without it LinkedIn applies legacy response
      // shaping and several fields come back under different names.
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: request.body ? JSON.stringify(request.body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await response.text();
  if (!response.ok) throw classify(response.status, text, request.where);

  return (text.length > 0 ? JSON.parse(text) : {}) as T;
}

/** The author URN a post is attributed to. */
export function requireAuthor(
  secret: CredentialSecret | undefined,
  where: string,
): { accessToken: string; authorUrn: string } {
  const accessToken = secret?.accessToken;
  if (!accessToken) {
    throw new NonRetriableError(
      `${where}: no LinkedIn credential is bound to this node. Connect a LinkedIn credential.`,
    );
  }

  // The member id is captured at connect time. Without it a post cannot be
  // attributed to anyone, and LinkedIn's error for a missing author is a 422
  // about the request body.
  const memberId = secret?.memberId ?? secret?.sub ?? secret?.personUrn;
  if (!memberId) {
    throw new NonRetriableError(
      `${where}: the LinkedIn credential has no member id. Reconnect it so the account it posts as can be resolved.`,
    );
  }

  return {
    accessToken,
    authorUrn: memberId.startsWith("urn:")
      ? memberId
      : `urn:li:person:${memberId}`,
  };
}

/**
 * Register, upload and return the asset URN — steps 1 and 2.
 *
 * The bytes are streamed from the blob store, so an image never lands in
 * worker memory whole.
 */
export async function uploadLinkedInImage(args: {
  accessToken: string;
  authorUrn: string;
  fileId: string;
  organizationId: string;
  where: string;
}): Promise<string> {
  const registration = await linkedinFetch<{
    value?: {
      asset?: string;
      uploadMechanism?: Record<string, { uploadUrl?: string }>;
    };
  }>(args.accessToken, {
    path: "/assets?action=registerUpload",
    method: "POST",
    body: {
      registerUploadRequest: {
        owner: args.authorUrn,
        recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
        serviceRelationships: [
          {
            identifier: "urn:li:userGeneratedContent",
            relationshipType: "OWNER",
          },
        ],
      },
    },
    where: args.where,
  });

  const asset = registration.value?.asset;
  // The upload URL is nested under a long, versioned key. Reading the first
  // value rather than hardcoding the key means a version bump does not break
  // this with a "cannot read property of undefined".
  const uploadUrl = Object.values(registration.value?.uploadMechanism ?? {})[0]
    ?.uploadUrl;

  if (!asset || !uploadUrl) {
    throw new NonRetriableError(
      `${args.where}: LinkedIn accepted the upload registration but returned no upload URL.`,
    );
  }

  const upload = await uploadStoredFile({
    url: uploadUrl,
    method: "PUT",
    headers: { Authorization: `Bearer ${args.accessToken}` },
    fileId: args.fileId,
    organizationId: args.organizationId,
    maxBytes: LINKEDIN_MAX_IMAGE_BYTES,
    where: args.where,
  });

  if (upload.status < 200 || upload.status >= 300) {
    throw classify(upload.status, upload.text, args.where);
  }

  return asset;
}

export async function createLinkedInPost(args: {
  accessToken: string;
  authorUrn: string;
  text: string;
  assetUrn?: string;
  visibility: "PUBLIC" | "CONNECTIONS";
  where: string;
}): Promise<{ id: string }> {
  const result = await linkedinFetch<{ id?: string }>(args.accessToken, {
    path: "/ugcPosts",
    method: "POST",
    body: {
      author: args.authorUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: args.text },
          shareMediaCategory: args.assetUrn ? "IMAGE" : "NONE",
          ...(args.assetUrn
            ? {
                media: [{ status: "READY", media: args.assetUrn }],
              }
            : {}),
        },
      },
      visibility: {
        "com.linkedin.ugc.MemberNetworkVisibility": args.visibility,
      },
    },
    where: args.where,
  });

  if (!result.id) {
    throw new NonRetriableError(
      `${args.where}: LinkedIn accepted the post but returned no id.`,
    );
  }
  return { id: result.id };
}
