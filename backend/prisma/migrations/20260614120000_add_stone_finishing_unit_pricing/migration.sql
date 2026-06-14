ALTER TABLE "stone_finishings"
ADD COLUMN "unitPrice" DECIMAL(12,2);

UPDATE "stone_finishings"
SET "unitPrice" = "pricePerSquareMeter"
WHERE "unitPrice" IS NULL;

ALTER TABLE "stone_finishings"
ALTER COLUMN "unitPrice" SET NOT NULL,
ALTER COLUMN "unitPrice" SET DEFAULT 0;

ALTER TABLE "stone_finishings"
ADD COLUMN "calculationBase" TEXT NOT NULL DEFAULT 'squareMeters';
