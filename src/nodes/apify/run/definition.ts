import { z } from "zod";
import {
  APIFY_CREDENTIAL_TYPE,
  APIFY_DEFAULT_WAIT_SECONDS,
  APIFY_LOGO,
  APIFY_MAX_WAIT_SECONDS,
} from "@/features/apify/constants";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  variableNameSchema,
} from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  credentialId: credentialIdRef(),
  /** Apify actor id, `username~actor-name` or `username/actor-name`. */
  actorId: freeText(256).optional(),
  /** Actor input as JSON. */
  input: freeText(100_000).optional(),
  /** Off returns the run id immediately, for a fetch in a later workflow. */
  waitForFinish: z.boolean().optional(),
  maxWaitSeconds: z
    .number()
    .int()
    .min(10)
    .max(APIFY_MAX_WAIT_SECONDS)
    .optional(),
  memoryMbytes: z.number().int().min(128).max(32_768).optional(),
});

export const definition: NodeDefinition = {
  type: "APIFY_RUN",
  // Sleeps between polls while an actor runs, and aborts it on cancel.
  ownsSteps: true,
  version: 1,
  category: "ACTION",
  label: "Apify Run Actor",
  description:
    "Start an Apify actor and wait for it to finish. The wait is a durable, cancellable step, and a run this node stops waiting on is aborted rather than left billing.",
  icon: "Bot",
  logo: APIFY_LOGO,
  keywords: ["apify", "actor", "scrape", "crawl", "run", "extract"],
  configSchema,
  defaults: {
    waitForFinish: true,
    maxWaitSeconds: APIFY_DEFAULT_WAIT_SECONDS,
  },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: APIFY_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/APIFY_RUN",
};
