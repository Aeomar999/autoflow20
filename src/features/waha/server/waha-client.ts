import "server-only";
import { NonRetriableError, RetryAfterError } from "inngest";
import type { CredentialSecret } from "@/features/credentials/server/vault";
import {
  assertSafeEndpoint,
  safeFetch,
} from "@/features/executions/components/http-request/egress-guard";

/**
 * The WAHA (WhatsApp HTTP API) client (AF-M10-21).
 *
 * **WAHA is self-hosted, so its base URL comes from the user.** That makes
 * every call here an SSRF risk of exactly the kind `HTTP_REQUEST` was hardened
 * against in AF-M8-17: a credential pointing at `http://169.254.169.254/`
 * would turn a WhatsApp node into a cloud-metadata reader, and one pointing at
 * an internal host would make it a port scanner with the server's network
 * position.
 *
 * So requests go through `safeFetch`, which resolves the hostname, refuses
 * loopback/private/link-local/CGNAT addresses, pins the connection to the
 * address it vetted, and re-vets every redirect hop. The URL is *also* checked
 * up front by `assertSafeEndpoint`, so a bad credential fails with a clear
 * message rather than a connection error.
 */

const REQUEST_TIMEOUT_MS = 30_000;

export interface WahaMessage {
  id?: string;
  timestamp?: number;
  from?: string;
  to?: string;
  body?: string;
  fromMe?: boolean;
  hasMedia?: boolean;
}

/**
 * Normalise a chat id to WAHA's form.
 *
 * WAHA addresses individuals as `<digits>@c.us` and groups as
 * `<digits>-<digits>@g.us`. People supply a phone number in every format a
 * phone number comes in, and the raw value produces a silent non-delivery
 * rather than an error — WAHA accepts the id and the message goes nowhere.
 */
export function normalizeChatId(raw: string): string {
  const trimmed = raw.trim();

  // Already an addressed id.
  if (trimmed.endsWith("@c.us") || trimmed.endsWith("@g.us")) return trimmed;

  const digits = trimmed.replace(/[^0-9]/g, "");
  if (digits.length === 0) return trimmed;

  // A group id keeps its hyphen, which the digit strip above removed, so it is
  // detected before stripping.
  if (/^\d+-\d+$/.test(trimmed)) return `${trimmed}@g.us`;

  return `${digits}@c.us`;
}

function classify(status: number, text: string, where: string): Error {
  if (status === 401 || status === 403) {
    return new NonRetriableError(
      `${where}: WAHA rejected the API key. Check the key matches the one the WAHA instance was started with.`,
    );
  }
  if (status === 404) {
    return new NonRetriableError(
      `${where}: WAHA returned 404. Check the session name — a WAHA instance serves named sessions, and "default" is only the default.`,
    );
  }
  if (status === 422) {
    return new NonRetriableError(
      `${where}: WAHA rejected the request${text ? `: ${text.slice(0, 200)}` : ""}. The session may not be authenticated — a WAHA session needs its QR code scanned before it can send.`,
    );
  }
  if (status === 429) {
    return new RetryAfterError(`${where}: WAHA rate limit hit.`, 30);
  }
  if (status >= 500) {
    return new RetryAfterError(
      `${where}: the WAHA instance is unavailable (${status}).`,
      15,
    );
  }
  return new NonRetriableError(
    `${where}: WAHA refused the request (${status})${text ? `: ${text.slice(0, 200)}` : ""}.`,
  );
}

/** Read and vet the self-hosted base URL from the credential. */
export async function resolveWahaBase(
  secret: CredentialSecret | undefined,
  where: string,
): Promise<{ base: URL; apiKey: string }> {
  const apiKey = secret?.apiKey;
  const baseUrl = secret?.baseUrl;

  if (!apiKey) {
    throw new NonRetriableError(
      `${where}: no WAHA credential is bound to this node. Connect a WAHA credential.`,
    );
  }
  if (!baseUrl) {
    throw new NonRetriableError(
      `${where}: the WAHA credential has no base URL. WAHA is self-hosted, so there is no default to fall back to.`,
    );
  }

  try {
    // Up front, so a credential pointing somewhere it must not reach fails
    // with a sentence rather than a connection error mid-run.
    const base = await assertSafeEndpoint(baseUrl.trim().replace(/\/+$/, ""));
    return { base, apiKey };
  } catch (error) {
    throw new NonRetriableError(
      `${where}: the WAHA base URL is not an address this server may call — ${
        error instanceof Error ? error.message : "blocked"
      }. It must be a public host, not localhost or an internal address.`,
    );
  }
}

export async function wahaFetch<T>(
  secret: CredentialSecret | undefined,
  request: {
    path: string;
    method?: "GET" | "POST";
    body?: unknown;
    where: string;
  },
): Promise<T> {
  const { base, apiKey } = await resolveWahaBase(secret, request.where);
  const url = new URL(
    `${base.origin}${base.pathname}${request.path}`.replace(
      /([^:]\/)\/+/g,
      "$1",
    ),
  );

  const response = await safeFetch(url, {
    method: request.method ?? "GET",
    headers: {
      "X-Api-Key": apiKey,
      Accept: "application/json",
      ...(request.body ? { "Content-Type": "application/json" } : {}),
    },
    body: request.body ? JSON.stringify(request.body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw classify(response.status, text, request.where);
  }

  const text = await response.text();
  if (text.length === 0) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new NonRetriableError(
      `${request.where}: WAHA returned a response that is not JSON. Check the base URL points at a WAHA instance rather than something else.`,
    );
  }
}

export interface WahaInbound {
  messageId: string | null;
  chatId: string | null;
  from: string | null;
  text: string;
  fromMe: boolean;
  hasMedia: boolean;
  timestamp: number | null;
}

/**
 * Pull the routing fields out of a WAHA webhook.
 *
 * `fromMe` is the one to act on: WAHA delivers the bot's OWN outbound messages
 * back as events, so a workflow that replies to everything it receives will
 * reply to its own replies, forever. The trigger drops those before dispatch.
 */
export function parseWahaEvent(body: unknown): WahaInbound | null {
  if (!body || typeof body !== "object") return null;

  const event = body as Record<string, unknown>;
  const payload = (event.payload ?? event) as Record<string, unknown>;

  const id = payload.id;
  const from = payload.from;

  return {
    messageId: typeof id === "string" ? id : null,
    chatId: typeof from === "string" ? from : null,
    from: typeof from === "string" ? from : null,
    text: typeof payload.body === "string" ? payload.body : "",
    fromMe: payload.fromMe === true,
    hasMedia: payload.hasMedia === true,
    timestamp: typeof payload.timestamp === "number" ? payload.timestamp : null,
  };
}
