/*
  Warnings:

  - The values [CREDIT] on the enum `PaymentMethod` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `creditLimit` on the `payments` table. All the data in the column will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "PaymentMethod_new" AS ENUM ('CASH', 'RECEIPT', 'CHECK');
ALTER TABLE "payments" ALTER COLUMN "paymentMethod" TYPE "PaymentMethod_new" USING ("paymentMethod"::text::"PaymentMethod_new");
ALTER TYPE "PaymentMethod" RENAME TO "PaymentMethod_old";
ALTER TYPE "PaymentMethod_new" RENAME TO "PaymentMethod";
DROP TYPE "PaymentMethod_old";
COMMIT;

-- AlterTable
ALTER TABLE "payments" DROP COLUMN "creditLimit",
ADD COLUMN     "cashType" TEXT,
ADD COLUMN     "checkNumber" TEXT;
