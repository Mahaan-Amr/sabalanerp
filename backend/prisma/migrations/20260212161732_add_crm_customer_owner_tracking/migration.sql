-- AlterTable
ALTER TABLE "crm_customers" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "ownerUserId" TEXT,
ADD COLUMN     "updatedBy" TEXT;

-- CreateIndex
CREATE INDEX "crm_customers_ownerUserId_idx" ON "crm_customers"("ownerUserId");

-- CreateIndex
CREATE INDEX "crm_customers_createdBy_idx" ON "crm_customers"("createdBy");

-- AddForeignKey
ALTER TABLE "crm_customers" ADD CONSTRAINT "crm_customers_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_customers" ADD CONSTRAINT "crm_customers_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_customers" ADD CONSTRAINT "crm_customers_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
