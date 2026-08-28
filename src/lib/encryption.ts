/**
 * Legacy Cryptr path (AF-M0 era). Only used by `scripts/migrate-credentials.ts`
 * to decrypt pre-AF-M3-02 rows; the runtime no longer reads `ENCRYPTION_KEY`
 * (envelope vault / CREDENTIAL_MASTER_KEY instead, security.md §3).
 */
import Cryptr from "cryptr";
import { ensureEnv } from "./env";

const getCryptr = () => {
  const key = ensureEnv().ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "ENCRYPTION_KEY is required to decrypt legacy credentials (scripts/migrate-credentials.ts).",
    );
  }
  return new Cryptr(key);
};

export const encrypt = (text: string) => getCryptr().encrypt(text);
export const decrypt = (text: string) => getCryptr().decrypt(text);
