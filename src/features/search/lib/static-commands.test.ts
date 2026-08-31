import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ACTION_COMMANDS,
  ACTION_CREATE_WORKFLOW,
  NAVIGATION_COMMANDS,
} from "./static-commands";
import { SEARCH_GROUP_LABELS, SEARCH_GROUP_ORDER } from "./types";

const APP_DIR = join(process.cwd(), "src", "app", "(dashboard)", "(rest)");

/** Does `/costs` correspond to a real page file? */
function routeExists(href: string): boolean {
  const segments = href.replace(/^\//, "").split("/");
  return existsSync(join(APP_DIR, ...segments, "page.tsx"));
}

describe("static command entries", () => {
  it("only points at routes that exist", () => {
    // A palette entry that 404s is worse than no entry. This catches a route
    // being renamed or removed without the palette being updated.
    const broken = [...NAVIGATION_COMMANDS, ...ACTION_COMMANDS]
      .filter((command) => command.href)
      .filter((command) => !routeExists(command.href as string))
      .map((command) => `${command.id} -> ${command.href}`);

    expect(broken).toEqual([]);
  });

  it("gives every entry a stable unique id", () => {
    const ids = [...NAVIGATION_COMMANDS, ...ACTION_COMMANDS].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("tags entries with the kind their group renders under", () => {
    for (const command of NAVIGATION_COMMANDS) {
      expect(command.kind).toBe("navigation");
    }
    for (const command of ACTION_COMMANDS) {
      expect(command.kind).toBe("action");
    }
  });

  it("keeps the mutation-backed action free of an href", () => {
    // `handleSelect` switches on this id BEFORE looking at `href`; an href
    // here would be dead config that silently disagrees with the behaviour.
    const create = ACTION_COMMANDS.find((c) => c.id === ACTION_CREATE_WORKFLOW);
    expect(create).toBeDefined();
    expect(create?.href).toBeUndefined();
  });

  it("labels and orders every result kind", () => {
    for (const kind of SEARCH_GROUP_ORDER) {
      expect(SEARCH_GROUP_LABELS[kind]).toBeTruthy();
    }
    expect(new Set(SEARCH_GROUP_ORDER).size).toBe(SEARCH_GROUP_ORDER.length);
  });
});
