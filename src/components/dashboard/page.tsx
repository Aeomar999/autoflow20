import { AlertTriangleIcon, ArrowLeftIcon, Loader2Icon } from "lucide-react";
import Link from "next/link";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Page frame shared by every dashboard route.
 *
 * `bg-surface` is a step below `bg-panel`, which is what lets panels read as
 * panels in light mode as well as dark. Content is capped at 1440px so a
 * four-card stat row stays a row on a wide monitor without the chart panel
 * stretching to an unreadable aspect.
 */
export const DashboardPage = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <div className="min-h-full bg-surface">
    <div
      className={cn(
        "mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 py-5 md:px-8 md:py-6",
        className,
      )}
      {...props}
    />
  </div>
);

export const PageHeader = ({
  title,
  description,
  actions,
  badge,
  backTo,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Rendered inline after the title, e.g. a run status pill. */
  badge?: React.ReactNode;
  /** Detail pages get an explicit way back to the list they came from. */
  backTo?: { href: string; label: string };
}) => (
  <div className="flex flex-col gap-3">
    {backTo ? (
      <Link
        href={backTo.href}
        prefetch
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-3.5" />
        {backTo.label}
      </Link>
    ) : null}
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="truncate text-2xl font-semibold tracking-tight md:text-[1.75rem] md:leading-9">
            {title}
          </h1>
          {badge}
        </div>
        {description ? (
          <div className="mt-1 text-sm text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  </div>
);

/** Horizontal meter for quota-style values. */
export const Meter = ({
  fraction,
  tone = "accent",
  className,
}: {
  fraction: number;
  tone?: "accent" | "warning" | "danger";
  className?: string;
}) => (
  <div
    className={cn(
      "h-1.5 w-full overflow-hidden rounded-full bg-well",
      className,
    )}
  >
    <div
      className={cn(
        "h-full rounded-full transition-[width] duration-500",
        tone === "danger" && "bg-danger",
        tone === "warning" && "bg-warning",
        tone === "accent" && "bg-primary",
      )}
      style={{ width: `${Math.max(1.5, Math.min(100, fraction * 100))}%` }}
    />
  </div>
);

export const PageHeaderSkeleton = () => (
  <div className="flex flex-wrap items-end justify-between gap-4">
    <div className="space-y-2">
      <span className="block h-6 w-40 animate-pulse rounded bg-muted" />
      <span className="block h-4 w-64 animate-pulse rounded bg-muted" />
    </div>
    <span className="h-8 w-32 animate-pulse rounded-md bg-muted" />
  </div>
);

export const DashboardLoading = ({ message }: { message: string }) => (
  <div className="flex min-h-64 flex-1 flex-col items-center justify-center gap-3">
    <Loader2Icon className="size-5 animate-spin text-primary" />
    <p className="text-sm text-muted-foreground">{message}</p>
  </div>
);

export const DashboardError = ({ message }: { message: string }) => (
  <div className="flex min-h-64 flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-hairline bg-panel/50">
    <AlertTriangleIcon className="size-5 text-danger" />
    <p className="text-sm text-muted-foreground">{message}</p>
  </div>
);
