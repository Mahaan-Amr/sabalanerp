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
assert.deepEqual(getContractStatusAction('APPROVED', true), {
  action: 'withdraw-cancel', label: 'انصراف از لغو', tone: 'neutral'
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
  'the existing immediate creation flow must remain available'
);
const editBranch = cancellationHandler[0].match(/if \(isContractEditMode\) \{([\s\S]*?)\n    \}/)?.[1];
assert.ok(editBranch, 'the actual editor handler must stage cancellation');
assert.match(editBranch, /cancellationPending: !wizardData.signature.cancellationPending/);
assert.match(editBranch, /return;/);
assert.doesNotMatch(editBranch, /salesAPI\./, 'choosing or withdrawing cancellation must not write to the server');
const submission = readFileSync(new URL('../../hooks/useContractSubmission.ts', import.meta.url), 'utf8');
assert.match(submission, /isEditMode && wizardData.signature\?\.cancellationPending \? \{ cancelContract: true \}/);
assert.doesNotMatch(
  cancellationHandler[0],
  /router\.(?:push|replace)|window\.location|finalizeSuccessfulContractCancellation/,
  'cancelling a contract must never navigate away before the seller saves changes'
);

console.log('contract cancellation completion tests passed');
