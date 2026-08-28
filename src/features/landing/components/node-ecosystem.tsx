"use client";

import {
  ArrowRightIcon,
  CodeIcon,
  DatabaseIcon,
  GlobeIcon,
  LayersIcon,
  SearchIcon,
} from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CONNECTOR_CATALOGUE } from "../data/mock-workflows";

export const NodeEcosystem = () => {
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const categories = [
    "All",
    "AI",
    "Triggers",
    "Messaging",
    "Databases",
    "Commerce",
    "Logic",
  ];

  const filteredConnectors = CONNECTOR_CATALOGUE.filter((item) => {
    const matchesCategory =
      selectedCategory === "All" || item.category === selectedCategory;
    const matchesSearch =
      searchQuery.trim() === "" ||
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.badgeText.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesCategory && matchesSearch;
  });

  return (
    <section
      id="connectors"
      className="border-t border-border/50 py-20 sm:py-28"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col items-center justify-between gap-4 md:flex-row md:items-end">
          <div>
            <Badge
              variant="outline"
              className="border-primary/30 bg-primary/5 text-primary text-xs"
            >
              Extensible Node Ecosystem
            </Badge>
            <h2 className="mt-3 font-bold text-3xl tracking-tight text-foreground sm:text-4xl">
              Connect your stack with zero friction
            </h2>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Pre-built triggers, AI models, databases, and communication nodes
              — all validated with strict Zod contracts and encrypted
              credentials.
            </p>
          </div>

          {/* Search Box */}
          <div className="relative w-full max-w-xs">
            <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search nodes & triggers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 text-xs h-9"
            />
          </div>
        </div>

        {/* Filter Pills */}
        <div className="mt-8 flex flex-wrap items-center gap-2 border-b border-border/50 pb-4">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                selectedCategory === cat
                  ? "bg-primary text-primary-foreground shadow-2xs"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {cat === "All" ? "All Connectors (12+)" : cat}
            </button>
          ))}
        </div>

        {/* Connectors Grid */}
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredConnectors.map((item) => (
            <div
              key={item.id}
              className="group relative flex flex-col justify-between rounded-xl border border-border/80 bg-card p-4 transition-all hover:border-primary/50 hover:shadow-sm"
            >
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex size-9 items-center justify-center rounded-lg border border-border/80 bg-muted/40 p-1.5 shadow-2xs">
                    {item.iconSrc ? (
                      <Image
                        src={item.iconSrc}
                        alt={item.name}
                        width={24}
                        height={24}
                        className="object-contain"
                      />
                    ) : item.lucideIcon === "Database" ? (
                      <DatabaseIcon className="size-4 text-primary" />
                    ) : item.lucideIcon === "Globe" ? (
                      <GlobeIcon className="size-4 text-primary" />
                    ) : (
                      <LayersIcon className="size-4 text-primary" />
                    )}
                  </div>
                  <Badge
                    variant="secondary"
                    className="font-mono text-[10px] text-muted-foreground"
                  >
                    {item.badgeText}
                  </Badge>
                </div>

                <h3 className="mt-3.5 font-semibold text-sm text-foreground">
                  {item.name}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground line-clamp-2">
                  {item.description}
                </p>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-border/40 pt-3 text-[10px] font-mono text-muted-foreground">
                <span>
                  {item.ports.inputs} in · {item.ports.outputs} out
                </span>
                <span className="text-primary group-hover:underline">
                  View schema →
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Extensibility Banner */}
        <div className="mt-12 flex flex-col items-center justify-between gap-4 rounded-2xl border border-border/80 bg-gradient-to-r from-muted/50 via-card to-muted/50 p-6 sm:flex-row sm:px-8">
          <div className="flex items-center gap-3.5">
            <div className="flex size-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <CodeIcon className="size-5" />
            </div>
            <div>
              <h4 className="font-semibold text-sm text-foreground">
                Need a bespoke internal integration?
              </h4>
              <p className="text-xs text-muted-foreground">
                Write a type-safe{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                  NodeDefinition
                </code>{" "}
                with Zod and register it in 20 lines of code.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            asChild
            className="shrink-0 text-xs"
          >
            <a href="#sdk" className="flex items-center gap-1.5">
              <span>Inspect Node SDK</span>
              <ArrowRightIcon className="size-3" />
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
};
