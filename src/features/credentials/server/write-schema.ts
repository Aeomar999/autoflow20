import { z } from "zod";

/**
 * Credential write input (AF-M3-02). Built from the credential-registry defs'
 * field shape; the variants are kept as an explicit tuple so the literal
 * discriminators survive for `z.discriminatedUnion` (AGENTS §6).
 * A parity test (`credential-registry.test.ts`) asserts this schema and the
 * registry definitions can never drift.
 *
 * Every field here is either one of a def's `fields` or the `name`/`type`
 * metadata — nothing else may ever be written to a Credential §3.
 */
export const requiredSecret = z.string().min(1);
export const optionalSecret = z.string().optional();

export const credentialWriteVariants = [
  z.object({ type: z.literal("apiKey"), apiKey: requiredSecret }).strict(),
  z.object({ type: z.literal("bearer"), token: requiredSecret }).strict(),
  z
    .object({
      type: z.literal("basic"),
      username: requiredSecret,
      password: requiredSecret,
    })
    .strict(),
  z
    .object({
      type: z.literal("header"),
      name: requiredSecret,
      value: requiredSecret,
    })
    .strict(),
  z
    .object({
      type: z.literal("oauth2"),
      accessToken: requiredSecret,
      refreshToken: optionalSecret,
      scopes: optionalSecret,
      oauthExpiresAt: z.iso.datetime({ offset: true }).optional(),
    })
    .strict(),
  z
    .object({ type: z.literal("openai.apiKey"), apiKey: requiredSecret })
    .strict(),
  z
    .object({ type: z.literal("anthropic.apiKey"), apiKey: requiredSecret })
    .strict(),
  z
    .object({ type: z.literal("gemini.apiKey"), apiKey: requiredSecret })
    .strict(),
] as const;

export const credentialWriteBody = z.discriminatedUnion(
  "type",
  credentialWriteVariants,
);

export const credentialWriteInput = z
  .object({ name: z.string().min(1, "Name is required").max(120) })
  .and(credentialWriteBody);

export type CredentialWriteInput = z.infer<typeof credentialWriteInput>;

/** OAuth variants carry `oauthExpiresAt`; other kinds never do. */
export const oauthExpiresAtOf = (
  input: CredentialWriteInput,
): string | undefined =>
  "oauthExpiresAt" in input ? input.oauthExpiresAt : undefined;
