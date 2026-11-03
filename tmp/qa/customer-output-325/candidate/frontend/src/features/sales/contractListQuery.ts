export const CONTRACT_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'SIGNED',
  'PRINTED',
  'CANCELLED',
  'EXPIRED',
] as const;

const validStatuses = new Set<string>(CONTRACT_STATUSES);

export const parseContractStatusQuery = (value: string | null | undefined) => Array.from(
  new Set(
    String(value || '')
      .split(',')
      .map((status) => status.trim())
      .filter((status) => validStatuses.has(status)),
  ),
);
