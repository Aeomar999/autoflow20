import { useQueryStates } from "nuqs";
import { employeesParams } from "../params";

export const useEmployeesParams = () => {
  return useQueryStates(employeesParams);
};
