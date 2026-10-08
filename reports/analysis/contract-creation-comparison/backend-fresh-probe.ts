import { commercialApprovalStatus, commercialDeadlinePassed } from '../../../backend/src/services/ordinaryContractLifecycle';
import { partnerCommercialStatus } from '../../../packages/partner-sales-contracts/src/index';
for (const sales of [false, true]) for (const accepted of [false, true]) for (const priced of [false, true]) {
  console.log(JSON.stringify({ sales, accepted, priced,
    ordinary: commercialApprovalStatus(3, sales ? 3 : null, accepted ? 3 : null),
    partner: partnerCommercialStatus({ salesApproved: sales, customerAccepted: accepted, pricingAccepted: priced, expired: false }),
  }));
}
const c = { status: 'SIGNED', commercialFlowVersion: 1, commercialExpiresAt: new Date('2026-10-01T00:00:00Z'), firstFinancialRecordAt: null };
console.log(JSON.stringify({ ordinaryExpired: commercialDeadlinePassed(c, new Date('2026-10-07T00:00:00Z')),
  ordinaryDispatchExemption: commercialDeadlinePassed({ ...c, dispatchExpiryExempt: true }, new Date('2026-10-07T00:00:00Z')) }));
