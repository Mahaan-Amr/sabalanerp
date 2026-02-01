/*
  Warnings:

  - Added the required column `firstName` to the `crm_customers` table without a default value. This is not possible if the table is not empty.
  - Added the required column `lastName` to the `crm_customers` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "crm_customers" ADD COLUMN     "brandName" TEXT,
ADD COLUMN     "brandNameDescription" TEXT,
ADD COLUMN     "firstName" TEXT NOT NULL,
ADD COLUMN     "homeAddress" TEXT,
ADD COLUMN     "homeNumber" TEXT,
ADD COLUMN     "isBlacklisted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastName" TEXT NOT NULL,
ADD COLUMN     "nationalCode" TEXT,
ADD COLUMN     "projectManagerName" TEXT,
ADD COLUMN     "projectManagerNumber" TEXT,
ADD COLUMN     "workAddress" TEXT,
ADD COLUMN     "workNumber" TEXT,
ALTER COLUMN "companyName" DROP NOT NULL,
ALTER COLUMN "customerType" SET DEFAULT 'Individual';

-- CreateTable
CREATE TABLE "project_addresses" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "postalCode" TEXT,
    "projectName" TEXT,
    "projectType" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_numbers" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "phone_numbers_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "project_addresses" ADD CONSTRAINT "project_addresses_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "crm_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "crm_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
