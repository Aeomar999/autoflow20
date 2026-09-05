import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  urlTemplate,
  variableNameSchema,
} from "../../shared/config-fields";

/**
 * Auth modes (AF-M10-01). Duplicated from `shared/http-auth.ts` rather than
 * imported, because that module is `server-only` and this file is isomorphic —
 * the same split the node SDK draws between `definition.ts` and `execute.ts`.
 * `http-auth.test.ts` asserts the two lists stay identical.
 */
export const HTTP_AUTH_MODES = [
  "none",
  "bearer",
  "header",
  "basic",
  "queryParam",
  "oauth2",
] as const;

export const configSchema = z.object({
  /** Result key in the run context: {{variableName.httpResponse.data}} */
  variableName: variableNameSchema.optional(),
  endpoint: urlTemplate(2048).optional(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
  /** JSON string body for POST/PUT/PATCH. Supports Handlebars templates. */
  body: z.string().max(65_536).optional(),
  /** JSON object of request headers. Keys and values support templates. */
  headers: z.record(z.string(), z.string()).optional(),
  /** URL query parameters as key-value pairs. Values support templates. */
  queryParams: z.record(z.string(), z.string()).optional(),
  /**
   * (AF-M10-01) Credential to authenticate with. Accepts ANY registered type —
   * the node's `credentials` requirement is the `"*"` wildcard — so a new
   * provider needs a credential type, not a new node.
   */
  credentialId: credentialIdRef(),
  /**
   * How the bound credential reaches the request. Absent or "none" sends an
   * unauthenticated request, which is what every HTTP_REQUEST node saved
   * before AF-M10-01 does — hence no migration.
   */
  authMode: z.enum(HTTP_AUTH_MODES).optional(),
  /** Header name for `authMode: "header"`. Defaults to the credential's own. */
  authHeaderName: freeText(128).optional(),
  /** Query parameter name for `authMode: "queryParam"`. */
  authQueryParam: freeText(128).optional(),
  /** Optional per-node request timeout; clamped by egress-guard. */
  timeoutMs: z.number().int().min(250).max(60_000).optional(),
  /**
   * When true, non-2xx responses throw instead of being stored as data.
   * Default: false (response is stored regardless of status).
   */
  failOnNon2xx: z.boolean().optional(),
});

export const definition: NodeDefinition = {
  type: "HTTP_REQUEST",
  version: 1,
  category: "ACTION",
  label: "HTTP Request",
  description:
    "Call any HTTP endpoint, optionally authenticated with a stored credential. URLs support templates.",
  icon: "Globe",
  keywords: ["http", "api", "rest", "fetch", "request", "auth"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  /**
   * `"*"` accepts any registered credential type (AF-M10-01, ADR-0022). The
   * requirement is optional so a node with no credential still validates and
   * runs — the pre-M10 behaviour of every saved HTTP_REQUEST.
   */
  credentials: [{ key: "credentialId", type: "*", required: false }],
  docsUrl: "/docs/nodes/HTTP_REQUEST",
};
