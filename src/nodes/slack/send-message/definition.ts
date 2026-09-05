import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import {
  freeText,
  urlTemplate,
  variableNameSchema,
} from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  webhookUrl: urlTemplate(2048).optional(),
  content: freeText(4000).optional(),
});

export const definition: NodeDefinition = {
  type: "SLACK",
  version: 1,
  category: "ACTION",
  label: "Slack",
  description:
    "Post a message to a Slack channel via incoming webhook. Content supports templates.",
  icon: "Hash",
  logo: "/logos/slack.svg",
  keywords: ["slack", "message", "webhook", "chat", "notify"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  /**
   * Superseded by `SLACK_POST` (AF-M10-17), which authenticates with the
   * workspace credential instead of a webhook URL.
   *
   * An incoming-webhook URL is pinned to one channel at creation time, so this
   * node cannot post to a channel chosen at run time, cannot create a channel,
   * and cannot DM anyone — which is four of the reference automations. It also
   * carries its secret in `webhookUrl`, a plain config field that lands in
   * `NodeExecution.input`.
   *
   * Kept registered and executable per ADR-0011: saved workflows and published
   * versions must keep running. It is dropped from the palette, so no NEW
   * instance can be created. Removal is a separate step, once no persisted
   * node of this type remains.
   */
  deprecated: {
    since: "2026-09-04",
    replacedBy: "SLACK_POST",
    reason:
      "A webhook URL is pinned to one channel and is stored in plain node config. Slack Post Message uses the workspace credential, can post to any channel, and keeps the token out of the run trace.",
  },
};
