import { z } from "zod";
import {
  CREDENTIAL_TYPE_DEFINITIONS,
  type CredentialTypeDef,
} from "../credential-types";

/**
 * Credential write input (AF-M3-02). Built from the credential-registry defs'
 * field shape. A parity test (`credential-registry.test.ts`) asserts this
 * schema and the registry definitions can never drift.
 *
 * Every field here is either one of a def's `fields` or the `name`/`type`
 * metadata — nothing else may ever be written to a Credential §3.
 */
export const requiredSecret = z.string().min(1);
export const optionalSecret = z.string().optional();

/**
 * The variants are **generated from the credential registry definitions**
 * (AF-M10-02) rather than hand-written.
 *
 * They used to be an explicit tuple, one literal block per type, guarded by a
 * parity test — workable while there were 17 types. M10 adds 12 in one task and
 * more in AF-M10-03/04, each needing a write block *and* an update block; every
 * one of those ~50 hand-written blocks is a chance for the schema and the
 * registry to disagree, which the parity test then reports as a failure someone
 * fixes by hand. Generating removes the class of bug instead of detecting it: a
 * def's `fields` array becomes the only place a credential's shape is written
 * down.
 *
 * `.strict()` is preserved per variant, so an unknown key is still rejected for
 * the specific type being written — the AF-M3-02 rule that nothing but a def's
 * own fields may be persisted holds exactly as before.
 */
const variantFor = (
  def: CredentialTypeDef,
  mode: "write" | "update",
): z.ZodObject => {
  const shape: Record<string, z.ZodType> = {
    type: z.literal(def.type),
  };
  for (const field of def.fields) {
    // Update makes every field optional: a rename must not force the user to
    // re-enter secrets they never intended to change.
    shape[field.key] =
      mode === "update" || field.optional ? optionalSecret : requiredSecret;
  }
  if (def.oauth) {
    shape.oauthExpiresAt = z.iso.datetime({ offset: true }).optional();
  }
  return z.object(shape).strict();
};

export const credentialWriteVariants = CREDENTIAL_TYPE_DEFINITIONS.map((def) =>
  variantFor(def, "write"),
);

const credentialName = z.string().min(1, "Name is required").max(120);

/**
 * The static shape handlers see.
 *
 * Generating the runtime schema costs the precise per-type discriminated union
 * `z.infer` used to produce, because a mapped array of `z.object(...)` is
 * `ZodObject[]` to the type system regardless of what each element validates.
 * That precision was never load-bearing: every consumer reads `name`/`type` and
 * then hands the whole object to `secretFromInput`, which looks fields up by
 * key against the def. So the static type is declared once, here, and the
 * runtime check stays exactly as strict as it was — per-variant, unknown keys
 * rejected.
 */
export interface CredentialWriteInput {
  name: string;
  type: string;
  oauthExpiresAt?: string;
  [field: string]: unknown;
}

export interface CredentialUpdateInput extends CredentialWriteInput {
  id: string;
}

/**
 * Write input: every strict variant extended with the `name` metadata.
 *
 * Built as a union of `variant.extend({ name })` rather than
 * `z.object({ name }).and(body)` — a strict ZodObject rejects keys it does not
 * declare, and that unknown-key check does NOT compose through `.and`, so the
 * intersection form rejects `name` on every create. Extending the variant
 * instead lets `name` coexist with the strict variant's fields while unknown
 * keys are still rejected per variant (AGENTS §6).
 *
 * `z.union`, not `z.discriminatedUnion`: the generated array is not the strict
 * tuple of discriminable schemas the latter requires.
 */
export const credentialWriteInput = z.union(
  credentialWriteVariants.map((variant) =>
    variant.extend({ name: credentialName }),
  ),
) as unknown as z.ZodType<CredentialWriteInput>;

// ---------------------------------------------------------------------------
// Update schemas — secret fields are optional so users can rename a credential
// or test its connection without re-entering secrets they don't want to change.
// ---------------------------------------------------------------------------

export const credentialUpdateVariants = CREDENTIAL_TYPE_DEFINITIONS.map((def) =>
  variantFor(def, "update"),
);

export const credentialUpdateInput = z
  .object({
    id: z.string(),
    name: credentialName,
  })
  .and(
    z.union(credentialUpdateVariants),
  ) as unknown as z.ZodType<CredentialUpdateInput>;

/**
 * Returns true if any secret field in the update payload has a non-empty value,
 * meaning the envelope needs to be re-encrypted.
 */
export function hasSecretChanges(
  input: Record<string, unknown>,
  fieldKeys: string[],
): boolean {
  return fieldKeys.some((key) => {
    const value = input[key];
    return typeof value === "string" && value.length > 0;
  });
}

/** OAuth variants carry `oauthExpiresAt`; other kinds never do. */
export const oauthExpiresAtOf = (
  input: CredentialWriteInput | CredentialUpdateInput,
): string | undefined => input.oauthExpiresAt;
