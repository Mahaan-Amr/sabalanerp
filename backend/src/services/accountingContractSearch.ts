import { normalizePersianSearchTokens } from './crmCustomerSearch';

/** Every token must occur in this contract's searchable fields. Order and field
 * boundaries do not matter; existing Persian/Arabic normalization is retained. */
export function accountingContractSearch(search: string | undefined) {
  const tokens = normalizePersianSearchTokens(search);
  return (values: readonly unknown[]) => {
    const text = normalizePersianSearchTokens(values.filter(Boolean).join(' ')).join(' ');
    return tokens.every(token => text.includes(token));
  };
}
