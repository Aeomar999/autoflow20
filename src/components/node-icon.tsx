import * as LucideIcons from "lucide-react";
import type { ComponentType } from "react";
import type { NodeDefinition } from "@/nodes/types";

export interface NodeIconProps {
  type?: string;
  iconName?: string;
  label?: string;
  className?: string;
  size?: number;
}

const BRAND_LOGOS: Record<string, string> = {
  GOOGLE_FORM_TRIGGER: "/logos/googleform.svg",
  STRIPE_TRIGGER: "/logos/stripe.svg",
  GEMINI: "/logos/gemini.svg",
  OPENAI: "/logos/openai.svg",
  ANTHROPIC: "/logos/anthropic.svg",
  DISCORD: "/logos/discord.svg",
  SLACK: "/logos/slack.svg",
  EMAIL_SEND: "/logos/Logos/Email.png",
  GOOGLE_SHEETS_APPEND: "/logos/Logos/Google sheet.png",
  AIRTABLE_CREATE_RECORD: "/logos/Logos/Airtable.png",
  HUBSPOT_CREATE_CONTACT: "/logos/Logos/Hubspot.png",
};

/**
 * Resolves an icon component or image for a given node definition or type.
 */
export function NodeIcon({
  type,
  iconName,
  label,
  className = "size-5",
  size = 20,
}: NodeIconProps) {
  // 1. Check brand logos first
  if (type && BRAND_LOGOS[type]) {
    return (
      // biome-ignore lint/performance/noImgElement: SVG/PNG brand logos in UI
      <img
        src={BRAND_LOGOS[type]}
        alt={label || type}
        width={size}
        height={size}
        className={`${className} object-contain rounded-sm shrink-0`}
      />
    );
  }

  // 2. Resolve Lucide icon
  const resolvedName = iconName || "Box";
  const IconComponent =
    (
      LucideIcons as unknown as Record<
        string,
        ComponentType<{ className?: string }>
      >
    )[resolvedName] ||
    (
      LucideIcons as unknown as Record<
        string,
        ComponentType<{ className?: string }>
      >
    )[`${resolvedName}Icon`] ||
    LucideIcons.Box;

  return <IconComponent className={`${className} shrink-0`} />;
}

export function getNodeIconComponent(
  def: Pick<NodeDefinition, "type" | "icon" | "label">,
) {
  return function ResolvedNodeIcon(props: { className?: string }) {
    return (
      <NodeIcon
        type={def.type}
        iconName={def.icon}
        label={def.label}
        className={props.className}
      />
    );
  };
}
