import "server-only";
import { NonRetriableError, RetryAfterError } from "inngest";
import type { CredentialSecret } from "@/features/credentials/server/vault";
import type { JobProgress } from "./job-poller";

/**
 * Video generation clients (AF-M10-23).
 *
 * Both are submit-then-poll, and both return a **URL** rather than bytes, so
 * each node's last act is a download into the run's file store. Neither
 * provider's URL is permanent — Veo's expires in about two days, Creatomate's
 * is a CDN link tied to the render — which is why the node stores the file
 * rather than passing the URL downstream.
 */

const VERTEX_API = "https://aiplatform.googleapis.com/v1";
const CREATOMATE_API = "https://api.creatomate.com/v1";
const REQUEST_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Veo (Vertex AI)
// ---------------------------------------------------------------------------

export interface VeoOperation {
  name?: string;
  done?: boolean;
  error?: { code?: number; message?: string };
  response?: {
    videos?: Array<{ gcsUri?: string; bytesBase64Encoded?: string }>;
  };
}

function requireVertex(
  secret: CredentialSecret | undefined,
  where: string,
): { accessToken: string; projectId: string; location: string } {
  const accessToken = secret?.accessToken;
  if (!accessToken) {
    throw new NonRetriableError(
      `${where}: no Google credential is bound to this node.`,
    );
  }

  // Vertex is addressed per project AND per region — there is no global
  // endpoint — and neither is inferable from the token.
  const projectId = secret?.projectId;
  if (!projectId) {
    throw new NonRetriableError(
      `${where}: the Google credential has no project id. Vertex AI is addressed per project, so there is no default to fall back to — reconnect the credential with a project selected.`,
    );
  }

  return {
    accessToken,
    projectId,
    location: secret?.location ?? "us-central1",
  };
}

function classifyVertex(status: number, text: string, where: string): Error {
  let message = "";
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    message = parsed.error?.message ?? "";
  } catch {
    message = text.slice(0, 200);
  }

  if (status === 401 || status === 403) {
    return new NonRetriableError(
      `${where}: Vertex AI refused the request${message ? `: ${message}` : ""}. Veo needs the Vertex AI API enabled on the project and the account granted the Vertex AI User role — neither is something the connect flow grants.`,
    );
  }
  if (status === 429) {
    return new RetryAfterError(
      `${where}: Vertex AI quota exhausted. Veo capacity is allocated per project and per region.`,
      60,
    );
  }
  if (status >= 500) {
    return new RetryAfterError(
      `${where}: Vertex AI is unavailable (${status}).`,
      30,
    );
  }
  return new NonRetriableError(
    `${where}: Vertex AI rejected the request (${status})${message ? `: ${message}` : ""}.`,
  );
}

/** Submit a generation and return the long-running operation name. */
export async function startVeoGeneration(args: {
  secret: CredentialSecret | undefined;
  model: string;
  prompt: string;
  durationSeconds: number;
  aspectRatio: string;
  where: string;
}): Promise<string> {
  const { accessToken, projectId, location } = requireVertex(
    args.secret,
    args.where,
  );

  const response = await fetch(
    `${VERTEX_API}/projects/${projectId}/locations/${location}/publishers/google/models/${args.model}:predictLongRunning`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instances: [{ prompt: args.prompt }],
        parameters: {
          durationSeconds: args.durationSeconds,
          aspectRatio: args.aspectRatio,
          sampleCount: 1,
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );

  const text = await response.text();
  if (!response.ok) throw classifyVertex(response.status, text, args.where);

  const operation = JSON.parse(text) as VeoOperation;
  if (!operation.name) {
    throw new NonRetriableError(
      `${args.where}: Vertex accepted the request but returned no operation to poll.`,
    );
  }
  return operation.name;
}

export async function pollVeoOperation(args: {
  secret: CredentialSecret | undefined;
  model: string;
  operationName: string;
  where: string;
}): Promise<JobProgress<VeoOperation>> {
  const { accessToken, projectId, location } = requireVertex(
    args.secret,
    args.where,
  );

  const response = await fetch(
    `${VERTEX_API}/projects/${projectId}/locations/${location}/publishers/google/models/${args.model}:fetchPredictOperation`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ operationName: args.operationName }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );

  const text = await response.text();
  if (!response.ok) throw classifyVertex(response.status, text, args.where);

  const operation = JSON.parse(text) as VeoOperation;

  // A finished operation can still be a FAILED one: `done: true` with an
  // `error` is how Vertex reports a generation that was refused or crashed,
  // and treating done as success would hand an empty result downstream.
  if (operation.done && operation.error) {
    throw new NonRetriableError(
      `${args.where}: Veo generation failed${operation.error.message ? `: ${operation.error.message}` : ""}.`,
    );
  }

  return {
    job: operation,
    done: operation.done === true,
    status: operation.done ? "complete" : "generating",
  };
}

// ---------------------------------------------------------------------------
// Creatomate
// ---------------------------------------------------------------------------

export interface CreatomateRender {
  id?: string;
  status?: string;
  url?: string;
  snapshot_url?: string;
  error_message?: string;
  /** Seconds of output, which is what the cost estimate is based on. */
  output_duration?: number;
}

/** Creatomate's terminal states. `planned` and `rendering` are not. */
const CREATOMATE_TERMINAL = new Set(["succeeded", "failed"]);

function classifyCreatomate(
  status: number,
  text: string,
  where: string,
): Error {
  if (status === 401 || status === 403) {
    return new NonRetriableError(
      `${where}: Creatomate rejected the API key. Reconnect the credential.`,
    );
  }
  if (status === 400 || status === 422) {
    return new NonRetriableError(
      `${where}: Creatomate rejected the render${text ? `: ${text.slice(0, 200)}` : ""}. Modification keys must match the template's element names exactly.`,
    );
  }
  if (status === 429) {
    return new RetryAfterError(`${where}: Creatomate rate limit hit.`, 30);
  }
  if (status >= 500) {
    return new RetryAfterError(
      `${where}: Creatomate is unavailable (${status}).`,
      30,
    );
  }
  return new NonRetriableError(
    `${where}: Creatomate refused the request (${status})${text ? `: ${text.slice(0, 200)}` : ""}.`,
  );
}

async function creatomateFetch<T>(
  apiKey: string,
  request: {
    path: string;
    method?: "GET" | "POST";
    body?: unknown;
    where: string;
  },
): Promise<T> {
  const response = await fetch(`${CREATOMATE_API}${request.path}`, {
    method: request.method ?? "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: request.body ? JSON.stringify(request.body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await response.text();
  if (!response.ok)
    throw classifyCreatomate(response.status, text, request.where);

  return JSON.parse(text) as T;
}

export async function startCreatomateRender(args: {
  secret: CredentialSecret | undefined;
  templateId: string;
  modifications: Record<string, unknown>;
  where: string;
}): Promise<CreatomateRender> {
  const apiKey = args.secret?.apiKey;
  if (!apiKey) {
    throw new NonRetriableError(
      `${args.where}: no Creatomate credential is bound to this node.`,
    );
  }

  // Creatomate answers with an ARRAY of renders, one per output format the
  // template defines. Reading `[0]` rather than the object is the difference
  // between working and a confusing undefined.
  const renders = await creatomateFetch<CreatomateRender[]>(apiKey, {
    path: "/renders",
    method: "POST",
    body: {
      template_id: args.templateId,
      modifications: args.modifications,
    },
    where: args.where,
  });

  const render = Array.isArray(renders) ? renders[0] : undefined;
  if (!render?.id) {
    throw new NonRetriableError(
      `${args.where}: Creatomate accepted the request but returned no render.`,
    );
  }
  return render;
}

export async function pollCreatomateRender(args: {
  secret: CredentialSecret | undefined;
  renderId: string;
  where: string;
}): Promise<JobProgress<CreatomateRender>> {
  const apiKey = args.secret?.apiKey;
  if (!apiKey) {
    throw new NonRetriableError(
      `${args.where}: no Creatomate credential is bound to this node.`,
    );
  }

  const render = await creatomateFetch<CreatomateRender>(apiKey, {
    path: `/renders/${args.renderId}`,
    where: args.where,
  });

  const status = (render.status ?? "").toLowerCase();

  // "succeeded" and "failed" are both terminal, and only one of them is
  // success. Polling for "not rendering" would treat a failure as done.
  if (status === "failed") {
    throw new NonRetriableError(
      `${args.where}: the Creatomate render failed${render.error_message ? `: ${render.error_message}` : ""}.`,
    );
  }

  return {
    job: render,
    done: CREATOMATE_TERMINAL.has(status),
    status: status || "planned",
  };
}
