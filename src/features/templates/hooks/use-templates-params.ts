import { useQueryStates } from "nuqs";
import { templatesParams } from "../params";

export const useTemplatesParams = () => useQueryStates(templatesParams);
