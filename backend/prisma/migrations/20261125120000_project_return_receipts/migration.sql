-- CreateTable
CREATE TABLE "project_return_cases" (
    "id" TEXT NOT NULL,
    "guardVisitId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "intakeHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_return_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_return_versions" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "baseVersionId" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedBy" TEXT NOT NULL,

    CONSTRAINT "project_return_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_return_version_projects" (
    "versionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,

    CONSTRAINT "project_return_version_projects_pkey" PRIMARY KEY ("versionId","projectId")
);

-- CreateTable
CREATE TABLE "project_return_version_items" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "healthyQuantity" DECIMAL(65,30) NOT NULL,
    "damagedQuantity" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "project_return_version_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_return_cases_guardVisitId_key" ON "project_return_cases"("guardVisitId");

-- CreateIndex
CREATE INDEX "project_return_cases_createdAt_id_idx" ON "project_return_cases"("createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "project_return_versions_caseId_number_key" ON "project_return_versions"("caseId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "project_return_versions_caseId_id_key" ON "project_return_versions"("caseId", "id");

-- CreateIndex
CREATE INDEX "project_return_version_projects_projectId_idx" ON "project_return_version_projects"("projectId");

-- CreateIndex
CREATE INDEX "project_return_version_items_productId_idx" ON "project_return_version_items"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "project_return_version_items_versionId_productId_unit_key" ON "project_return_version_items"("versionId", "productId", "unit");

-- AddForeignKey
ALTER TABLE "project_return_cases" ADD CONSTRAINT "project_return_cases_guardVisitId_fkey" FOREIGN KEY ("guardVisitId") REFERENCES "guard_driver_queue_turns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_return_cases" ADD CONSTRAINT "project_return_cases_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "crm_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_return_versions" ADD CONSTRAINT "project_return_versions_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "project_return_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_return_versions" ADD CONSTRAINT "project_return_versions_caseId_baseVersionId_fkey" FOREIGN KEY ("caseId", "baseVersionId") REFERENCES "project_return_versions"("caseId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_return_version_projects" ADD CONSTRAINT "project_return_version_projects_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "project_return_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_return_version_projects" ADD CONSTRAINT "project_return_version_projects_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project_addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_return_version_items" ADD CONSTRAINT "project_return_version_items_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "project_return_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_return_version_items" ADD CONSTRAINT "project_return_version_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_return_versions" ADD CONSTRAINT "project_return_version_lineage_check"
    CHECK (("number" = 1 AND "baseVersionId" IS NULL) OR
           ("number" > 1 AND "baseVersionId" IS NOT NULL AND "baseVersionId" <> "id"));

ALTER TABLE "project_return_version_items" ADD CONSTRAINT "project_return_item_quantities_check"
    CHECK ("unit" IN ('squareMeter', 'meter', 'count', 'ton')
       AND "healthyQuantity" >= 0 AND "damagedQuantity" >= 0
       AND ("healthyQuantity" > 0 OR "damagedQuantity" > 0)
       AND ("unit" <> 'count' OR
            ("healthyQuantity" = trunc("healthyQuantity") AND "damagedQuantity" = trunc("damagedQuantity"))));
