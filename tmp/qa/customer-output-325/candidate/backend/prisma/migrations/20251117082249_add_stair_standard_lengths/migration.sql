-- CreateTable
CREATE TABLE "stair_standard_lengths" (
    "id" TEXT NOT NULL,
    "label" TEXT,
    "value" DECIMAL(8,3) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'm',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stair_standard_lengths_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stair_standard_lengths_value_unit_key" ON "stair_standard_lengths"("value", "unit");
