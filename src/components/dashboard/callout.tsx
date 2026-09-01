import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  InfoIcon,
  XCircleIcon,
} from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Toned message block for errors, warnings and confirmations.
 *
 * The detail views used to hand-roll these as `bg-red-50 text-red-900`, which
 * is a light-mode-only palette: on the dark shell those blocks rendered as a
 * near-white slab with unreadable text. Everything here is theme tokens.
 */
export type CalloutTone = "danger" | "warning" | "success" | "info";

const TONES: Record<
  CalloutTone,
  { wrap: string; icon: React.ReactNode; title: string }
> = {
  danger: {
    wrap: "border-danger/25 bg-danger/8 text-danger",
    icon: <XCircleIcon />,
    title: "text-danger",
  },
  warning: {
    wrap: "border-warning/25 bg-warning/8 text-warning",
    icon: <AlertTriangleIcon />,
    title: "text-warning",
  },
  success: {
    wrap: "border-success/25 bg-success/8 text-success",
    icon: <CheckCircle2Icon />,
    title: "text-success",
  },
  info: {
    wrap: "border-info/25 bg-info/8 text-info",
    icon: <InfoIcon />,
    title: "text-info",
  },
};

export const Callout = ({
  tone = "info",
  title,
  children,
  actions,
  className,
}: {
  tone?: CalloutTone;
  title?: string;
  children?: React.ReactNode;
  /** Buttons or disclosures rendered under the body. */
  actions?: React.ReactNode;
  className?: string;
}) => {
  const spec = TONES[tone];

  return (
    <div
      className={cn("flex gap-3 rounded-lg border p-3.5", spec.wrap, className)}
    >
      <span className="mt-0.5 shrink-0 [&_svg]:size-4">{spec.icon}</span>
      <div className="min-w-0 flex-1 space-y-2">
        {title ? (
          <p className={cn("text-sm font-medium", spec.title)}>{title}</p>
        ) : null}
        {children ? (
          <div className="text-sm text-foreground/80">{children}</div>
        ) : null}
        {actions}
      </div>
    </div>
  );
};
