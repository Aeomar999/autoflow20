import { NonRetriableError } from "inngest";

/**
 * Run-time helpers for the Slack nodes (AF-M10-17).
 *
 * **Server-side only, and deliberately not in a module a `definition.ts`
 * imports.** This throws `NonRetriableError`, a value import from `inngest`,
 * whose entry point reaches `node:async_hooks` — unbundlable for the browser.
 * Definitions take their vocabulary from `@/features/slack/scopes` instead,
 * which is client-safe. `src/nodes/client-boundary.test.ts` enforces the split.
 */

/**
 * Parse a resolved Block Kit expression.
 *
 * Blocks are authored as a JSON template, so the two-brace mistake —
 * `{{json blocks}}`, which HTML-escapes every quote — is the most likely
 * authoring error by a wide margin and gets its own message.
 */
export function parseSlackBlocks(rendered: string, where: string): unknown[] {
  const trimmed = rendered.trim();
  if (trimmed.length === 0) {
    throw new NonRetriableError(
      `${where}: the blocks expression resolved to nothing.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new NonRetriableError(
      `${where}: the blocks expression did not resolve to JSON. Use three braces — {{{json message.blocks}}} — rather than two, which HTML-escapes the quotes.`,
    );
  }

  if (!Array.isArray(parsed)) {
    // Slack's own error for this is `invalid_blocks`, which does not say that
    // the payload needs to be an array rather than a single block object.
    throw new NonRetriableError(
      `${where}: Block Kit expects an array of block objects. Wrap a single block in [ ].`,
    );
  }

  return parsed;
}
