import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The one webhook signature verifier (AF-M10-18).
 *
 * Every provider signs the same way — HMAC of the raw body under a shared
 * secret — and differs only in cosmetics: Intuit sends base64, GitHub sends
 * hex behind a `sha256=` prefix, others pick their own digest. Writing that
 * comparison once per provider is how one of them ends up using `===`, and a
 * `===` on a signature is a real vulnerability rather than a style problem.
 *
 * So there is exactly one constant-time comparison in the codebase, and the
 * per-provider modules describe their own header format and delegate here.
 */

export type SignatureEncoding = "base64" | "hex";

export interface HmacVerification {
  /**
   * The **raw** request body, exactly as received.
   *
   * `JSON.parse` followed by `JSON.stringify` produces a byte-for-byte
   * different document — key order, whitespace, number formatting — and every
   * signature check would then fail for reasons that look like a wrong secret.
   */
  rawBody: string;
  /** The provider's signature header, or null when absent. */
  signature: string | null | undefined;
  /** The shared secret: the app's verifier token or webhook secret. */
  secret: string;
  encoding: SignatureEncoding;
  algorithm?: "sha256" | "sha1";
  /** Literal prefix the provider puts before the digest, e.g. `"sha256="`. */
  prefix?: string;
}

/**
 * Verify an HMAC webhook signature in constant time.
 *
 * Returns false rather than throwing for every failure mode — absent header,
 * absent secret, wrong prefix, undecodable digest, wrong length, wrong value —
 * because a route's only correct response to any of them is the same 401, and
 * an exception here would be caught and flattened into that anyway.
 */
export function verifyHmacSignature(args: HmacVerification): boolean {
  const { rawBody, secret, encoding, algorithm = "sha256" } = args;
  let signature = args.signature;

  if (!signature || !secret) return false;

  if (args.prefix) {
    if (!signature.startsWith(args.prefix)) return false;
    signature = signature.slice(args.prefix.length);
  }

  const expected = createHmac(algorithm, secret)
    .update(rawBody, "utf8")
    .digest();

  // Node's Buffer.from is lenient: it silently drops characters that are not
  // valid for the encoding rather than throwing, so a garbage header decodes
  // to a short buffer instead of failing. The length check below is what
  // rejects it — which is why that check is not merely an optimisation.
  let received: Buffer;
  try {
    received = Buffer.from(signature, encoding);
  } catch {
    return false;
  }

  // timingSafeEqual throws on a length mismatch, and that throw would itself
  // be a timing signal. A wrong-length signature is invalid regardless.
  if (received.byteLength !== expected.byteLength) return false;

  return timingSafeEqual(received, expected);
}
