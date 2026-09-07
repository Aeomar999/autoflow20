import { definition } from "./definition";

export default {
  ...definition,
  execute: () => import("./execute").then((m) => m.execute),
};
