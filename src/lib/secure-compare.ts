import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison. Both inputs are hashed first so the
 * comparison length is fixed regardless of input lengths.
 */
export const secureCompare = (a: string, b: string): boolean => {
  const digestA = createHash("sha256").update(a).digest();
  const digestB = createHash("sha256").update(b).digest();
  return timingSafeEqual(digestA, digestB);
};
