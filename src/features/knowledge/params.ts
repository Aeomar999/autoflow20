import {
  createSearchParamsCache,
  parseAsInteger,
  parseAsString,
} from "nuqs/server";
import { PAGINATION } from "@/config/constants";

export const knowledgeParams = {
  page: parseAsInteger
    .withDefault(PAGINATION.DEFAULT_PAGE)
    .withOptions({ shallow: false }),
  pageSize: parseAsInteger
    .withDefault(PAGINATION.DEFAULT_PAGE_SIZE)
    .withOptions({ shallow: false }),
  search: parseAsString.withDefault("").withOptions({ shallow: false }),
};

export const knowledgeParamsCache = createSearchParamsCache(knowledgeParams);
