import type { NodeRegistration } from "@/nodes/types";
import { definition } from "./definition";
import { execute } from "./execute";

export default {
  ...definition,
  execute,
} satisfies NodeRegistration;
