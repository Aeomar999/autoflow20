import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { HTTP_AUTH_MODES } from "../../http/request/definition";
import {
  credentialIdRef,
  freeText,
  urlTemplate,
  variableNameSchema,
} from "../../shared/config-fields";

export const configSchema = z.object({
  /** Result key in the run context: {{variableName.file}} */
  variableName: variableNameSchema.optional(),
  /** Absolute http(s) URL. Supports templates; vetted by the egress guard. */
  url: urlTemplate(2048).optional(),
  /** Overrides the name derived from Content-Disposition or the URL. */
  filename: freeText(255).optional(),
  /** Optional credential — many download URLs are behind an API. */
  credentialId: credentialIdRef(),
  authMode: z.enum(HTTP_AUTH_MODES).optional(),
  authHeaderName: freeText(128).optional(),
  authQueryParam: freeText(128).optional(),
  /** Per-node ceiling, clamped by the platform's own MAX_FILE_BYTES. */
  maxBytes: z
    .number()
    .int()
    .min(1)
    .max(100 * 1024 * 1024)
    .optional(),
});

export const definition: NodeDefinition = {
  type: "FILE_DOWNLOAD",
  version: 1,
  category: "DATA",
  label: "Download File",
  description:
    "Fetch a URL into file storage and pass a reference downstream. The bytes never enter the run context.",
  icon: "Download",
  keywords: ["file", "download", "binary", "pdf", "image", "attachment"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [{ key: "credentialId", type: "*", required: false }],
  docsUrl: "/docs/nodes/FILE_DOWNLOAD",
};
