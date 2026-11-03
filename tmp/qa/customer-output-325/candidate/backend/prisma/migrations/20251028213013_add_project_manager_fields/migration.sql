/*
  Warnings:

  - You are about to drop the column `size` on the `crm_customers` table. All the data in the column will be lost.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'SALES';
ALTER TYPE "UserRole" ADD VALUE 'MANAGER';

-- AlterTable
ALTER TABLE "contract_items" ADD COLUMN     "isMandatory" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mandatoryPercentage" DECIMAL(5,2),
ADD COLUMN     "originalTotalPrice" DECIMAL(15,2);

-- AlterTable
ALTER TABLE "crm_customers" DROP COLUMN "size";

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "project_addresses" ADD COLUMN     "projectManagerName" TEXT,
ADD COLUMN     "projectManagerNumber" TEXT;

-- CreateTable
CREATE TABLE "feature_permissions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspace" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "permissionLevel" TEXT NOT NULL,
    "grantedBy" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_feature_permissions" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "workspace" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "permissionLevel" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_feature_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cut_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "namePersian" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cut_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stone_materials" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "namePersian" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stone_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cut_widths" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "namePersian" TEXT NOT NULL,
    "value" DECIMAL(5,2) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'cm',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cut_widths_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thicknesses" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "namePersian" TEXT NOT NULL,
    "value" DECIMAL(5,2) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'cm',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "thicknesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mines" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "namePersian" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finish_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "namePersian" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finish_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "colors" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "namePersian" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "colors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "feature_permissions_userId_workspace_feature_key" ON "feature_permissions"("userId", "workspace", "feature");

-- CreateIndex
CREATE UNIQUE INDEX "role_feature_permissions_role_workspace_feature_key" ON "role_feature_permissions"("role", "workspace", "feature");

-- CreateIndex
CREATE UNIQUE INDEX "cut_types_code_key" ON "cut_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "stone_materials_code_key" ON "stone_materials"("code");

-- CreateIndex
CREATE UNIQUE INDEX "cut_widths_code_key" ON "cut_widths"("code");

-- CreateIndex
CREATE UNIQUE INDEX "thicknesses_code_key" ON "thicknesses"("code");

-- CreateIndex
CREATE UNIQUE INDEX "mines_code_key" ON "mines"("code");

-- CreateIndex
CREATE UNIQUE INDEX "finish_types_code_key" ON "finish_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "colors_code_key" ON "colors"("code");

-- AddForeignKey
ALTER TABLE "feature_permissions" ADD CONSTRAINT "feature_permissions_grantedBy_fkey" FOREIGN KEY ("grantedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_permissions" ADD CONSTRAINT "feature_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
