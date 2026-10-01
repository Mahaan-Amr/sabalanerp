import assert from 'node:assert/strict';
import { contractLifecycleLabel, isCurrentContractFlow } from './contractLifecyclePresentation';

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
