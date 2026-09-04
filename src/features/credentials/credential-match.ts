/**
 * Matching a node's `CredentialRequirement.type` against stored credentials
 * (AF-M10-01, AF-M10-03). Isomorphic: the config panel filters the picker with
 * it and the server validates with it.
 *
 * The grammar is deliberately tiny — two forms beyond a plain id:
 *
 * - `"*"` — any registered type. `HTTP_REQUEST` uses this so a new provider
 *   needs a credential type, not a new node (ADR-0022).
 * - `"a|b"` — either type. This is how a deprecated credential type keeps
 *   working through its overlap window: `google.sheets|google.oauth2` accepts
 *   the scoped type for new bindings and the legacy one for saved nodes,
 *   without a migration that would re-consent every user (ADR-0011's
 *   retirement rule applied to credentials).
 */

export const CREDENTIAL_TYPE_WILDCARD = "*";

/**
 * The concrete types a requirement accepts, or `"any"` for the wildcard.
 * `"any"` is returned rather than the full registry list so callers can send
 * "no filter" to the server instead of an ever-growing array.
 */
export function acceptedCredentialTypes(
  requirementType: string,
): string[] | "any" {
  if (requirementType === CREDENTIAL_TYPE_WILDCARD) {
    return "any";
  }
  const parts = requirementType
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts : [requirementType];
}

/** True when a credential of `candidateType` satisfies the requirement. */
export function credentialTypeMatches(
  requirementType: string,
  candidateType: string,
): boolean {
  const accepted = acceptedCredentialTypes(requirementType);
  return accepted === "any" || accepted.includes(candidateType);
}

/** Human-readable form for a config panel label or a docs page. */
export function describeCredentialRequirement(requirementType: string): string {
  const accepted = acceptedCredentialTypes(requirementType);
  if (accepted === "any") {
    return "any credential";
  }
  return accepted.join(" or ");
}
