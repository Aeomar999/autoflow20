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
  /**
   * Which audience this entry is authored for. Defaults to `"starter"`.
   *
   * The two are genuinely different products sharing one gallery. A starter
   * template is what a brand-new account opens on its first afternoon, so it
   * is held to one connector: a template needing two is one nobody finishes
   * setting up, whatever their plan. A library template is a port of a
   * published reference automation (M10), and those are multi-service by
   * definition -- the outreach flow reads a sheet and sends Gmail, the meeting
   * briefing reads Calendar and sends Gmail. Holding those to one credential
   * would not simplify them; it would mean not shipping them.
   *
   * Not persisted. It exists so the onboarding promise stays an executable
   * rule over the entries it was ever about, rather than being quietly
   * loosened for everyone the first time a real automation needs two
   * connectors.
   */
  tier?: TemplateTier;
  graph: TemplateGraph;
}

export const TEMPLATE_TIERS = ["starter", "library"] as const;

export type TemplateTier = (typeof TEMPLATE_TIERS)[number];

/** Entries with no `tier` are starter entries -- the gallery's original shape. */
export const DEFAULT_TEMPLATE_TIER: TemplateTier = "starter";

export const tierOf = (spec: { tier?: TemplateTier }): TemplateTier =>
  spec.tier ?? DEFAULT_TEMPLATE_TIER;

export const TEMPLATE_DOMAINS = [
  "marketing",
  "support",
  "ops",
  "data",
] as const;

export type TemplateDomain = (typeof TEMPLATE_DOMAINS)[number];

/** The minimum per-domain count AF-M7-02 commits to. */
export const MIN_TEMPLATES_PER_DOMAIN = 4;

/** A starter template must be runnable after connecting at most one service. */
export const MAX_STARTER_CREDENTIALS = 1;

/**
 * The ceiling a library entry may not cross.
 *
 * Not "unlimited": the M10 source automations top out at three services plus
 * an optional model key, and an entry needing five connectors is one whose
 * setup nobody completes either. The cap is what stops "library" becoming the
 * label anything gets when the starter rule is inconvenient.
 */
export const MAX_LIBRARY_CREDENTIALS = 4;
