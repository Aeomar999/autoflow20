import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { ensureEnv } from "./env";

const globalForPrisma = global as unknown as {
  prisma: PrismaClient;
};

// Prisma 7 uses driver adapters (no Rust query engine). The pg adapter takes
// the connection URL directly instead of PrismaClient reading DATABASE_URL.
const createPrismaClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: ensureEnv().DATABASE_URL }),
  });

const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
