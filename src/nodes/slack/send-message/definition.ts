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
  keywords: ["slack", "message", "webhook", "chat", "notify"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
};
