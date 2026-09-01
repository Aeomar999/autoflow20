"use client";

import {
  AlertTriangleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Loader2Icon,
  MoreVerticalIcon,
  PackageOpenIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from "lucide-react";
import Link from "next/link";

import { DashboardPage, PageHeader } from "@/components/dashboard/page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Shared chrome for the list-style dashboard pages.
 *
 * These used to render a stack of floating cards. They now render the same
 * page frame, panel and table language as the Monitoring and Costs dashboards,
 * so moving between the seven pages is one layout rather than seven.
 */

type EntityHeaderProps = {
  title: string;
  description?: string;
  newButtonLabel?: string;
  disabled?: boolean;
  isCreating?: boolean;
  /** Extra controls rendered to the left of the primary action. */
  actions?: React.ReactNode;
} & (
  | { onNew: () => void; newButtonHref?: never }
  | { newButtonHref: string; onNew?: never }
  | { onNew?: never; newButtonHref?: never }
);

export const EntityHeader = ({
  title,
  description,
  onNew,
  newButtonHref,
  newButtonLabel,
  disabled,
  isCreating,
  actions,
}: EntityHeaderProps) => (
  <PageHeader
    title={title}
    description={description}
    actions={
      <>
        {actions}
        {onNew && !newButtonHref && (
          <Button disabled={isCreating || disabled} size="sm" onClick={onNew}>
            {isCreating ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <PlusIcon className="size-4" />
            )}
            {newButtonLabel}
          </Button>
        )}
        {newButtonHref && !onNew && (
          <Button size="sm" asChild>
            <Link href={newButtonHref} prefetch>
              <PlusIcon className="size-4" />
              {newButtonLabel}
            </Link>
          </Button>
        )}
      </>
    }
  />
);

export const EntityContainer = ({
  children,
  header,
}: {
  children: React.ReactNode;
  header?: React.ReactNode;
}) => (
  <DashboardPage>
    {header}
    {children}
  </DashboardPage>
);

interface EntitySearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export const EntitySearch = ({
  value,
  onChange,
  placeholder = "Search",
  className,
}: EntitySearchProps) => (
  <div className={cn("relative w-full sm:w-56", className)}>
    <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
    <Input
      className="h-8 border-hairline bg-well pl-8 text-sm shadow-none"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  </div>
);

interface EntityPaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
  className?: string;
}

export const EntityPagination = ({
  page,
  totalPages,
  onPageChange,
  disabled,
  className,
}: EntityPaginationProps) => (
  <div
    className={cn(
      "flex items-center justify-between gap-3 border-t border-hairline bg-well px-4 py-2",
      className,
    )}
  >
    <p className="text-xs text-muted-foreground tabular-nums">
      Page {page} of {totalPages || 1}
    </p>
    <div className="flex items-center gap-1.5">
      <Button
        disabled={page === 1 || disabled}
        variant="outline"
        size="sm"
        className="h-7 border-hairline bg-panel px-2 text-xs"
        onClick={() => onPageChange(Math.max(1, page - 1))}
      >
        <ChevronLeftIcon className="size-3.5" />
        Previous
      </Button>
      <Button
        disabled={page === totalPages || totalPages === 0 || disabled}
        variant="outline"
        size="sm"
        className="h-7 border-hairline bg-panel px-2 text-xs"
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
      >
        Next
        <ChevronRightIcon className="size-3.5" />
      </Button>
    </div>
  </div>
);

interface StateViewProps {
  message?: string;
}

export const LoadingView = ({ message }: StateViewProps) => (
  <div className="flex min-h-48 flex-1 flex-col items-center justify-center gap-3">
    <Loader2Icon className="size-5 animate-spin text-primary" />
    {!!message && <p className="text-sm text-muted-foreground">{message}</p>}
  </div>
);

export const ErrorView = ({ message }: StateViewProps) => (
  <div className="flex min-h-48 flex-1 flex-col items-center justify-center gap-3">
    <AlertTriangleIcon className="size-5 text-danger" />
    {!!message && <p className="text-sm text-muted-foreground">{message}</p>}
  </div>
);

interface EmptyViewProps extends StateViewProps {
  onNew?: () => void;
  /**
   * AF-M7-05: the optional props below let a page say what is actually empty
   * and what to do about it. All are optional and the defaults reproduce the
   * previous generic card exactly, so existing callers are untouched.
   */
  title?: string;
  /** Defaults to the generic open-package glyph. */
  icon?: React.ComponentType<{ className?: string }>;
  /** Label for the `onNew` button. */
  actionLabel?: string;
  /** Rendered beside the primary action — "or start from a template". */
  secondaryAction?: { label: string; onClick: () => void };
}

export const EmptyView = ({
  message,
  onNew,
  title,
  icon: Icon = PackageOpenIcon,
  actionLabel = "Add item",
  secondaryAction,
}: EmptyViewProps) => (
  <div className="flex min-h-56 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
    <span className="flex size-10 items-center justify-center rounded-full border border-hairline bg-well text-muted-foreground">
      <Icon className="size-4" />
    </span>
    {!!title && <p className="text-sm font-medium">{title}</p>}
    {!!message && (
      <p className="max-w-sm text-sm text-balance text-muted-foreground">
        {message}
      </p>
    )}
    <div className="flex flex-wrap items-center justify-center gap-2">
      {!!onNew && (
        <Button size="sm" onClick={onNew}>
          <PlusIcon className="size-4" />
          {actionLabel}
        </Button>
      )}
      {!!secondaryAction && (
        <Button size="sm" variant="outline" onClick={secondaryAction.onClick}>
          {secondaryAction.label}
        </Button>
      )}
    </div>
  </div>
);

interface EntityListProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  getKey?: (item: T, index: number) => string | number;
  emptyView?: React.ReactNode;
  className?: string;
}

export function EntityList<T>({
  items,
  renderItem,
  getKey,
  emptyView,
  className,
}: EntityListProps<T>) {
  if (items.length === 0 && emptyView) {
    return (
      <div className="flex-1 flex justify-center items-center">
        <div className="max-w-sm mx-auto">{emptyView}</div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-y-4", className)}>
      {items.map((item, index) => (
        <div key={getKey ? getKey(item, index) : index}>
          {renderItem(item, index)}
        </div>
      ))}
    </div>
  );
}

interface EntityItemProps {
  href: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  image?: React.ReactNode;
  actions?: React.ReactNode;
  onRemove?: () => void | Promise<void>;
  isRemoving?: boolean;
  className?: string;
}

export const EntityItem = ({
  href,
  title,
  subtitle,
  image,
  actions,
  onRemove,
  isRemoving,
  className,
}: EntityItemProps) => {
  const handleRemove = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isRemoving) {
      return;
    }

    if (onRemove) {
      await onRemove();
    }
  };

  return (
    <Link href={href} prefetch>
      <Card
        className={cn(
          "p-4 shadow-none hover:shadow cursor-pointer",
          isRemoving && "opacity-50 cursor-not-allowed",
          className,
        )}
      >
        <CardContent className="flex flex-row items-center justify-between p-0">
          <div className="flex items-center gap-3">
            {image}
            <div>
              <CardTitle className="text-base font-medium">{title}</CardTitle>
              {!!subtitle && (
                <CardDescription className="text-xs">
                  {subtitle}
                </CardDescription>
              )}
            </div>
          </div>
          {(actions || onRemove) && (
            <div className="flex gap-x-4 items-center">
              {actions}
              {onRemove && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreVerticalIcon className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <DropdownMenuItem onClick={handleRemove}>
                      <TrashIcon className="size-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
};
