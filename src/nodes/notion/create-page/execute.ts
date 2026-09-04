import "server-only";
import { NonRetriableError } from "inngest";
import {
  buildNotionProperty,
  type NotionPropertySchema,
  normalizeNotionId,
  notionFetch,
} from "@/features/notion/server/notion-client";
import type { NodeRun } from "@/nodes/types";

type NotionCreatePageData = {
  variableName?: string;
  credentialId?: string;
  databaseId?: string;
  properties?: string;
  content?: string;
};

/** Notion caps a single request at 100 blocks. */
const MAX_BLOCKS = 100;

export const execute: NodeRun<NotionCreatePageData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("notion-create-page", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Notion Create Page node: Variable name not configured",
      );
    }
    if (!data.databaseId) {
      throw new NonRetriableError(
        "Notion Create Page node: Database not configured",
      );
    }
    if (!data.properties) {
      throw new NonRetriableError(
        "Notion Create Page node: Properties not configured",
      );
    }

    const where = "Notion Create Page node";
    const secret = credentials?.credentialId;
    const databaseId = normalizeNotionId(resolve(data.databaseId), where);

    let authored: Record<string, unknown>;
    try {
      const parsed = JSON.parse(resolve(data.properties));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("not an object");
      }
      authored = parsed as Record<string, unknown>;
    } catch {
      throw new NonRetriableError(
        `${where}: the properties expression did not resolve to a JSON object of { "Column name": "value" }. Use three braces — {{{json row}}} — rather than two, which HTML-escapes the quotes.`,
      );
    }

    // Read the schema first so each value can be wrapped for its column's
    // declared type. Notion's property values are a tagged union and the tag
    // must match the column exactly; guessing produces a validation error that
    // does not name the offending column.
    const database = await notionFetch<{
      properties?: Record<string, NotionPropertySchema>;
      title?: Array<{ plain_text?: string }>;
    }>(secret, { path: `/databases/${databaseId}`, where });

    const schema = database.properties ?? {};
    const properties: Record<string, unknown> = {};
    const unknownColumns: string[] = [];
    const uncomputableColumns: string[] = [];

    for (const [name, rawValue] of Object.entries(authored)) {
      const column = schema[name];
      if (!column) {
        unknownColumns.push(name);
        continue;
      }
      const built = buildNotionProperty(
        column.type,
        typeof rawValue === "string" ? rawValue : JSON.stringify(rawValue),
      );
      if (built === undefined) {
        uncomputableColumns.push(`${name} (${column.type ?? "unknown type"})`);
        continue;
      }
      properties[name] = built;
    }

    if (unknownColumns.length > 0) {
      // Failing loudly beats creating a row with the columns silently missing:
      // Notion is case-sensitive about property names, so this is nearly
      // always a capitalisation mismatch the author can fix in seconds.
      throw new NonRetriableError(
        `${where}: this database has no column named ${unknownColumns
          .map((c) => `"${c}"`)
          .join(
            ", ",
          )}. Notion property names are case-sensitive. Columns available: ${
          Object.keys(schema).join(", ") || "none"
        }.`,
      );
    }

    if (Object.keys(properties).length === 0) {
      throw new NonRetriableError(
        `${where}: none of the supplied values could be written${
          uncomputableColumns.length > 0
            ? ` — ${uncomputableColumns.join(", ")} ${
                uncomputableColumns.length === 1 ? "is" : "are"
              } computed by Notion and cannot be set`
            : ""
        }.`,
      );
    }

    const children = data.content
      ? resolve(data.content)
          .split(/\n{2,}/)
          .map((block) => block.trim())
          .filter(Boolean)
          .slice(0, MAX_BLOCKS)
          .map((block) => ({
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [
                { type: "text", text: { content: block.slice(0, 2000) } },
              ],
            },
          }))
      : [];

    const page = await notionFetch<{ id?: string; url?: string }>(secret, {
      path: "/pages",
      method: "POST",
      body: {
        parent: { database_id: databaseId },
        properties,
        ...(children.length > 0 ? { children } : {}),
      },
      where,
    });

    return {
      ...context,
      [data.variableName]: {
        id: page.id ?? null,
        url: page.url ?? null,
        databaseId,
        // Reported rather than silent: a computed column the author tried to
        // set was skipped, and they should know which.
        skippedColumns: uncomputableColumns,
      },
    };
  });
