import { dataTemplates } from "./data";
import { engineeringTemplates } from "./engineering";
import { financeTemplates } from "./finance";
import { countRequiredCredentials } from "./harness";
import { marketingTemplates } from "./marketing";
import { opsTemplates } from "./ops";
import { supportTemplates } from "./support";
import type { TemplateSpec } from "./types";

/**
 * The authored template gallery (AF-M7-02).
 *
 * Source of truth for `Template` rows: `npm run seed:templates` projects this
 * array into the table, and `harness.test.ts` gates every entry. Nothing writes
 * a `Template` row by hand.
 */
export const templateCatalog: TemplateSpec[] = [
  ...marketingTemplates,
  ...supportTemplates,
  ...opsTemplates,
  ...dataTemplates,
  ...financeTemplates,
  ...engineeringTemplates,
];

/** The row shape `seed:templates` upserts — derived fields already resolved. */
export interface TemplateSeedRow {
  slug: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  featured: boolean;
  nodeCount: number;
  credentialCount: number;
  graph: TemplateSpec["graph"];
}

/**
 * Project a spec into its row. `nodeCount` and `credentialCount` are computed
 * from the graph, never authored — the gallery's "fewest credentials" sort is
 * only trustworthy if the number cannot drift from the graph it describes.
 */
export function toSeedRow(spec: TemplateSpec): TemplateSeedRow {
  return {
    slug: spec.slug,
    name: spec.name,
    description: spec.description,
    category: spec.category,
    tags: spec.tags,
    featured: spec.featured ?? false,
    nodeCount: spec.graph.nodes.length,
    credentialCount: countRequiredCredentials(spec),
    graph: spec.graph,
  };
}

export { checkCatalog, checkTemplate, formatIssues } from "./harness";
export type { TemplateSpec } from "./types";
export { MIN_TEMPLATES_PER_DOMAIN, TEMPLATE_DOMAINS } from "./types";
