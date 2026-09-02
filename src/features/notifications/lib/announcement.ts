/**
 * Argument parsing for the `SYSTEM` announcement broadcast (AF-M8-13).
 *
 * Lives here rather than inside `scripts/notify-system.ts` so it is testable:
 * that script runs its `main()` on import, so anything exported from it can
 * only be exercised by running the broadcast. The rules it enforces are
 * notification rules anyway — the announcement id becomes half of a
 * `systemDedupeKey`, and a key nobody can reproduce is a broadcast nobody can
 * safely repeat.
 */

export interface AnnouncementArgs {
  id: string;
  title: string;
  message: string;
  href: string | null;
  /**
   * Organisations to restrict the broadcast to, from repeated `--org`.
   * `null` means every workspace, which is the normal case.
   */
  organizationIds: string[] | null;
  /** `--yes` was passed. Without it the caller must not write anything. */
  confirmed: boolean;
}

const VALUE_FLAGS = ["id", "title", "message", "href", "org"] as const;

/** `--org` may be given more than once; every other value flag may not. */
const REPEATABLE_FLAGS = new Set<string>(["org"]);

/**
 * Announcement ids are restricted to characters that survive being pasted
 * into a runbook, a shell, and a dedupe key unchanged. `:` in particular is
 * the key's own separator.
 */
export const ANNOUNCEMENT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

/**
 * Parse `--flag value` pairs plus the bare `--yes`.
 *
 * Deliberately strict — an unrecognised flag throws rather than being ignored.
 * The flag a typo swallows is `--yes`, and silently turning a real broadcast
 * into a dry run (or, far worse, the reverse) is the entire risk here.
 */
export function parseAnnouncementArgs(argv: string[]): AnnouncementArgs {
  const values = new Map<string, string>();
  const organizationIds: string[] = [];
  let confirmed = false;

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument "${token}".`);
    }

    const name = token.slice(2);
    if (name === "yes") {
      confirmed = true;
      continue;
    }
    if (!VALUE_FLAGS.includes(name as (typeof VALUE_FLAGS)[number])) {
      throw new Error(`Unknown flag "--${name}".`);
    }

    const value = argv[++index];
    // A missing value must not silently consume the next flag: `--title
    // --yes` would otherwise title the announcement "--yes" and quietly turn
    // the run into a dry one.
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`--${name} needs a value.`);
    }

    if (REPEATABLE_FLAGS.has(name)) {
      organizationIds.push(value.trim());
      continue;
    }
    // A value flag given twice is a mistake worth surfacing: the second
    // would silently win, and for --id that changes who has already been
    // told.
    if (values.has(name)) {
      throw new Error(`--${name} was given more than once.`);
    }
    values.set(name, value);
  }

  const missing = ["id", "title", "message"].filter(
    (name) => !values.get(name)?.trim(),
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing required flag(s): ${missing.map((name) => `--${name}`).join(", ")}.`,
    );
  }

  const id = (values.get("id") as string).trim();
  if (!ANNOUNCEMENT_ID_PATTERN.test(id)) {
    throw new Error(
      `--id must be alphanumeric with . _ - separators (got "${id}").`,
    );
  }

  return {
    id,
    title: (values.get("title") as string).trim(),
    message: (values.get("message") as string).trim(),
    href: values.get("href")?.trim() || null,
    organizationIds: organizationIds.length > 0 ? organizationIds : null,
    confirmed,
  };
}
