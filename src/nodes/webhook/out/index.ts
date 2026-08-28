import { definition } from "./definition";
import { execute } from "./execute";

export const webhookOut = { ...definition, execute };
export default webhookOut;
