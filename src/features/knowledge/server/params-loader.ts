import type { SearchParams } from "nuqs";
import { knowledgeParamsCache } from "../params";

export const knowledgeParamsLoader = async (
  searchParams: Promise<SearchParams>,
) => {
  return knowledgeParamsCache.parse(await searchParams);
};
