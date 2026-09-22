import assert from 'node:assert/strict';
import test from 'node:test';
import { meaningfulPartnerWizardUpdatedAt, reconcilePartnerCreationDrafts } from '../partnerSales/cases/partnerDraftRetention';

test('Partner recovery retains the meaningfully latest unnumbered draft and never discards numbered Cases', () => {
  const result = reconcilePartnerCreationDrafts([
    { recoveryId: 'old-unumbered', meaningfulUpdatedAt: 10 },
    { recoveryId: 'numbered-case', caseId: 'case-100', meaningfulUpdatedAt: 30 },
    { recoveryId: 'latest-unumbered', meaningfulUpdatedAt: 20 },
  ]);

  assert.equal(result.unnumbered?.recoveryId, 'latest-unumbered');
  assert.deepEqual(result.discardRecoveryIds, ['old-unumbered']);
  assert.deepEqual(result.numbered.map(item => item.recoveryId), ['numbered-case']);
});

test('transient session recency cannot replace the latest meaningful Partner draft', () => {
  const result = reconcilePartnerCreationDrafts([
    { recoveryId: 'meaningful', meaningfulUpdatedAt: 20, sessionUpdatedAt: 20 },
    { recoveryId: 'merely-opened', meaningfulUpdatedAt: 10, sessionUpdatedAt: 99 },
  ]);

  assert.equal(result.unnumbered?.recoveryId, 'meaningful');
  assert.deepEqual(result.discardRecoveryIds, ['merely-opened']);
});

test('wizard navigation alone does not refresh meaningful draft recency', () => {
  const intent = { customerId: 'customer-one', projectId: 'project-one' };
  assert.equal(meaningfulPartnerWizardUpdatedAt({ previousIntent: intent, nextIntent: { ...intent },
    previousMeaningfulUpdatedAt: 100, now: 200 }), 100);
  assert.equal(meaningfulPartnerWizardUpdatedAt({ previousIntent: intent,
    nextIntent: { ...intent, projectId: 'project-two' }, previousMeaningfulUpdatedAt: 100, now: 200 }), 200);
});
