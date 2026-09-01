"use client";

import { SearchIcon } from "lucide-react";

import {
  DashboardError,
  DashboardPage,
  PageHeader,
} from "@/components/dashboard/page";
import {
  Panel,
  PanelActions,
  PanelBody,
  PanelHeader,
  PanelTitle,
} from "@/components/dashboard/panel";
import {
  EmptyView,
  EntityPagination,
  LoadingView,
} from "@/components/entity-components";
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

export const TemplatesSearch = () => {
  const [params, setParams] = useTemplatesParams();
  const { searchValue, onSearchChange } = useEntitySearch({
    params,
    setParams,
  });

  return (
    <div className="relative w-full sm:w-64">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="h-8 border-hairline bg-well pl-8 text-sm shadow-none"
        placeholder="Search templates"
        value={searchValue}
        onChange={(event) => onSearchChange(event.target.value)}
      />
    </div>
  );
};

export const TemplatesChips = () => {
  const [params, setParams] = useTemplatesParams();

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {TEMPLATE_CATEGORIES.map((category) => {
        const isActive = params.category === category;
        return (
          <button
            key={category}
            type="button"
            onClick={() =>
              setParams({
                ...params,
                category,
                page: PAGINATION.DEFAULT_PAGE,
              })
            }
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors",
              isActive
                ? "border-primary/30 bg-primary/10 font-medium text-primary"
                : "border-hairline bg-panel text-muted-foreground hover:text-foreground",
            )}
          >
            {category}
          </button>
        );
      })}
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
      <SelectTrigger
        aria-label="Sort templates"
        className="h-8 w-[170px] border-hairline bg-panel text-xs shadow-none"
      >
        <SelectValue placeholder="Sort" />
      </SelectTrigger>
      <SelectContent>
        {TEMPLATE_SORTS.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className="text-xs"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export const TemplatesGrid = () => {
  const templates = useSuspenseTemplates();

  if (templates.data.items.length === 0) {
    return <TemplatesEmpty />;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
      className="rounded-xl border border-hairline"
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
}) => (
  <DashboardPage>
    <PageHeader
      title="Templates"
      description="Ready-made workflows that run as-is. Install, connect credentials, deploy."
      actions={<TemplatesSort />}
    />

    <Panel>
      <PanelHeader>
        <PanelTitle>Browse by category</PanelTitle>
        <PanelActions>
          <TemplatesSearch />
        </PanelActions>
      </PanelHeader>
      <PanelBody className="py-3">
        <TemplatesChips />
      </PanelBody>
    </Panel>

    {children}
    <TemplatesPagination />
  </DashboardPage>
);

export const TemplatesLoading = () => (
  <LoadingView message="Loading templates..." />
);

export const TemplatesError = () => (
  <DashboardError message="Error loading templates" />
);

export const TemplatesEmpty = () => (
  <Panel>
    <EmptyView message="No templates match your filters. Try another search or category." />
  </Panel>
);
