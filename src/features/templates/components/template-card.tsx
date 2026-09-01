"use client";

import { formatDistanceToNow } from "date-fns";
import { BoxesIcon, DownloadIcon, PlugIcon } from "lucide-react";
import Link from "next/link";
import { memo } from "react";

import { StatusPill } from "@/components/dashboard/status-pill";

export type TemplateCardData = {
  slug: string;
  name: string;
  description: string;
  category: string;
  featured: boolean;
  nodeCount: number;
  credentialCount: number;
  author: string;
  version: string;
  installs: number;
  updatedAt: Date;
};

export const TemplateCard = memo(({ data }: { data: TemplateCardData }) => (
  <Link
    href={`/templates/${data.slug}`}
    prefetch
    className="group flex h-full flex-col overflow-hidden rounded-xl border border-hairline bg-panel transition-colors hover:border-primary/40"
  >
    <div className="flex flex-1 flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="dash-label text-muted-foreground">
          {data.category}
        </span>
        {data.featured ? <StatusPill tone="accent">Featured</StatusPill> : null}
      </div>
      <h3 className="font-medium transition-colors group-hover:text-primary">
        {data.name}
      </h3>
      <p className="line-clamp-2 text-xs text-muted-foreground">
        {data.description}
      </p>
    </div>

    <div className="flex items-center justify-between gap-3 border-t border-hairline bg-well px-4 py-2 text-xs text-muted-foreground">
      <span className="flex items-center gap-3">
        <span className="flex items-center gap-1 tabular-nums">
          <BoxesIcon className="size-3.5" />
          {data.nodeCount} nodes
        </span>
        <span className="flex items-center gap-1 tabular-nums">
          <PlugIcon className="size-3.5" />
          {data.credentialCount} keys
        </span>
        <span className="flex items-center gap-1 tabular-nums">
          <DownloadIcon className="size-3.5" />
          {data.installs}
        </span>
      </span>
      <span className="hidden truncate sm:inline">
        {formatDistanceToNow(data.updatedAt, { addSuffix: true })}
      </span>
    </div>
  </Link>
));
TemplateCard.displayName = "TemplateCard";
