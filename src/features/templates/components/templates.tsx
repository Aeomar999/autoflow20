"use client";

import { SearchIcon } from "lucide-react";
import {
  EmptyView,
  EntityHeader,
  EntityPagination,
  ErrorView,
  LoadingView,
} from "@/components/entity-components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PAGINATION } from "@/config/constants";
import { useEntitySearch } from "@/hooks/use-entity-search";
import { cn } from "@/lib/utils";
import type { TemplateSort } from "../constants";
import { TEMPLATE_CATEGORIES, TEMPLATE_SORTS } from "../constants";
import { useSuspenseTemplates, useTemplates } from "../hooks/use-templates";
import { useTemplatesParams } from "../hooks/use-templates-params";
import { TemplateCard } from "./template-card";

export const TemplatesHeader = () => {
  return (
    <EntityHeader
      title="Templates"
      description="Ready-made workflows that run as-is. Install, connect credentials, deploy."
    />
  );
};

export const TemplatesSearch = () => {
  const [params, setParams] = useTemplatesParams();
  const { searchValue, onSearchChange } = useEntitySearch({
    params,
    setParams,
  });

  return (
    <div className="relative w-full max-w-xs">
      <SearchIcon className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="pl-8 bg-background shadow-none border-border"
        placeholder="Search templates"
        value={searchValue}
        onChange={(e) => onSearchChange(e.target.value)}
      />
    </div>
  );
};

export const TemplatesChips = () => {
  const [params, setParams] = useTemplatesParams();

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {TEMPLATE_CATEGORIES.map((category) => (
        <Button
          key={category}
          size="sm"
          variant={params.category === category ? "secondary" : "ghost"}
          className={cn(
            "h-7 rounded-full px-3 text-xs",
            params.category === category && "font-medium",
          )}
          onClick={() =>
            setParams({
              ...params,
              category,
              page: PAGINATION.DEFAULT_PAGE,
            })
          }
        >
          {category}
        </Button>
      ))}
    </div>
  );
};

export const TemplatesSort = () => {
  const [params, setParams] = useTemplatesParams();

  return (
    <Select
      value={params.sort}
      onValueChange={(sort) =>
        setParams({
          ...params,
          sort: sort as TemplateSort,
          page: PAGINATION.DEFAULT_PAGE,
        })
      }
    >
      <SelectTrigger className="w-[170px] h-8 text-xs">
        <SelectValue placeholder="Sort" />
      </SelectTrigger>
      <SelectContent>
        {TEMPLATE_SORTS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export const TemplatesToolbar = () => {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <TemplatesSearch />
      <div className="grow flex flex-wrap items-center justify-between gap-3">
        <TemplatesChips />
        <TemplatesSort />
      </div>
    </div>
  );
};

export const TemplatesGrid = () => {
  const templates = useSuspenseTemplates();

  if (templates.data.items.length === 0) {
    return (
      <div className="flex-1 flex justify-center items-center">
        <div className="max-w-sm mx-auto">
          <TemplatesEmpty />
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {templates.data.items.map((template) => (
        <TemplateCard key={template.id} data={template} />
      ))}
    </div>
  );
};

export const TemplatesPagination = () => {
  const templates = useTemplates();
  const [params, setParams] = useTemplatesParams();

  if (!templates.data) return null;

  return (
    <EntityPagination
      disabled={templates.isFetching}
      totalPages={templates.data.totalPages}
      page={templates.data.page}
      onPageChange={(page) => setParams({ ...params, page })}
    />
  );
};

export const TemplatesContainer = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  return (
    <div className="p-4 md:px-10 md:py-6 h-full">
      <div className="mx-auto max-w-screen-xl w-full flex flex-col gap-y-8 h-full">
        <TemplatesHeader />
        <div className="flex flex-col gap-y-4 h-full">
          <TemplatesToolbar />
          {children}
        </div>
        <TemplatesPagination />
      </div>
    </div>
  );
};

export const TemplatesLoading = () => {
  return <LoadingView message="Loading templates..." />;
};

export const TemplatesError = () => {
  return <ErrorView message="Error loading templates" />;
};

export const TemplatesEmpty = () => {
  return (
    <EmptyView message="No templates match your filters. Try another search or category." />
  );
};
