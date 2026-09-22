import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getContractStatusAction } from '../../utils/contractStatusAction';

assert.deepEqual(getContractStatusAction('DRAFT'), {
  action: 'cancel',
  label: 'لغو قرارداد',
  tone: 'danger'
});
assert.deepEqual(getContractStatusAction('CANCELLED'), {
  action: 'reactivate',
  label: 'فعال‌سازی قرارداد',
  tone: 'success'
});

const wizardSource = readFileSync(
  new URL('../../CreateContractWizardClient.tsx', import.meta.url),
  'utf8'
);
const cancellationHandler = wizardSource.match(
  /const handleCancelContract = async \(\) => \{([\s\S]*?)\n  \};/
);

assert.ok(cancellationHandler, 'the contract cancellation handler must remain discoverable');
assert.match(
  cancellationHandler[0],
  /salesAPI\.cancelContract/,
  'the check must cover the real cancellation request handler'
);
assert.doesNotMatch(
  cancellationHandler[0],
  /router\.(?:push|replace)|window\.location|finalizeSuccessfulContractCancellation/,
  'cancelling a contract must never navigate away before the seller saves changes'
);

console.log('contract cancellation completion tests passed');
