"use client";

import { useRouter } from "next/navigation";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Table primitives for the dashboard panels.
 *
 * Separate from `ui/table` on purpose: these carry the panel's own chrome
 * (mono column headers on the inset well, hairline row rules, no outer border
 * because the Panel already draws one) and nothing else in the app should
 * inherit that.
 */
export const DataTable = ({
  className,
  ...props
}: React.ComponentProps<"table">) => (
  <div className="w-full overflow-x-auto">
    <table
      className={cn("w-full border-collapse text-sm", className)}
      {...props}
    />
  </div>
);

export const THead = ({
  className,
  ...props
}: React.ComponentProps<"thead">) => (
  <thead className={cn("bg-well", className)} {...props} />
);

export const TH = ({
  className,
  align = "left",
  ...props
}: React.ComponentProps<"th"> & { align?: "left" | "right" | "center" }) => (
  <th
    scope="col"
    className={cn(
      "dash-label h-9 px-4 font-medium whitespace-nowrap text-muted-foreground",
      "border-b border-hairline",
      align === "right" && "text-right",
      align === "center" && "text-center",
      align === "left" && "text-left",
      className,
    )}
    {...props}
  />
);

export const TBody = ({
  className,
  ...props
}: React.ComponentProps<"tbody">) => <tbody className={className} {...props} />;

export const TD = ({
  className,
  align = "left",
  ...props
}: React.ComponentProps<"td"> & { align?: "left" | "right" | "center" }) => (
  <td
    className={cn(
      "px-4 py-3 align-middle",
      align === "right" && "text-right",
      align === "center" && "text-center",
      className,
    )}
    {...props}
  />
);

/**
 * A table row that behaves like a link without nesting an anchor around
 * `<tr>`. The row click is a convenience; the real navigation target is the
 * `<Link>` the caller puts in the primary cell, which keeps the row reachable
 * by keyboard and openable in a new tab.
 */
export const TR = ({
  href,
  className,
  ...props
}: React.ComponentProps<"tr"> & { href?: string }) => {
  const router = useRouter();

  return (
    <tr
      className={cn(
        "border-b border-hairline transition-colors last:border-b-0",
        href ? "cursor-pointer hover:bg-well" : "hover:bg-well/60",
        className,
      )}
      onClick={
        href
          ? (event) => {
              // Let real interactive children (links, menus, checkboxes)
              // handle their own click instead of navigating twice.
              if ((event.target as HTMLElement).closest("a,button,input"))
                return;
              router.push(href);
            }
          : undefined
      }
      {...props}
    />
  );
};

export const TableEmpty = ({
  colSpan,
  children,
}: {
  colSpan: number;
  children: React.ReactNode;
}) => (
  <tr>
    <td
      colSpan={colSpan}
      className="px-6 py-10 text-center text-sm text-muted-foreground"
    >
      <div className="mx-auto max-w-md text-balance">{children}</div>
    </td>
  </tr>
);

/** Shimmer rows sized like the real table, for Suspense fallbacks. */
export const TableSkeleton = ({
  rows = 6,
  columns,
}: {
  rows?: number;
  columns: number;
}) => (
  <>
    {Array.from({ length: rows }).map((_, rowIndex) => (
      <tr
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder
        key={rowIndex}
        className="border-b border-hairline last:border-b-0"
      >
        {Array.from({ length: columns }).map((__, cellIndex) => (
          <td
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder
            key={cellIndex}
            className="px-4 py-3"
          >
            <span
              className="block h-3.5 animate-pulse rounded bg-muted"
              style={{ width: cellIndex === 0 ? "60%" : "40%" }}
            />
          </td>
        ))}
      </tr>
    ))}
  </>
);

/**
 * Row-action trigger. A bordered square rather than a bare ghost icon, so the
 * "more" control is findable in a dense row without being loud.
 */
export const rowActionClassName =
  "size-7 rounded-md border border-hairline bg-panel text-muted-foreground hover:text-foreground";
