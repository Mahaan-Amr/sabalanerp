import type { Prisma, PrismaClient } from '@prisma/client';

type PrismaTransaction = Prisma.TransactionClient | PrismaClient;

export interface ContractNumberAssignment {
  contractNumber: string;
  creatorSequenceNumber: number;
}

const PUBLIC_NUMBER_FLOOR = Number(process.env.CONTRACT_PUBLIC_NUMBER_FLOOR || 100001);

const numericOnly = (value: string | null | undefined): number | null => {
  if (!value || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export async function generateContractNumber(
  userId: string,
  client: PrismaTransaction
): Promise<string> {
  const assignment = await generateContractNumberAssignment(userId, client);
  return assignment.contractNumber;
}

export async function generateContractNumberAssignment(
  userId: string,
  client: PrismaTransaction
): Promise<ContractNumberAssignment> {
  const recentNumericContracts = await client.salesContract.findMany({
    where: {
      contractNumber: {
        not: {
          contains: '-'
        }
      }
    },
    select: { contractNumber: true },
    orderBy: { contractNumber: 'desc' },
    take: 100
  });

  const maxPublicNumber = recentNumericContracts.reduce((max, contract) => {
    const parsed = numericOnly(contract.contractNumber);
    return parsed && parsed > max ? parsed : max;
  }, PUBLIC_NUMBER_FLOOR - 1);

  const lastCreatorContract = await client.salesContract.findFirst({
    where: {
      createdBy: userId,
      creatorSequenceNumber: {
        not: null
      }
    },
    select: { creatorSequenceNumber: true },
    orderBy: { creatorSequenceNumber: 'desc' }
  });

  return {
    contractNumber: String(Math.max(maxPublicNumber + 1, PUBLIC_NUMBER_FLOOR)),
    creatorSequenceNumber: (lastCreatorContract?.creatorSequenceNumber || 0) + 1
  };
}

export async function getNextContractNumberPreview(
  userId: string,
  client: PrismaTransaction
): Promise<ContractNumberAssignment> {
  return generateContractNumberAssignment(userId, client);
}

export function validateContractNumber(contractNumber: string): boolean {
  return /^\d{6,}$/.test(contractNumber) || /^[A-Z]{3}-\d{6}$/.test(contractNumber);
}

export function getUserPrefix(firstName: string, lastName: string): string {
  const firstNamePrefix = (firstName || '').substring(0, 3).toUpperCase();
  if (firstNamePrefix.length < 3 && lastName) {
    return (firstNamePrefix + (lastName || '').substring(0, 3 - firstNamePrefix.length).toUpperCase()).substring(0, 3);
  }
  return firstNamePrefix || (lastName || '').substring(0, 3).toUpperCase() || 'USR';
}
