import { Prisma } from '@prisma/client';

export const lockFinancialApprovalRecord = async (
  tx: Prisma.TransactionClient,
  financialRecordId: string,
) => {
  const locked = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "accounting_financial_records" WHERE "id" = ${financialRecordId} FOR UPDATE`,
  );
  if (locked.length !== 1) throw new Error('Invoice record not found');
};
