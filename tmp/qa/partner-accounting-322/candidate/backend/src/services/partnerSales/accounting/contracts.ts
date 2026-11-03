import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// Resolve the published entry point, as the foundation QA consumer does. #334 owns
// installing the runtime dependency and Docker packaging; no manifest edits here.
const requireFoundation = createRequire(resolve(__dirname, '../../../../../packages/partner-sales-contracts/package.json'));
export const contracts: typeof import('../../../../../packages/partner-sales-contracts') =
  requireFoundation('@sabalanerp/partner-sales-contracts');
export type {
  AccountingPartnerPort, Money, PartnerAccountView, PartnerErrorCode, PartnerEvent,
  Result, RevisionRef, SabalanInternalRecordView,
} from '../../../../../packages/partner-sales-contracts';
