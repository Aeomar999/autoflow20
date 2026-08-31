"use client";

import { formatDistanceToNow } from "date-fns";
import { BoxesIcon, PlugIcon } from "lucide-react";
import Link from "next/link";
import { memo } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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

export const TemplateCard = memo(({ data }: { data: TemplateCardData }) => {
  return (
    <Link href={`/templates/${data.slug}`} prefetch className="h-full">
      <Card className="h-full cursor-pointer hover:shadow transition-shadow">
        <CardHeader className="p-4 pb-2">
          <div className="flex items-start justify-between gap-2">
            <Badge variant="secondary" className="text-[10px]">
              {data.category}
            </Badge>
            {data.featured && <Badge className="text-[10px]">Featured</Badge>}
          </div>
          <CardTitle className="text-base font-medium mt-2">
            {data.name}
          </CardTitle>
          <CardDescription className="line-clamp-2 text-xs">
            {data.description}
          </CardDescription>
        </CardHeader>
        <CardFooter className="p-4 pt-0 flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <BoxesIcon className="size-3.5" />
              {data.nodeCount} nodes
            </span>
            <span className="flex items-center gap-1">
              <PlugIcon className="size-3.5" />
              {data.credentialCount} needed
            </span>
          </div>
          <span className="flex items-center gap-1">
            {data.installs} installs
          </span>
          <span className="hidden sm:inline">
            {formatDistanceToNow(data.updatedAt, { addSuffix: true })}
          </span>
        </CardFooter>
      </Card>
    </Link>
  );
});
