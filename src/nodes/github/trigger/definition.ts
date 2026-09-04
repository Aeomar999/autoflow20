import { z } from "zod";
import {
  GITHUB_CREDENTIAL_TYPE,
  GITHUB_LOGO,
  GITHUB_TRIGGER_EVENTS,
} from "@/features/github/constants";
import type { NodeDefinition } from "@/nodes/types";
import { credentialIdRef, freeText } from "../../shared/config-fields";

export const configSchema = z.object({
  credentialId: credentialIdRef().optional(),
  repo: freeText(256).optional(),
  /** Comma-separated event names. Blank means every event delivered. */
  events: freeText(512).optional(),
  /** Comma-separated actions, e.g. `opened,closed`. Ignored for `push`. */
  actions: freeText(512).optional(),
});

export const definition: NodeDefinition = {
  type: "GITHUB_TRIGGER",
  version: 1,
  category: "TRIGGER",
  label: "GitHub Trigger",
  description:
    "Start a workflow from a GitHub webhook — pushes, pull requests, issues, releases. Deliveries are rejected unless their HMAC-SHA256 signature verifies.",
  icon: "Github",
  logo: GITHUB_LOGO,
  keywords: ["github", "webhook", "trigger", "push", "pull request", "issue"],
  configSchema,
  defaults: { events: GITHUB_TRIGGER_EVENTS.slice(0, 2).join(",") },
  inputs: [],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: GITHUB_CREDENTIAL_TYPE, required: false },
  ],
  docsUrl: "/docs/nodes/GITHUB_TRIGGER",
};
