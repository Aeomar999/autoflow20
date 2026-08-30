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
  z.object({ type: z.literal("groq.apiKey"), apiKey: requiredSecret }).strict(),
  z
    .object({ type: z.literal("deepseek.apiKey"), apiKey: requiredSecret })
    .strict(),
  z
    .object({
      type: z.literal("slack.oauth2"),
      accessToken: requiredSecret,
      refreshToken: optionalSecret,
      scopes: optionalSecret,
      oauthExpiresAt: z.iso.datetime({ offset: true }).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("google.oauth2"),
      accessToken: requiredSecret,
      refreshToken: optionalSecret,
      scopes: optionalSecret,
      oauthExpiresAt: z.iso.datetime({ offset: true }).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("postgres"),
      host: requiredSecret,
      port: requiredSecret,
      database: requiredSecret,
      username: requiredSecret,
      password: requiredSecret,
      ssl: optionalSecret,
    })
    .strict(),
  z
    .object({
      type: z.literal("smtp"),
      host: requiredSecret,
      port: requiredSecret,
      username: requiredSecret,
      password: requiredSecret,
      tls: optionalSecret,
    })
    .strict(),
  z
    .object({
      type: z.literal("airtable.apiKey"),
      apiKey: requiredSecret,
    })
    .strict(),
  z
    .object({
      type: z.literal("hubspot.apiKey"),
      apiKey: requiredSecret,
    })
    .strict(),
  z
    .object({
      type: z.literal("openaiCompatible.apiKey"),
      apiKey: requiredSecret,
    })
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

// ---------------------------------------------------------------------------
// Update schemas — secret fields are optional so users can rename a credential
// or test its connection without re-entering secrets they don't want to change.
// ---------------------------------------------------------------------------

export const credentialUpdateVariants = [
  z.object({ type: z.literal("apiKey"), apiKey: optionalSecret }).strict(),
  z.object({ type: z.literal("bearer"), token: optionalSecret }).strict(),
  z
    .object({
      type: z.literal("basic"),
      username: optionalSecret,
      password: optionalSecret,
    })
    .strict(),
  z
    .object({
      type: z.literal("header"),
      name: optionalSecret,
      value: optionalSecret,
    })
    .strict(),
  z
    .object({
      type: z.literal("oauth2"),
      accessToken: optionalSecret,
      refreshToken: optionalSecret,
      scopes: optionalSecret,
      oauthExpiresAt: z.iso.datetime({ offset: true }).optional(),
    })
    .strict(),
  z
    .object({ type: z.literal("openai.apiKey"), apiKey: optionalSecret })
    .strict(),
  z
    .object({ type: z.literal("anthropic.apiKey"), apiKey: optionalSecret })
    .strict(),
  z
    .object({ type: z.literal("gemini.apiKey"), apiKey: optionalSecret })
    .strict(),
  z.object({ type: z.literal("groq.apiKey"), apiKey: optionalSecret }).strict(),
  z
    .object({ type: z.literal("deepseek.apiKey"), apiKey: optionalSecret })
    .strict(),
  z
    .object({
      type: z.literal("slack.oauth2"),
      accessToken: optionalSecret,
      refreshToken: optionalSecret,
      scopes: optionalSecret,
      oauthExpiresAt: z.iso.datetime({ offset: true }).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("google.oauth2"),
      accessToken: optionalSecret,
      refreshToken: optionalSecret,
      scopes: optionalSecret,
      oauthExpiresAt: z.iso.datetime({ offset: true }).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("postgres"),
      host: optionalSecret,
      port: optionalSecret,
      database: optionalSecret,
      username: optionalSecret,
      password: optionalSecret,
      ssl: optionalSecret,
    })
    .strict(),
  z
    .object({
      type: z.literal("smtp"),
      host: optionalSecret,
      port: optionalSecret,
      username: optionalSecret,
      password: optionalSecret,
      tls: optionalSecret,
    })
    .strict(),
  z
    .object({
      type: z.literal("airtable.apiKey"),
      apiKey: optionalSecret,
    })
    .strict(),
  z
    .object({
      type: z.literal("hubspot.apiKey"),
      apiKey: optionalSecret,
    })
    .strict(),
  z
    .object({
      type: z.literal("openaiCompatible.apiKey"),
      apiKey: optionalSecret,
    })
    .strict(),
] as const;

export const credentialUpdateBody = z.discriminatedUnion(
  "type",
  credentialUpdateVariants,
);

export const credentialUpdateInput = z
  .object({
    id: z.string(),
    name: z.string().min(1, "Name is required").max(120),
  })
  .and(credentialUpdateBody);

export type CredentialUpdateInput = z.infer<typeof credentialUpdateInput>;

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
): string | undefined =>
  "oauthExpiresAt" in input ? input.oauthExpiresAt : undefined;
