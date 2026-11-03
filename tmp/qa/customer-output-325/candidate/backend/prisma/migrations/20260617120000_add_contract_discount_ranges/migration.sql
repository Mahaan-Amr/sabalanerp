CREATE TABLE "contract_discount_ranges" (
    "id" TEXT NOT NULL,
    "minAmount" DECIMAL(15,2) NOT NULL,
    "maxAmount" DECIMAL(15,2),
    "maxDiscountPercent" DECIMAL(5,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_discount_ranges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contract_discount_ranges_isActive_minAmount_idx" ON "contract_discount_ranges"("isActive", "minAmount");
