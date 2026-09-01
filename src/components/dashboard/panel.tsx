import { InfoIcon } from "lucide-react";
import type * as React from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Panel — the single container shape for every dashboard surface.
 *
 * One rule, applied everywhere: a hairline-bordered card on `--panel`, a
 * header bar carrying a mono micro-label, and a body. Charts, ranked lists and
 * tables all sit in the same frame, so a page of mixed content still reads as
 * one instrument panel rather than seven differently-styled boxes.
 */
export const Panel = ({
  className,
  ...props
}: React.ComponentProps<"section">) => (
  <section
    data-slot="panel"
    className={cn(
      "flex min-w-0 flex-col overflow-hidden rounded-xl border border-hairline bg-panel",
      className,
    )}
    {...props}
  />
);

export const PanelHeader = ({
  className,
  ...props
}: React.ComponentProps<"header">) => (
  <header
    className={cn(
      "flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-hairline px-4 py-2.5",
      className,
    )}
    {...props}
  />
);

/** The mono micro-label that names a panel, with an optional explainer. */
export const PanelTitle = ({
  children,
  hint,
  className,
}: {
  children: React.ReactNode;
  hint?: string;
  className?: string;
}) => (
  <div className="flex min-w-0 items-center gap-1.5">
    <h2 className={cn("dash-label truncate text-muted-foreground", className)}>
      {children}
    </h2>
    {hint ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={hint}
            className="text-muted-foreground/60 transition-colors hover:text-foreground"
          >
            <InfoIcon className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-64 text-xs">{hint}</TooltipContent>
      </Tooltip>
    ) : null}
  </div>
);

export const PanelActions = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <div
    className={cn("flex shrink-0 items-center gap-1.5", className)}
    {...props}
  />
);

export const PanelBody = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <div className={cn("min-w-0 flex-1 p-4", className)} {...props} />
);

/** Inset strip under a panel body — axis labels, totals, "showing N of M". */
export const PanelFooter = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <div
    className={cn(
      "flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-hairline bg-well px-4 py-2 text-xs text-muted-foreground",
      className,
    )}
    {...props}
  />
);

/**
 * Empty state for a panel body. Kept deliberately plain: an empty chart is
 * information ("nothing ran"), not a failure that needs an illustration.
 */
export const PanelEmpty = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "flex min-h-32 items-center justify-center px-6 py-10 text-center text-sm text-muted-foreground",
      className,
    )}
  >
    <p className="max-w-sm text-balance">{children}</p>
  </div>
);
