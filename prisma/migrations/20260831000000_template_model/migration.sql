-- AF-M7-01: tenant-agnostic workflow template gallery.
--
-- Additive only. `Template` holds product content (a React Flow graph plus
-- gallery metadata); it deliberately has no workspace FK — templates are read
-- by every authenticated user from `/templates` and instantiated into a fresh
-- workspace workflow by `templates.instantiate`.
--
-- Guarded (IF NOT EXISTS) to stay replayable, matching the other additive
-- migrations.

CREATE TABLE IF NOT EXISTS "Template" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "graph" JSONB NOT NULL,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "nodeCount" INTEGER NOT NULL DEFAULT 0,
    "credentialCount" INTEGER NOT NULL DEFAULT 0,
    "author" TEXT NOT NULL DEFAULT 'AutoFlow',
    "version" TEXT NOT NULL DEFAULT '1',
    "installs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- One-click-install URLs key off the slug (/templates/<slug>).
CREATE UNIQUE INDEX IF NOT EXISTS "Template_slug_key" ON "Template"("slug");

-- Gallery browse path: active templates, filtered by category.
CREATE INDEX IF NOT EXISTS "Template_category_isActive_idx" ON "Template"("category", "isActive");