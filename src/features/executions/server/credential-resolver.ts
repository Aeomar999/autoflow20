import "server-only";
import {
  type CredentialSecret,
  openSecret,
} from "@/features/credentials/server/vault";
import type { CredentialRequirement } from "@/nodes/types";

/**
 * Engine-side credential resolution (AF-M3-04).
 *
 * The single place plaintext credentials are materialized for a node run —
 * consolidating the per-executor Prisma queries + `openSecret` calls that
 * existed before. It runs once, keyed by each `CredentialRequirement.key`
 * (the node-config field holding the credential id). The resolved map is
 * handed to the executor via `NodeRunParams.credentials` and is NEVER merged
 * into `context`, `output`, or a trace row, so secret material has no path to
 * `NodeExecution.input/output` (security.md §3). Loader is injected so the
 * resolver is unit-testable without Prisma.
 */

export type CredentialRowLoader = (
  credentialId: string,
) => Promise<unknown | null>;

/** Thrown when a required credential is missing (unset id or not found). */
export class MissingRequiredCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingRequiredCredentialError";
  }
}

export interface ResolveNodeCredentialsArgs {
  requirements: CredentialRequirement[] | undefined;
  /** Node config — only ever read for the credential ids. */
  nodeData: Record<string, unknown>;
  userId: string;
  /** Loads a tenant-scoped credential row (shape-ready for `openSecret`). */
  loadCredentialRow: CredentialRowLoader;
  /** Called (optionally) after a successful decrypt — e.g. stamp `lastUsedAt`. */
  onDecrypted?: (credentialId: string) => void;
}

export async function resolveNodeCredentials(
  args: ResolveNodeCredentialsArgs,
): Promise<Record<string, CredentialSecret>> {
  const { requirements, nodeData, loadCredentialRow, onDecrypted } = args;

  if (!requirements || requirements.length === 0) {
    return {};
  }

  const resolved: Record<string, CredentialSecret> = {};
  for (const requirement of requirements) {
    const credentialId = nodeData[requirement.key];
    if (typeof credentialId !== "string" || credentialId.length === 0) {
      if (requirement.required) {
        throw new MissingRequiredCredentialError(
          `Node requires credential "${requirement.key}" (${requirement.type}) but none is configured.`,
        );
      }
      continue;
    }

    const row = await loadCredentialRow(credentialId);
    if (!row) {
      if (requirement.required) {
        throw new MissingRequiredCredentialError(
          `Credential for "${requirement.key}" not found.`,
        );
      }
      continue;
    }

    // Decrypted exactly here — the executor receives `resolved[requirement.key]`.
    resolved[requirement.key] = openSecret(row);
    onDecrypted?.(credentialId);
  }
  return resolved;
}
