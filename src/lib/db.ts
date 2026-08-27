import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { ensureEnv } from "./env";

const globalForPrisma = global as unknown as {
  prisma: PrismaClient;
};

const createPrismaClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: ensureEnv().DATABASE_URL }),
  });

// Lazily create the client on first property access so unit tests that import
// server modules transitively (e.g. node registry → executor → db) do not
// fail on missing env vars at module-evaluation time.
let resolvedClient: PrismaClient | undefined;
const getOrCreateClient = (): PrismaClient => {
  if (!resolvedClient) {
    resolvedClient = globalForPrisma.prisma ?? createPrismaClient();
    globalForPrisma.prisma = resolvedClient;
  }
  return resolvedClient;
};

const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new Proxy({} as PrismaClient, {
    get(_target, prop, _receiver) {
      const client = getOrCreateClient();
      const value = Reflect.get(client, prop, client);
      if (typeof value === "function") {
        return (...args: unknown[]) => Reflect.apply(value, client, args);
      }
      return value;
    },
  });

export default prisma;
