-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "namePersian" TEXT NOT NULL,
    "cuttingDimensionCode" INTEGER NOT NULL,
    "cuttingDimensionName" TEXT NOT NULL,
    "cuttingDimensionNamePersian" TEXT NOT NULL,
    "stoneTypeCode" INTEGER NOT NULL,
    "stoneTypeName" TEXT NOT NULL,
    "stoneTypeNamePersian" TEXT NOT NULL,
    "widthCode" INTEGER NOT NULL,
    "widthValue" DECIMAL(5,2) NOT NULL,
    "widthName" TEXT NOT NULL,
    "thicknessCode" INTEGER NOT NULL,
    "thicknessValue" DECIMAL(5,2) NOT NULL,
    "thicknessName" TEXT NOT NULL,
    "mineCode" TEXT NOT NULL,
    "mineName" TEXT NOT NULL,
    "mineNamePersian" TEXT NOT NULL,
    "finishCode" INTEGER NOT NULL,
    "finishName" TEXT NOT NULL,
    "finishNamePersian" TEXT NOT NULL,
    "colorCode" INTEGER NOT NULL,
    "colorName" TEXT NOT NULL,
    "colorNamePersian" TEXT NOT NULL,
    "qualityCode" INTEGER NOT NULL,
    "qualityName" TEXT NOT NULL,
    "qualityNamePersian" TEXT NOT NULL,
    "basePrice" DECIMAL(15,2),
    "currency" TEXT NOT NULL DEFAULT 'ریال',
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "leadTime" INTEGER,
    "description" TEXT,
    "images" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_items" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unitPrice" DECIMAL(15,2) NOT NULL,
    "totalPrice" DECIMAL(15,2) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_code_key" ON "products"("code");

-- AddForeignKey
ALTER TABLE "contract_items" ADD CONSTRAINT "contract_items_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "sales_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_items" ADD CONSTRAINT "contract_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
