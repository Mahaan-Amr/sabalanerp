import assert from 'node:assert/strict';
import test from 'node:test';
import { createPartnerFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import type { PartnerCaseRuntimeRow } from '@sabalanerp/partner-sales-contracts';
import { partnerCaseListPage, partnerCaseListTag, partnerUnifiedCaseListPage } from '../cases/partnerCaseList';
const fixture = createPartnerFixtures();

test('unified list retains damaged identity and private draft, deduplicating the linked recovery', () => {
  const issue = { caseId: 'damaged-case', caseNumber: 'PC-damaged', trackingNumber: 10,
    code: 'INTEGRITY_CONFLICT' as const, supportReference: '96fcc17e-9816-4254-bd97-5588344ed1e6' };
  const drafts = [{ recoveryId: 'damaged-recovery', caseId: issue.caseId, baseRevision: 1, updatedAt: '2026-10-11T00:00:00.000Z' },
    { recoveryId: 'private-draft', baseRevision: 0, updatedAt: '2026-10-11T00:00:00.000Z' }];
  const result = partnerUnifiedCaseListPage(rows.slice(0, 1), [issue], drafts, '', 'ALL', 1);
  assert.equal(result.totalItems, 3);
  const damaged = result.rows.find(row => row.id === issue.caseId)!;
  assert.equal(damaged.status, 'REVIEW');
  assert.equal(damaged.case, undefined);
  assert.equal(damaged.draft, undefined);
  assert.equal(partnerUnifiedCaseListPage(rows, [issue], drafts, '00010', 'REVIEW', 1).totalItems, 1);
});
const rows: PartnerCaseRuntimeRow[] = Array.from({ length: 23 }, (_, index) => ({
  view: { ...fixture.partner, state: 'DRAFT', pricingState: index % 2 ? 'AWAITING_INQUIRY' : 'READY_TO_FINALIZE',
    caseNumber: `case-${index}`, owner: { ...fixture.partner.owner, caseId: `case-${index}` } },
  snapshotId: null, actions: { canContinue: true, canPreview: false, canIssue: false, canFinalize: false,
    canSendConfirmation: false, canRequestCorrection: false, canCancel: true, canRequestVoid: false },
}));
test('draft tags distinguish actionable pricing and preserve terminal commercial states', () => {
  assert.equal(partnerCaseListTag({ state: 'DRAFT', pricingState: 'READY_TO_FINALIZE' }), 'READY');
  assert.equal(partnerCaseListTag({ state: 'DRAFT', pricingState: 'AWAITING_INQUIRY' }), 'WAITING');
  assert.equal(partnerCaseListTag({ state: 'DRAFT', pricingState: 'INCOMPLETE' }), 'INCOMPLETE');
  assert.equal(partnerCaseListTag({ state: 'DRAFT', pricingState: 'EXPIRED' }), 'EXPIRED');
  assert.equal(partnerCaseListTag({ state: 'COMMITTED', pricingState: 'READY_TO_FINALIZE' }), 'COMMITTED');
});
test('pagination shows ten records, applies status and search before paging, and clamps a shrinking list', () => {
  const first = partnerCaseListPage(rows, '', 'ALL', 1);
  const second = partnerCaseListPage(rows, '', 'ALL', 2);
  const last = partnerCaseListPage(rows, '', 'ALL', 3);
  assert.deepEqual([first.rows.length, second.rows.length, last.rows.length], [10, 10, 3]);
  assert.equal(first.totalPages, 3);
  assert.equal(new Set([...first.rows, ...second.rows, ...last.rows].map(row => row.view.owner.caseId)).size, 23);
  const ready = partnerCaseListPage(rows, '', 'READY', 3);
  assert.equal(ready.totalItems, 12);
  assert.equal(ready.currentPage, 2);
  assert.equal(ready.rows.length, 2);
  const searched = partnerCaseListPage(rows, 'case-22', 'READY', 2);
  assert.equal(searched.currentPage, 1);
  assert.equal(searched.totalItems, 1);
  assert.equal(partnerCaseListPage(rows, 'case-22', 'WAITING', 1).totalItems, 0);
});

test('current offered prices make an unaccepted draft actionable in the list and its filter', () => {
  const awaiting = { state: 'DRAFT' as const, pricingState: 'AWAITING_INQUIRY' as const };
  assert.equal(partnerCaseListTag(awaiting, 'READY'), 'READY');
});

test('current response tags drive filtering without changing accepted or terminal states', () => {
  const offered = { ...rows[1], pricingResponseState: 'READY' as const };
  assert.equal(partnerCaseListPage([offered], '', 'READY', 1).totalItems, 1);
  assert.equal(partnerCaseListPage([offered], '', 'WAITING', 1).totalItems, 0);
  assert.equal(partnerCaseListTag(offered.view, 'PARTIAL'), 'PARTIAL');
  assert.equal(partnerCaseListTag(offered.view, 'REJECTED'), 'INCOMPLETE');
  assert.equal(partnerCaseListTag(offered.view, 'EXPIRED'), 'EXPIRED');
  assert.equal(partnerCaseListTag({ ...offered.view, state: 'COMMITTED' }, 'EXPIRED'), 'COMMITTED');
});
