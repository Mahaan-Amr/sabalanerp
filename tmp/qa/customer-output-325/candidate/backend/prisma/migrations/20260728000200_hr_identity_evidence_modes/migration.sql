DROP INDEX IF EXISTS "hr_hiring_documents_applicationId_category_side_version_key";

ALTER TABLE "hr_hiring_documents"
  ADD COLUMN "customTitle" TEXT,
  ALTER COLUMN "storageName" DROP NOT NULL,
  ALTER COLUMN "originalName" DROP NOT NULL,
  ALTER COLUMN "mimeType" DROP NOT NULL,
  ALTER COLUMN "size" DROP NOT NULL,
  ALTER COLUMN "sha256" DROP NOT NULL,
  ALTER COLUMN "malwareScanStatus" DROP NOT NULL;

CREATE UNIQUE INDEX "hr_hiring_documents_applicationId_category_side_customTitle_version_key"
  ON "hr_hiring_documents"("applicationId", "category", "side", "customTitle", "version");

-- PostgreSQL treats NULL values as distinct in an ordinary unique index. This
-- expression index keeps fileless/predefined and custom-title series atomic
-- even when side or customTitle is NULL.
CREATE UNIQUE INDEX "hr_hiring_documents_series_version_key"
  ON "hr_hiring_documents"(
    "applicationId",
    "category",
    COALESCE("side", ''),
    COALESCE("customTitle", ''),
    "version"
  );
