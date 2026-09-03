import type { NodeDefinition } from "@/nodes/types";
import { triggerDataSchema } from "../../shared/config-fields";

export const configSchema = triggerDataSchema;

export const definition: NodeDefinition = {
  type: "GOOGLE_FORM_TRIGGER",
  version: 1,
  category: "TRIGGER",
  label: "Google Form Trigger",
  description:
    "Start the workflow when a Google Form submission arrives via its webhook URL.",
  icon: "ClipboardList",
  logo: "/logos/googleform.svg",
  keywords: ["google", "form", "webhook", "survey", "response"],
  configSchema,
  defaults: {},
  inputs: [],
  outputs: [{ id: "main", label: "Out" }],
};
