import assert from 'node:assert/strict';
import { contractLifecycleLabel, contractLifecycleFilterStatus, isCurrentContractFlow } from './contractLifecyclePresentation';

for (const [status, current, historical] of [
  ['DRAFT', 'یادداشت', 'پیش‌نویس'],
  ['PENDING_APPROVAL', 'پیش‌نویس', 'در انتظار تایید'],
  ['APPROVED', 'امضا شده', 'تایید شده'],
  ['SIGNED', 'قطعی', 'امضا شده'],
]) {
  assert.equal(contractLifecycleLabel({ status, commercialFlowVersion: 1 }), current);
  assert.equal(contractLifecycleLabel({ status, commercialFlowVersion: 0 }), historical);
  assert.equal(contractLifecycleLabel({ status }), historical, 'missing version must preserve historical meaning');
}
for (const status of ['CANCELLED', 'EXPIRED']) {
  assert.equal(contractLifecycleLabel({ status, commercialFlowVersion: 1 }), contractLifecycleLabel({ status }));
}
assert.equal(isCurrentContractFlow({ commercialFlowVersion: 1 }), true);
assert.equal(isCurrentContractFlow({ commercialFlowVersion: 0 }), false);
assert.equal(isCurrentContractFlow({}), false);
console.log('ordinary contract lifecycle presentation tests passed');

for (const [partnerCommercialStatus, expected] of [['NOTE','یادداشت'],['DRAFT','پیش‌نویس'],['CUSTOMER_SIGNED','امضا شده'],['QUOTED','استعلام شده'],['FINAL','قطعی']]) {
  assert.equal(contractLifecycleLabel({ status: 'DRAFT', commercialFlowVersion: 2, partnerCommercialStatus }), expected);
}

assert.equal(contractLifecycleLabel({ status: 'FUTURE_INTERNAL_STATUS' }), 'وضعیت نامشخص');
assert.equal(contractLifecycleFilterStatus({ status: 'SIGNED', commercialFlowVersion: 1 }), 'SIGNED');
assert.equal(contractLifecycleFilterStatus({ status: 'DRAFT', partnerCommercialStatus: 'QUOTED' }), 'QUOTED');
