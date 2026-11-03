-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'CREDIT';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "creditLimit" DECIMAL(15,2),
ADD COLUMN     "paymentDate" TIMESTAMP(3);
