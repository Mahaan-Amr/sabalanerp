-- Add contract visibility flags to products
ALTER TABLE "products"
    ADD COLUMN "availableInLongitudinalContracts" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "availableInStairContracts" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "availableInSlabContracts" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "availableInVolumetricContracts" BOOLEAN NOT NULL DEFAULT true;

