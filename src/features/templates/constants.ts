export const TEMPLATE_CATEGORIES = [
  "All",
  "Support",
  "Finance",
  "Revenue",
  "Data",
  "Marketing",
  "AI agents",
] as const;

export const TEMPLATE_SORTS = [
  { value: "mostInstalled", label: "Most installed" },
  { value: "recent", label: "Recently added" },
  { value: "fewestCredentials", label: "Fewest credentials" },
] as const;

export type TemplateSort = (typeof TEMPLATE_SORTS)[number]["value"];
