import "server-only";
import { NonRetriableError, RetryAfterError } from "inngest";
import type { CredentialSecret } from "@/features/credentials/server/vault";
import { serviceEndpoint } from "@/lib/server/service-endpoints";

/**
 * Image generation clients (AF-M10-23).
 *
 * Two providers with opposite shapes, which is the reason they share a file:
 * OpenAI returns **base64 in a JSON envelope** and Pollinations returns **the
 * image bytes directly from a GET**. Both end up as a stored `FileRef`, so the
 * difference is contained here rather than in two nodes.
 */

const REQUEST_TIMEOUT_MS = 120_000;

export interface GeneratedImage {
  data: Buffer;
  mimeType: string;
  /** What the model actually rendered, when it rewrites the prompt. */
  revisedPrompt: string | null;
}

function classifyOpenAi(status: number, text: string, where: string): Error {
  let message = "";
  let code = "";
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: string; code?: string };
    };
    message = parsed.error?.message ?? "";
    code = parsed.error?.code ?? "";
  } catch {
    message = text.slice(0, 200);
  }

  if (status === 401) {
    return new NonRetriableError(
      `${where}: OpenAI rejected the API key. Reconnect the OpenAI credential.`,
    );
  }

  if (
    status === 400 &&
    /safety|content_policy|moderation/i.test(`${code} ${message}`)
  ) {
    // A refused prompt is a decision, not a fault. Retrying sends the same
    // prompt to the same filter and spends another request to be told no
    // again.
    return new NonRetriableError(
      `${where}: OpenAI's content filter refused this prompt${message ? `: ${message}` : ""}. Retrying will not change the answer — reword the prompt.`,
    );
  }

  if (status === 400) {
    return new NonRetriableError(
      `${where}: OpenAI rejected the request${message ? `: ${message}` : ""}.`,
    );
  }

  if (status === 429) {
    return new RetryAfterError(`${where}: OpenAI rate limit hit.`, 20);
  }

  if (status >= 500) {
    return new RetryAfterError(
      `${where}: OpenAI is unavailable (${status}).`,
      15,
    );
  }

  return new NonRetriableError(
    `${where}: OpenAI refused the request (${status})${message ? `: ${message}` : ""}.`,
  );
}

export async function generateOpenAiImage(args: {
  secret: CredentialSecret | undefined;
  model: string;
  prompt: string;
  size: string;
  quality?: string;
  where: string;
}): Promise<GeneratedImage> {
  const apiKey = args.secret?.apiKey;
  if (!apiKey) {
    throw new NonRetriableError(
      `${args.where}: no OpenAI credential is bound to this node. Connect an OpenAI credential.`,
    );
  }

  const response = await fetch(
    `${serviceEndpoint("openai")}/images/generations`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: args.model,
        prompt: args.prompt,
        size: args.size,
        n: 1,
        ...(args.quality ? { quality: args.quality } : {}),
        // gpt-image-1 returns base64 by default; dall-e-3 returns a URL unless
        // asked. Asking for base64 on both means one code path and no
        // second request to a URL that expires in an hour.
        ...(args.model === "dall-e-3" ? { response_format: "b64_json" } : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );

  const text = await response.text();
  if (!response.ok) {
    throw classifyOpenAi(response.status, text, args.where);
  }

  const parsed = JSON.parse(text) as {
    data?: Array<{ b64_json?: string; revised_prompt?: string }>;
  };

  const first = parsed.data?.[0];
  if (!first?.b64_json) {
    throw new NonRetriableError(
      `${args.where}: OpenAI returned no image data.`,
    );
  }

  return {
    data: Buffer.from(first.b64_json, "base64"),
    mimeType: "image/png",
    // dall-e-3 rewrites prompts and returns what it actually used. Surfacing
    // it is the difference between "the image is wrong" and "the model
    // rewrote your prompt into this".
    revisedPrompt: first.revised_prompt ?? null,
  };
}

/**
 * Pollinations: keyless, free, and returns the bytes straight from a GET.
 *
 * No credential at all, which is why it is the one media node a
 * credential-free template can use. The trade is that there is no envelope to
 * check — a failure is an HTTP status or an HTML error page, and an HTML page
 * with a 200 would otherwise be stored as a corrupt "image".
 */
export async function generatePollinationsImage(args: {
  prompt: string;
  width: number;
  height: number;
  seed?: number;
  model?: string;
  where: string;
}): Promise<GeneratedImage> {
  const url = new URL(
    `${serviceEndpoint("pollinations")}/${encodeURIComponent(args.prompt)}`,
  );
  url.searchParams.set("width", String(args.width));
  url.searchParams.set("height", String(args.height));
  url.searchParams.set("nologo", "true");
  if (args.seed !== undefined) url.searchParams.set("seed", String(args.seed));
  if (args.model) url.searchParams.set("model", args.model);

  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 429) {
    throw new RetryAfterError(
      `${args.where}: Pollinations rate limit hit. It is a free service, so its limits are tighter than a paid one's.`,
      30,
    );
  }

  if (!response.ok) {
    throw new RetryAfterError(
      `${args.where}: Pollinations returned HTTP ${response.status}.`,
      15,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    // A 200 carrying an HTML error page. Storing it would produce a
    // "successful" run whose output is a corrupt file nobody notices until a
    // downstream upload fails.
    throw new RetryAfterError(
      `${args.where}: Pollinations answered 200 with ${contentType || "no content type"} rather than an image, which usually means it is overloaded.`,
      30,
    );
  }

  const data = Buffer.from(await response.arrayBuffer());
  if (data.byteLength === 0) {
    throw new RetryAfterError(
      `${args.where}: Pollinations returned an empty image.`,
      15,
    );
  }

  return {
    data,
    mimeType: contentType.split(";")[0],
    revisedPrompt: null,
  };
}
