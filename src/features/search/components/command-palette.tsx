"use client";

import {
  BookOpenIcon,
  KeyRoundIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  UsersIcon,
  WorkflowIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useCreateWorkflow } from "@/features/workflows/hooks/use-workflows";
import { useUpgradeModal } from "@/hooks/use-upgrade-modal";

import {
  useCommandPaletteResults,
  useCommandPaletteShortcut,
} from "../hooks/use-command-palette";
import { ACTION_CREATE_WORKFLOW } from "../lib/static-commands";
import {
  SEARCH_GROUP_LABELS,
  type SearchResult,
  type SearchResultKind,
} from "../lib/types";

const KIND_ICONS: Record<
  SearchResultKind,
  React.ComponentType<{ className?: string }>
> = {
  action: PlusIcon,
  navigation: SearchIcon,
  workflow: WorkflowIcon,
  execution: PlayIcon,
  credential: KeyRoundIcon,
  employee: UsersIcon,
};

const KIND_FALLBACK_ICON = BookOpenIcon;

/**
 * Global command palette (AF-M7-07).
 *
 * Mounted once in the dashboard layout. cmdk supplies arrow-key navigation,
 * Enter to activate, and Escape to close; `shouldFilter={false}` hands ranking
 * to `rankResults`, because the visible set was already decided by the
 * tenant-scoped `search` router and cmdk's substring filter would otherwise
 * drop rows the server deliberately returned.
 */
export const CommandPalette = () => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const createWorkflow = useCreateWorkflow();
  const { handleError, modal } = useUpgradeModal();

  const openPalette = useCallback(() => {
    setQuery("");
    setOpen(true);
  }, []);

  useCommandPaletteShortcut(openPalette);

  // Only query while the palette is open: a global shortcut must not put a
  // search request behind every page load.
  const { groups } = useCommandPaletteResults(query, open);

  const handleSelect = (result: SearchResult) => {
    setOpen(false);

    if (result.id === ACTION_CREATE_WORKFLOW) {
      createWorkflow.mutate(undefined, {
        onError: handleError,
        onSuccess: (data) => router.push(`/workflows/${data.id}`),
      });
      return;
    }

    if (result.href) router.push(result.href);
  };

  return (
    <>
      {modal}
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Command palette"
        description="Search workflows, executions, credentials, people, and pages"
        commandProps={{ shouldFilter: false }}
      >
        <CommandInput
          placeholder="Search workflows, runs, credentials, people…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>No matches.</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup
              key={group.kind}
              heading={SEARCH_GROUP_LABELS[group.kind]}
            >
              {group.results.map((result) => {
                const Icon = KIND_ICONS[result.kind] ?? KIND_FALLBACK_ICON;
                return (
                  <CommandItem
                    key={result.id}
                    value={result.id}
                    onSelect={() => handleSelect(result)}
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{result.title}</span>
                    {!!result.subtitle && (
                      <span className="ml-auto truncate pl-3 text-xs text-muted-foreground">
                        {result.subtitle}
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
};
