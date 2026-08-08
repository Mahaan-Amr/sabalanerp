import { ContractStatus } from '@prisma/client';

const validStatuses = new Set<string>(Object.values(ContractStatus));

export const parseContractStatuses = (value: unknown) => Array.from(new Set(
  String(value || '')
    .split(',')
    .map((status) => status.trim())
    .filter((status) => validStatuses.has(status)),
)) as ContractStatus[];

export const buildContractSearchConditions = (search: string) => {
  const conditions: any[] = [
    { contractNumber: { contains: search, mode: 'insensitive' } },
    { title: { contains: search, mode: 'insensitive' } },
    { titlePersian: { contains: search, mode: 'insensitive' } },
    { customer: { firstName: { contains: search, mode: 'insensitive' } } },
    { customer: { lastName: { contains: search, mode: 'insensitive' } } },
    { customer: { companyName: { contains: search, mode: 'insensitive' } } },
    { customer: { nationalCode: { contains: search, mode: 'insensitive' } } },
    { customer: { projectManagerName: { contains: search, mode: 'insensitive' } } },
    { createdByUser: { firstName: { contains: search, mode: 'insensitive' } } },
    { createdByUser: { lastName: { contains: search, mode: 'insensitive' } } },
    { createdByUser: { username: { contains: search, mode: 'insensitive' } } },
  ];

  const creatorNameTokens = search.split(/\s+/).filter(Boolean);
  if (creatorNameTokens.length > 1) {
    conditions.push({
      AND: creatorNameTokens.map((token) => ({
        OR: [
          { createdByUser: { firstName: { contains: token, mode: 'insensitive' } } },
          { createdByUser: { lastName: { contains: token, mode: 'insensitive' } } },
          { createdByUser: { username: { contains: token, mode: 'insensitive' } } },
        ],
      })),
    });
  }

  const numericSearch = Number.parseInt(search, 10);
  if (Number.isFinite(numericSearch)) {
    conditions.push({ creatorSequenceNumber: numericSearch });
  }

  return conditions;
};
