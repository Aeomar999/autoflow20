import type * as React from "react";

import { cn } from "@/lib/utils";

export type StatusTone =
  | "success"
  | "danger"
  | "warning"
  | "info"
  | "neutral"
  | "accent";

const TONES: Record<StatusTone, string> = {
  success: "border-success/30 bg-success/10 text-success",
  danger: "border-danger/30 bg-danger/10 text-danger",
  warning: "border-warning/30 bg-warning/10 text-warning",
  info: "border-info/30 bg-info/10 text-info",
  accent: "border-primary/30 bg-primary/10 text-primary",
  neutral: "border-hairline bg-well text-muted-foreground",
};

/**
 * Status pill. Colour is the only decorative dot allowed in this UI, and it
 * always carries real state — never ornament on a nav item or a list row.
 */
export const StatusPill = ({
  tone = "neutral",
  icon,
  children,
  className,
  title,
}: {
  tone?: StatusTone;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  title?: string;
}) => (
  <span
    title={title}
    className={cn(
      "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
      "[&_svg]:size-3 [&_svg]:shrink-0",
      TONES[tone],
      className,
    )}
  >
    {icon ?? <span aria-hidden className="size-1.5 rounded-full bg-current" />}
    {children}
  </span>
);
