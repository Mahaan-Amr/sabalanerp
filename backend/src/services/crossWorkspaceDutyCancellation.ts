import { Prisma, PrismaClient } from '@prisma/client';

type DutyCancellationDatabase = Pick<PrismaClient, 'crossWorkspaceDuty'> | Prisma.TransactionClient;

export const cancelOpenCrossWorkspaceDuty = async (
  database: DutyCancellationDatabase,
  input: { dutyId: string; structuredResult: Record<string, unknown> },
) => database.crossWorkspaceDuty.updateMany({
  where: { id: input.dutyId, status: 'OPEN' },
  data: {
    status: 'CANCELLED',
    respondedAt: null,
    respondedByUserId: null,
    structuredResultJson: JSON.parse(JSON.stringify(input.structuredResult)) as Prisma.InputJsonValue,
  },
});
