import { parseCanonicalDecimal } from './canonicalDecimal';

/** Internal boundary checks. Never include caller-controlled keys/values in errors. */
export const technicalShape = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !keys.includes(key))) throw new TypeError('Invalid technical object.');
  return value as Record<string, unknown>;
};
export const technicalDecimal = (value: unknown): void => {
  if (typeof value !== 'string' || parseCanonicalDecimal(value) !== value) {
    throw new TypeError('Invalid technical decimal.');
  }
};
export const technicalIdentity = (value: unknown): void => {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    throw new TypeError('Invalid technical identity.');
  }
};
export const technicalEnum = (value: unknown, choices: readonly string[]): void => {
  if (typeof value !== 'string' || !choices.includes(value)) throw new TypeError('Invalid technical choice.');
};
export const technicalRevision = (input: { readonly inputRevision?: unknown } | null | undefined): number | undefined =>
  typeof input?.inputRevision === 'number' && Number.isSafeInteger(input.inputRevision) && input.inputRevision >= 0
    ? input.inputRevision : undefined;

export const technicalStock = (value: unknown): void => {
  const stock = technicalShape(value, ['remainingStoneId', 'ownerProductRowId', 'catalogProductId',
    'sourceBatchId', 'lengthMeters', 'widthMeters', 'quantity', 'creationOrder', 'materialPaid']);
  for (const field of ['remainingStoneId', 'ownerProductRowId', 'catalogProductId', 'sourceBatchId']) technicalIdentity(stock[field]);
  technicalDecimal(stock.lengthMeters); technicalDecimal(stock.widthMeters);
  if ([stock.lengthMeters, stock.widthMeters].some(value => value === '0' || (value as string).startsWith('-'))) {
    throw new TypeError('Technical stock dimensions must be positive.');
  }
  if (typeof stock.quantity !== 'number' || !Number.isSafeInteger(stock.quantity) || stock.quantity <= 0 ||
      typeof stock.creationOrder !== 'number' || !Number.isSafeInteger(stock.creationOrder) || stock.creationOrder < 0 ||
      stock.materialPaid !== true) throw new TypeError('Invalid technical stock.');
};
