import { createLoader } from "nuqs/server";
import { monitoringParams } from "../params";

export const monitoringParamsLoader = createLoader(monitoringParams);
