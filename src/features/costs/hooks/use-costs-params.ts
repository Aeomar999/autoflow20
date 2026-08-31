import { useQueryStates } from "nuqs";
import { costsParams } from "../params";

export const useCostsParams = () => {
  return useQueryStates(costsParams);
};
