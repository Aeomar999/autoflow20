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
  username: freeText(80).optional(),
});

export const definition: NodeDefinition = {
  type: "DISCORD",
  version: 1,
  category: "ACTION",
  label: "Discord",
  description:
    "Post a message to a Discord channel via webhook. Content supports templates.",
  icon: "MessageSquare",
  keywords: ["discord", "message", "webhook", "chat", "notify"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
};
