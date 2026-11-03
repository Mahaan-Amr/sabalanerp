-- CreateTable
CREATE TABLE "sub_services" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "namePersian" TEXT NOT NULL,
    "description" TEXT,
    "pricePerMeter" DECIMAL(10,2) NOT NULL,
    "calculationBase" TEXT NOT NULL DEFAULT 'length',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sub_services_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sub_services_code_key" ON "sub_services"("code");
