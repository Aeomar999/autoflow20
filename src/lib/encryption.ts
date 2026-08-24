import Cryptr from "cryptr";
import { ensureEnv } from "./env";

const getCryptr = () => {
  const key = ensureEnv().ENCRYPTION_KEY;
  return new Cryptr(key);
};

export const encrypt = (text: string) => getCryptr().encrypt(text);
export const decrypt = (text: string) => getCryptr().decrypt(text);
