import { definition } from "./definition";

export default {
  ...definition,
  execute: (params: any) => import("./execute").then((m) => m.execute(params)),
};
