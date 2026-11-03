CREATE TABLE IF NOT EXISTS "security_instant_report_categories" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "security_instant_report_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "security_instant_report_categories_name_key"
  ON "security_instant_report_categories"("name");

CREATE INDEX IF NOT EXISTS "security_instant_report_categories_isActive_displayOrder_idx"
  ON "security_instant_report_categories"("isActive", "displayOrder");

ALTER TABLE "security_instant_report_categories"
  ADD CONSTRAINT "security_instant_report_categories_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "security_instant_report_categories" (
  "id",
  "name",
  "description",
  "displayOrder",
  "isActive",
  "createdBy",
  "createdAt",
  "updatedAt"
)
SELECT
  'sirc_' || md5('default-general-' || seed_user."id"),
  'عمومی',
  'دسته‌بندی پیش‌فرض برای انواع گزارش لحظه‌ای موجود',
  0,
  true,
  seed_user."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT u."id"
  FROM "users" u
  ORDER BY
    CASE u."role" WHEN 'ADMIN' THEN 0 WHEN 'MANAGER' THEN 1 ELSE 2 END,
    u."createdAt" ASC
  LIMIT 1
) seed_user
WHERE NOT EXISTS (
  SELECT 1 FROM "security_instant_report_categories" category WHERE category."name" = 'عمومی'
);

ALTER TABLE "security_instant_report_types"
  ADD COLUMN IF NOT EXISTS "categoryId" TEXT;

UPDATE "security_instant_report_types"
SET "categoryId" = (
  SELECT "id"
  FROM "security_instant_report_categories"
  WHERE "name" = 'عمومی'
  LIMIT 1
)
WHERE "categoryId" IS NULL;

ALTER TABLE "security_instant_report_types"
  ALTER COLUMN "categoryId" SET NOT NULL;

DROP INDEX IF EXISTS "security_instant_report_types_name_key";

CREATE UNIQUE INDEX IF NOT EXISTS "security_instant_report_types_categoryId_name_key"
  ON "security_instant_report_types"("categoryId", "name");

CREATE INDEX IF NOT EXISTS "security_instant_report_types_categoryId_isActive_displayOrder_idx"
  ON "security_instant_report_types"("categoryId", "isActive", "displayOrder");

ALTER TABLE "security_instant_report_types"
  ADD CONSTRAINT "security_instant_report_types_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "security_instant_report_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
