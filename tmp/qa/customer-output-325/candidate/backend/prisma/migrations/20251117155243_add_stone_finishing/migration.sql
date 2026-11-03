-- CreateTable
CREATE TABLE "stone_finishings" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "namePersian" TEXT NOT NULL,
    "description" TEXT,
    "pricePerSquareMeter" DECIMAL(12,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stone_finishings_pkey" PRIMARY KEY ("id")
);
