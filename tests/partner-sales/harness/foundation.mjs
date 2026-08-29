import { createRequire } from 'node:module';

// Resolve the published package entry points, never reach into its src/ internals.
const requireContract = createRequire(new URL('../../../packages/partner-sales-contracts/package.json', import.meta.url));
export const foundationInterface = '@sabalanerp/partner-sales-contracts@1.5.0; schemaVersion=1';

export function loadFoundation() {
  const contract = requireContract('@sabalanerp/partner-sales-contracts');
  const testing = requireContract('@sabalanerp/partner-sales-contracts/testing');
  if (contract.PARTNER_CONTRACT_VERSION !== '1.5.0' || contract.PARTNER_SCHEMA_VERSION !== 1) {
    throw new Error('Partner QA foundation version changed; coordinate a consumer update with #313/#334.');
  }
  return { contract, testing };
}
