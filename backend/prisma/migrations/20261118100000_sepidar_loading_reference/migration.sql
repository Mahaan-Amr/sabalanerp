ALTER TABLE "logistics_loadings" ADD COLUMN "sepidarLoadingReference" TEXT;
CREATE UNIQUE INDEX "logistics_loadings_sepidarLoadingReference_key" ON "logistics_loadings"("sepidarLoadingReference");
