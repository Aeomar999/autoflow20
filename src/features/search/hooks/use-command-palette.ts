"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useTRPC } from "@/trpc/client";

import { rankResults } from "../lib/fuzzy";
import { ACTION_COMMANDS, NAVIGATION_COMMANDS } from "../lib/static-commands";
import type { SearchResult, SearchResultKind } from "../lib/types";

/** Debounce so a fast typist does not fire a query per keystroke. */
const SEARCH_DEBOUNCE_MS = 150;

/** Cmd+K on macOS, Ctrl+K elsewhere. Cmd+B is already the sidebar toggle. */
export function useCommandPaletteShortcut(onOpen: () => void): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "k" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      onOpen();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpen]);
}

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

export interface CommandPaletteGroup {
  kind: SearchResultKind;
  results: SearchResult[];
}

/**
 * Palette contents for the current query (AF-M7-07).
 *
 * The server returns what this tenant may see; ranking happens here. Static
 * navigation and action entries are ranked against the same query so a user
 * typing "cred" gets both the Credentials page and their own credentials,
 * ordered by how well each matched.
 */
export function useCommandPaletteResults(
  query: string,
  enabled: boolean,
): { groups: CommandPaletteGroup[]; isFetching: boolean } {
  const trpc = useTRPC();
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);

  const search = useQuery({
    ...trpc.search.query.queryOptions({ q: debouncedQuery, limit: 5 }),
    enabled,
    // Results are a navigation aid, not a source of truth — a slightly stale
    // list is better than a spinner between every keystroke.
    placeholderData: (previous) => previous,
  });

  const groups: CommandPaletteGroup[] = [
    { kind: "action", results: rankResults(ACTION_COMMANDS, query) },
    { kind: "navigation", results: rankResults(NAVIGATION_COMMANDS, query) },
    {
      kind: "workflow",
      results: rankResults(search.data?.workflows ?? [], query),
    },
    {
      kind: "execution",
      results: rankResults(search.data?.executions ?? [], query),
    },
    {
      kind: "credential",
      results: rankResults(search.data?.credentials ?? [], query),
    },
  ];

  return {
    groups: groups.filter((group) => group.results.length > 0),
    isFetching: search.isFetching,
  };
}
