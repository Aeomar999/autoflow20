-- Drop the dead tutorial "Post" table left over from the create-next-app
-- Prisma example (AF-M0-02). No code references it: the model was already
-- removed from schema.prisma, and no raw SQL in the app touches this table.
DROP TABLE IF EXISTS "Post";
