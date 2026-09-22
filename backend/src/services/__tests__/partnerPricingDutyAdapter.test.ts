import assert from 'node:assert/strict';
import test from 'node:test';
import { createPartnerPricingResultDuty } from '../crossWorkspaceDutyAdapters/partnerPricingDutyAdapter';
import { presentSavedTechnicalConfiguration } from '../partnerSales/inquiries/adapters';

test('resolved case pricing creates a return duty assigned to the Partner seller', async () => {
  let createdDuty: Record<string, unknown> | undefined;
  const database = {
    partnerInquiry: { findUniqueOrThrow: async () => ({
      id: 'inquiry-1', caseId: 'case-1', revision: 4,
      case: { caseNumber: 'PF-1001' }, profile: { userId: 'partner-user-1' },
      rows: [{ outcome: 'APPROVED' }, { outcome: 'REJECTED' }],
    }) },
    crossWorkspaceDutyEnvelope: { upsert: async () => ({ id: 'envelope-1' }) },
    crossWorkspaceDuty: { upsert: async ({ create }: { create: Record<string, unknown> }) => {
      createdDuty = create; return { id: 'duty-1', ...create };
    } },
    crossWorkspaceDutyAssignmentHistory: { upsert: async () => ({ id: 'assignment-1' }) },
    crossWorkspaceDutyAuditVersion: { upsert: async () => ({ id: 'audit-1' }) },
  };

  const duty = await createPartnerPricingResultDuty(database, {
    inquiryId: 'inquiry-1', actorUserId: 'sabalan-seller-1', now: new Date('2026-09-21T08:00:00.000Z'),
  });

  assert.ok(duty);
  assert.equal(createdDuty?.sourceActionCode, 'PARTNER_PRICE_RESULT');
  assert.equal(createdDuty?.currentAssigneeUserId, 'partner-user-1');
  assert.equal(createdDuty?.sourceActorUserId, 'sabalan-seller-1');
  assert.equal(createdDuty?.destinationWorkspaceCode, 'SALES');
  assert.equal(createdDuty?.stableKey, 'PARTNER_PRICING_RESULT:inquiry-1:4');
});

test('pending pricing never creates the Partner return duty', async () => {
  const database = {
    partnerInquiry: { findUniqueOrThrow: async () => ({
      id: 'inquiry-1', caseId: 'case-1', revision: 2,
      case: { caseNumber: 'PF-1001' }, profile: { userId: 'partner-user-1' },
      rows: [{ outcome: 'APPROVED' }, { outcome: 'PENDING' }],
    }) },
  };
  assert.equal(await createPartnerPricingResultDuty(database, {
    inquiryId: 'inquiry-1', actorUserId: 'sabalan-seller-1',
  }), null);
});

test('responder facts include system-owned mandatory policy, tools and finishings without rates', () => {
  const facts = presentSavedTechnicalConfiguration({
    productRowId: 'product-row:fixture', family: 'longitudinal',
    product: {
      catalogItemId: 'product-1', catalogSnapshotVersion: '2026-09-21T00:00:00.000Z', code: 'STONE-1',
      name: 'سنگ تست', families: ['longitudinal'], salesUnits: { prepared: 'count', volumetric: 'count' },
      dimensions: { motherWidthCentimeters: '40', motherLengthMeters: '2', thicknessCentimeters: '3' },
      attributes: { stoneType: 'کریستال', mine: 'معدن', finish: 'صیقلی', color: 'سفید', quality: 'درجه یک', cuttingDimension: 'طولی' },
      isAvailable: true,
    },
    draftRow: {
      productRowId: 'product-row:fixture', catalogItemId: 'product-1', catalogSnapshotVersion: '2026-09-21T00:00:00.000Z',
      family: 'longitudinal', configuration: { sourceBatchId: 'source-batch:fixture', lengthMeters: '2', widthMeters: '0.4',
        quantity: 1, lastManualField: 'quantity', lastManualDimension: 'length', lengthDisplayUnit: 'm', widthDisplayUnit: 'm',
        sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'automatic' },
    },
    operations: [
      { kind: 'TOOL', catalogItemId: 'tool-1', catalogSnapshotVersion: '2026-09-21T00:00:00.000Z', name: 'چسب سنگ', unit: 'meter' },
      { kind: 'FINISHING', catalogItemId: 'finish-1', catalogSnapshotVersion: '2026-09-21T00:00:00.000Z', name: 'ساب صیقلی', unit: 'squareMeter', incompatibleCatalogItemIds: [] },
    ],
    graphOperations: {
      operationGroups: [{ operationGroupId: 'operation-group:fixture', productRowId: 'product-row:fixture' }],
      toolSelections: [{ operationGroupId: 'operation-group:fixture', catalogItemId: 'tool-1', finalQuantity: '4' }],
      finishingSelections: [{ operationGroupId: 'operation-group:fixture', catalogItemId: 'finish-1', finalQuantity: '0.8' }],
    } as never,
    technicalPolicy: { mandatoryEnabled: true, mandatoryPercentage: '20' },
  });
  assert.deepEqual(facts.filter(fact => ['حکمی', 'ابزار', 'پرداخت'].includes(fact.label)), [
    { label: 'حکمی', value: 'فعال · 20٪' },
    { label: 'ابزار', value: 'چسب سنگ · 4 متر' },
    { label: 'پرداخت', value: 'ساب صیقلی · 0.8 مترمربع' },
  ]);
  assert.equal(JSON.stringify(facts).includes('rate'), false);
});
