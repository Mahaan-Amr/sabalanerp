/*
  Warnings:

  - A unique constraint covering the columns `[verificationCodeId]` on the table `sales_contracts` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "sales_contracts" ADD COLUMN     "isSigned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "signedByPhoneNumber" TEXT,
ADD COLUMN     "verificationCodeId" TEXT;

-- CreateTable
CREATE TABLE "contract_verification_codes" (
    "id" TEXT NOT NULL,
    "contractId" TEXT,
    "phoneNumber" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_verification_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contract_verification_codes_contractId_phoneNumber_key" ON "contract_verification_codes"("contractId", "phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "sales_contracts_verificationCodeId_key" ON "sales_contracts"("verificationCodeId");

-- AddForeignKey
ALTER TABLE "sales_contracts" ADD CONSTRAINT "sales_contracts_verificationCodeId_fkey" FOREIGN KEY ("verificationCodeId") REFERENCES "contract_verification_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_verification_codes" ADD CONSTRAINT "contract_verification_codes_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "sales_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
