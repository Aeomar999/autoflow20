import "server-only";
import { NonRetriableError } from "inngest";
import {
  NOTION_MAX_PAGE_BUDGET,
  normalizeNotionId,
  notionFetch,
  readNotionProperty,
} from "@/features/notion/server/notion-client";
import type { NodeRun } from "@/nodes/types";

type NotionQueryData = {
  variableName?: string;
  credentialId?: string;
  databaseId?: string;
  filter?: string;
  sortProperty?: string;
  sortDirection?: "ascending" | "descending";
  limit?: number;
};

interface NotionPage {
  id?: string;
  url?: string;
  created_time?: string;
  last_edited_time?: string;
  properties?: Record<string, unknown>;
}

/** Notion caps a query page at 100. */
const PAGE_SIZE = 100;

export const execute: NodeRun<NotionQueryData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("notion-query-database", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Notion Query node: Variable name not configured",
      );
    }
    if (!data.databaseId) {
      throw new NonRetriableError("Notion Query node: Database not configured");
    }

    const where = "Notion Query node";
    const secret = credentials?.credentialId;
    const databaseId = normalizeNotionId(resolve(data.databaseId), where);
    const limit = data.limit ?? 100;

    let filter: unknown;
    if (data.filter) {
      const rendered = resolve(data.filter).trim();
      if (rendered.length > 0) {
        try {
          filter = JSON.parse(rendered);
        } catch {
          throw new NonRetriableError(
            `${where}: the filter expression did not resolve to JSON. Use three braces — {{{json myFilter}}} — rather than two, which HTML-escapes the quotes.`,
          );
        }
      }
    }

    const rows: NotionPage[] = [];
    let cursor: string | undefined;
    let pages = 0;
    let hasMore = false;

    while (pages < NOTION_MAX_PAGE_BUDGET && rows.length < limit) {
      const page = await notionFetch<{
        results?: NotionPage[];
        has_more?: boolean;
        next_cursor?: string | null;
      }>(secret, {
        path: `/databases/${databaseId}/query`,
        method: "POST",
        body: {
          ...(filter ? { filter } : {}),
          ...(data.sortProperty
            ? {
                sorts: [
                  {
                    property: resolve(data.sortProperty).trim(),
                    direction: data.sortDirection ?? "descending",
                  },
                ],
              }
            : {}),
          page_size: Math.min(limit - rows.length, PAGE_SIZE),
          ...(cursor ? { start_cursor: cursor } : {}),
        },
        where,
      });

      rows.push(...(page.results ?? []));
      pages += 1;
      hasMore = Boolean(page.has_more);
      cursor = page.next_cursor ?? undefined;
      if (!hasMore || !cursor) break;
    }

    const items = rows.slice(0, limit).map((row) => {
      const flattened: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(row.properties ?? {})) {
        flattened[name] = readNotionProperty(value);
      }
      return {
        id: row.id ?? null,
        url: row.url ?? null,
        createdAt: row.created_time ?? null,
        updatedAt: row.last_edited_time ?? null,
        // Flattened to plain values so downstream templates read
        // {{rows.items.0.Name}} rather than Notion's nested union.
        properties: flattened,
      };
    });

    return {
      ...context,
      [data.variableName]: {
        databaseId,
        items,
        count: items.length,
        truncated: hasMore || rows.length > limit,
      },
    };
  });
