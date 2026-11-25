CREATE TABLE "project_return_allocation_drafts" (
  "id" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "number" INTEGER NOT NULL CHECK ("number" > 0),
  "items" JSONB NOT NULL CHECK (jsonb_typeof("items") = 'array'),
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_return_allocation_drafts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_return_allocation_drafts_versionId_fkey"
    FOREIGN KEY ("versionId") REFERENCES "project_return_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "project_return_allocation_drafts_versionId_number_key"
  ON "project_return_allocation_drafts"("versionId", "number");

CREATE TRIGGER "project_return_allocation_drafts_immutable" BEFORE UPDATE OR DELETE
  ON "project_return_allocation_drafts" FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();
