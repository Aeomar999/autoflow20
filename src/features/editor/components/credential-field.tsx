"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  acceptedCredentialTypes,
  describeCredentialRequirement,
} from "@/features/credentials/credential-match";
import { credentialDefsById } from "@/features/credentials/credential-types";
import type { CredentialRequirement } from "@/nodes/types";
import { useTRPC } from "@/trpc/client";

/**
 * The credential picker in the schema-driven config panel (AF-M10-01).
 *
 * Before M10 this field rendered a disabled input telling the user to "pick a
 * connected credential in Credentials" — a sentence with nowhere to go. Every
 * node that could actually be configured had a bespoke dialog with its own
 * `<Select>`; the generic panel, which is what every node added in M10 uses,
 * could not bind a credential at all.
 *
 * The requirement's `type` drives the filter through `acceptedCredentialTypes`:
 * a plain id lists that type, `"a|b"` lists both, and `"*"` lists everything
 * the org has connected.
 */
export function CredentialField({
  requirement,
  inputId,
  value,
  onValueChange,
  className,
}: {
  requirement: CredentialRequirement;
  inputId: string;
  value: unknown;
  onValueChange: (next: string | undefined) => void;
  className: string;
}) {
  const trpc = useTRPC();
  const accepted = acceptedCredentialTypes(requirement.type);

  const { data, isLoading } = useQuery(
    trpc.credentials.list.queryOptions({
      page: 1,
      pageSize: 100,
      search: "",
      ...(accepted === "any"
        ? {}
        : accepted.length === 1
          ? { type: accepted[0] }
          : { types: accepted }),
    }),
  );

  const items = data?.items ?? [];
  const selected = typeof value === "string" ? value : "";
  // A saved binding whose credential was deleted (or moved to another org)
  // must not silently render as "nothing selected" — that reads as an
  // unconfigured node and hides why the run will fail.
  const dangling = selected.length > 0 && !items.some((c) => c.id === selected);

  return (
    <div className="flex flex-col gap-1">
      <select
        id={inputId}
        className={className}
        value={dangling ? "" : selected}
        disabled={isLoading}
        onChange={(e) =>
          onValueChange(e.target.value === "" ? undefined : e.target.value)
        }
      >
        <option value="">
          {isLoading
            ? "Loading credentials…"
            : items.length === 0
              ? "No matching credential connected"
              : "Select a credential…"}
        </option>
        {items.map((credential) => {
          const def = credentialDefsById.get(credential.type);
          return (
            <option key={credential.id} value={credential.id}>
              {credential.name} · {def?.label ?? credential.type}
            </option>
          );
        })}
      </select>

      {dangling ? (
        <p className="text-xs text-destructive">
          The credential this node was bound to no longer exists. Pick another
          one.
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Accepts {describeCredentialRequirement(requirement.type)}.{" "}
        <Link href="/credentials" className="underline underline-offset-2">
          Manage credentials
        </Link>
      </p>
    </div>
  );
}
