import assert from 'node:assert/strict';
import { AccountingRecordStatus, FinancialRecordKind, Prisma } from '@prisma/client';
import { buildCorrectionReplacementWorkflow } from '../accountingService';

const correction = { id: 'correction-1', status: 'SALES_EDITED', recordId: 'old-invoice' };
const source = {
  id: 'old-invoice', kind: FinancialRecordKind.INVOICE_CANDIDATE,
  status: AccountingRecordStatus.ISSUED, financiallyApprovedAt: new Date(),
  amount: new Prisma.Decimal('8750000000'), metadata: {},
};
const correctedAmount = new Prisma.Decimal('9206960000');
const workflow = (records: any[]) => buildCorrectionReplacementWorkflow(
  correctedAmount, records, [], [], [], [correction],
);

assert.equal(workflow([source])?.amountChanged, true);
assert.equal(workflow([source])?.nextStep, 'VOID_SOURCE_RECORD');
assert.equal(workflow([source])?.canResolve, false);

const voided = { ...source, status: AccountingRecordStatus.VOIDED };
assert.equal(workflow([voided])?.nextStep, 'CREATE_REPLACEMENT');
assert.equal(workflow([voided])?.canResolve, false);

const replacement = {
  ...source, id: 'new-invoice', status: AccountingRecordStatus.DRAFT,
  financiallyApprovedAt: null, amount: correctedAmount,
  metadata: { correctionRequestId: correction.id, replacesRecordId: source.id },
};
assert.equal(workflow([voided, replacement])?.nextStep, 'APPROVE_REPLACEMENT');
assert.equal(workflow([voided, replacement])?.canResolve, false);
assert.equal(workflow([voided, { ...replacement, financiallyApprovedAt: new Date() }])?.canResolve, true);
assert.equal(buildCorrectionReplacementWorkflow(correctedAmount, [], [], [], [], [
  { ...correction, recordId: null }
])?.canResolve, true);

const draftCorrection = { ...correction, recordId: 'old-draft' };
const draft = { ...replacement, id: 'old-draft', metadata: {}, amount: source.amount };
const draftWorkflow = (records: any[]) => buildCorrectionReplacementWorkflow(
  correctedAmount, records, [], [], [], [draftCorrection],
);
assert.equal(draftWorkflow([draft])?.nextStep, 'DELETE_DRAFT_SOURCE');
assert.equal(draftWorkflow([draft])?.canResolve, false);
assert.equal(draftWorkflow([])?.nextStep, 'CREATE_NEW_DRAFT');
assert.equal(draftWorkflow([])?.canResolve, false);
assert.equal(draftWorkflow([{ ...replacement, metadata: {} }])?.canResolve, true);
const timedCorrection = { ...draftCorrection, updatedAt: '2026-09-27T10:00:00.000Z' };
const timedWorkflow = (createdAt: string) => buildCorrectionReplacementWorkflow(
  correctedAmount, [{ ...replacement, metadata: {}, createdAt }], [], [], [], [timedCorrection],
);
assert.equal(timedWorkflow('2026-09-27T09:59:00.000Z')?.canResolve, false);
assert.equal(timedWorkflow('2026-09-27T10:01:00.000Z')?.canResolve, true);
