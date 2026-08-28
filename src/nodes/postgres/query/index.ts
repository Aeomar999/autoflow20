import { definition } from "./definition";
import { execute } from "./execute";

export const postgresQuery = { ...definition, execute };

export default postgresQuery;
