import * as LucideIcons from "lucide-react";
import type { ComponentType } from "react";
import type { NodeDefinition } from "@/nodes/types";

export interface NodeIconProps {
  type?: string;
  iconName?: string;
  /**
   * Brand mark from `NodeDefinition.logo` (AF-M10-35). Preferred over
   * `iconName` when present; the lucide glyph remains the fallback.
   */
  logo?: string;
  label?: string;
  className?: string;
  size?: number;
}

/**
 * Resolves a brand mark or lucide glyph for a node.
 *
 * AF-M10-35 moved the mark onto `NodeDefinition.logo`, so a node declares its
 * own artwork next to the rest of its metadata instead of matching a type id
 * against a map kept in the UI layer. The map that used to live here is gone;
 * anything it covered is now a `logo` on the definition.
 */
export function NodeIcon({
  type,
  iconName,
  logo,
  label,
  className = "size-5",
  size = 20,
}: NodeIconProps) {
  if (logo) {
    return (
      // biome-ignore lint/performance/noImgElement: SVG/PNG brand logos in UI
      <img
        src={logo}
        alt={label || type || ""}
        width={size}
        height={size}
        className={`${className} object-contain rounded-sm shrink-0`}
      />
    );
  }

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
  def: Pick<NodeDefinition, "type" | "icon" | "label"> & { logo?: string },
) {
  return function ResolvedNodeIcon(props: { className?: string }) {
    return (
      <NodeIcon
        type={def.type}
        iconName={def.icon}
        logo={def.logo}
        label={def.label}
        className={props.className}
      />
    );
  };
}
