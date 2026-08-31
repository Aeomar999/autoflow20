import type { TemplateGraph } from "../server/instantiate";

/**
 * Authored template spec (AF-M7-02).
 *
 * The catalogue is the source of truth for gallery content; `Template` rows are
 * a projection of it written by `npm run seed:templates`. Everything derivable
 * from the graph — `nodeCount`, `credentialCount` — is computed at seed time
 * rather than authored, so a spec and its row can never disagree.
 *
 * Node ids inside `graph` are authored, human-readable slugs ("trigger",
 * "triage"), not cuids: they are stable across re-seeds, they read well in a
 * diff, and `prepareTemplateGraph` rotates them to fresh cuids on every
 * install anyway.
 */
export interface TemplateSpec {
  /** URL segment for `/templates/[slug]`; unique, kebab-case, permanent. */
  slug: string;
  name: string;
  /** One paragraph: what it does, what the user must supply. */
  description: string;
  /** Gallery filter chip — must be one of `TEMPLATE_CATEGORIES`. */
  category: string;
  /** Open-set search terms. */
  tags: string[];
  /** Surfaced first in the gallery. */
  featured?: boolean;
  /**
   * The delivery domain this template is authored for. Not persisted — it
   * exists so the catalogue can prove the AF-M7-02 coverage requirement
   * (≥4 templates per domain) as a test rather than a claim.
   */
  domain: TemplateDomain;
  graph: TemplateGraph;
}

export const TEMPLATE_DOMAINS = [
  "marketing",
  "support",
  "ops",
  "data",
] as const;

export type TemplateDomain = (typeof TEMPLATE_DOMAINS)[number];

/** The minimum per-domain count AF-M7-02 commits to. */
export const MIN_TEMPLATES_PER_DOMAIN = 4;
