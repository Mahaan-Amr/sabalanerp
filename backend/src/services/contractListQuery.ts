import { ContractStatus } from '@prisma/client';

const validStatuses = new Set<string>(Object.values(ContractStatus));

export const parseContractStatuses = (value: unknown) => Array.from(new Set(
  String(value || '')
    .split(',')
    .map((status) => status.trim())
    .filter((status) => validStatuses.has(status)),
)) as ContractStatus[];
