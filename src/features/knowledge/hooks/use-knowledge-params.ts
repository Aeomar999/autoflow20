import { useQueryStates } from "nuqs";
import { knowledgeParams } from "../params";

export const useKnowledgeParams = () => {
  return useQueryStates(knowledgeParams);
};
