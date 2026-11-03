-- AlterTable
ALTER TABLE "contract_templates" ADD COLUMN     "calculations" JSONB,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "structure" JSONB;

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "calculations" JSONB,
ADD COLUMN     "contractData" JSONB,
ADD COLUMN     "signatures" JSONB;
