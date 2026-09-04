import "server-only";
import { verifyHmacSignature } from "@/lib/server/webhook-signature";

/**
 * GitHub webhook verification and event shaping (AF-M10-18).
 *
 * GitHub signs with `X-Hub-Signature-256: sha256=<hex>` over the raw body. The
 * comparison is the shared constant-time one — see
 * `src/lib/server/webhook-signature.ts`.
 */

/**
 * Verify GitHub's `X-Hub-Signature-256` header.
 *
 * GitHub also still sends the older `X-Hub-Signature` (HMAC-SHA1). It is not
 * accepted here: SHA-1 is present only for pre-2019 consumers, and accepting
 * it would let anyone who can forge the weaker signature through the same
 * door.
 */
export function verifyGithubSignature(args: {
  rawBody: string;
  signature: string | null;
  secret: string;
}): boolean {
  return verifyHmacSignature({
    rawBody: args.rawBody,
    signature: args.signature,
    secret: args.secret,
    encoding: "hex",
    algorithm: "sha256",
    prefix: "sha256=",
  });
}

export interface GithubWebhookEvent {
  /** The `X-GitHub-Event` header: "push", "pull_request", … */
  event: string;
  /** `action` from the body, where the event has one ("opened", "closed", …). */
  action: string | null;
  repository: string | null;
  sender: string | null;
  /** The delivery id — stable across GitHub's own retries of one delivery. */
  deliveryId: string | null;
}

/**
 * Pull the routing fields out of a GitHub delivery.
 *
 * The event name lives in a header, not the body, which is the detail most
 * hand-written GitHub receivers get wrong: the body of a `push` and the body
 * of a `pull_request` share almost no top-level keys, so code that sniffs the
 * shape works until the day it doesn't.
 */
export function parseGithubDelivery(args: {
  headers: { get(name: string): string | null };
  body: unknown;
}): GithubWebhookEvent {
  const body = (args.body ?? {}) as {
    action?: unknown;
    repository?: { full_name?: unknown };
    sender?: { login?: unknown };
  };

  return {
    event: args.headers.get("x-github-event") ?? "",
    action: typeof body.action === "string" ? body.action : null,
    repository:
      typeof body.repository?.full_name === "string"
        ? body.repository.full_name
        : null,
    sender: typeof body.sender?.login === "string" ? body.sender.login : null,
    deliveryId: args.headers.get("x-github-delivery"),
  };
}

/**
 * Does this delivery match what the trigger asked for?
 *
 * An empty filter means "any", which is the useful default for the event list.
 * The action filter is deliberately ignored for events that have no action
 * (`push` is the common one) — otherwise a trigger listening for pushes and
 * opened PRs would silently drop every push.
 */
export function githubEventMatches(
  delivery: GithubWebhookEvent,
  filter: { events?: string[]; actions?: string[] },
): boolean {
  const events = filter.events?.filter(Boolean) ?? [];
  const actions = filter.actions?.filter(Boolean) ?? [];

  if (
    events.length > 0 &&
    !events.some((e) => e.toLowerCase() === delivery.event.toLowerCase())
  ) {
    return false;
  }

  if (actions.length > 0 && delivery.action !== null) {
    return actions.some(
      (a) => a.toLowerCase() === delivery.action?.toLowerCase(),
    );
  }

  return true;
}
