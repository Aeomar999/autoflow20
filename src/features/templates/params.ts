import { parseAsInteger, parseAsString, parseAsStringEnum } from "nuqs/server";
import { PAGINATION } from "@/config/constants";
import type { TemplateSort } from "./constants";
import { TEMPLATE_SORTS } from "./constants";

const DEFAULT_SORT = "mostInstalled" as const;

export const templatesParams = {
  search: parseAsString.withDefault("").withOptions({ clearOnDefault: true }),
  category: parseAsString
    .withDefault("All")
    .withOptions({ clearOnDefault: true }),
  sort: parseAsStringEnum<TemplateSort>(TEMPLATE_SORTS.map((s) => s.value))
    .withDefault(DEFAULT_SORT)
    .withOptions({ clearOnDefault: true }),
  page: parseAsInteger
    .withDefault(PAGINATION.DEFAULT_PAGE)
    .withOptions({ clearOnDefault: true }),
};
