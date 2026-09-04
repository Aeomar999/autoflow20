import { definition } from "./definition";
import { execute } from "./execute";
import { polling } from "./polling";

const registration = { ...definition, execute, polling };
export default registration;
