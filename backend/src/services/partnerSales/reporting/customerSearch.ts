import type { CustomerContractOutput } from '../../../../../packages/partner-sales-contracts';

/** #325's existing authenticated public-session lookup may use this matcher AFTER
 * session/recipient authorization. No Case or internal identifier is accepted.
 * Do not expose it as an unauthenticated global search endpoint.
 */
export function matchesCustomerContractNumber(output: CustomerContractOutput, number: string): boolean {
  return typeof number === 'string' && number.trim() === output.contractNumber;
}
