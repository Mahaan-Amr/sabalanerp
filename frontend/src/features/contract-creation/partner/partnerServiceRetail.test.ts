import assert from 'node:assert/strict';
import test from 'node:test';
import { partnerRetailSummary, partnerRetailSubtotal, partnerRetailDiscountFromPercent, type PartnerRetailServiceRow } from './partnerRetail';
import { enterPartnerWizard, partnerDeliveryPlanIssue, reconcilePartnerDeliveriesToProducts, preservePartnerDeliveriesAcrossProductEdit } from './partnerWizardEntry';
import { partnerWizardStepsForDraft } from './PartnerContractWizard';

const services: PartnerRetailServiceRow[] = [
  { serviceRowId: 'service:1', title: 'برش', quantity: '1', unit: 'meter',
    retailUnitPrice: { amount: '100.4', currency: 'IRT' }, wholesaleUnitPrice: { amount: '80.2', currency: 'IRT' } },
  { serviceRowId: 'service:2', title: 'ابزار', quantity: '1', unit: 'meter',
    retailUnitPrice: { amount: '100.4', currency: 'IRT' }, wholesaleUnitPrice: { amount: '80.2', currency: 'IRT' } },
];

test('service-only sums exact lines and rounds final payable once with no inquiry', () => {
  const summary = partnerRetailSummary([], { amount: '0', currency: 'IRT' }, services);
  assert.ok(summary.valid);
  assert.equal(summary.retail, '201');
  assert.equal(summary.wholesale, '160');
  assert.equal(summary.pricingReady, true);
  assert.equal(partnerRetailSubtotal([], 'IRT', services), '200.8');
  assert.deepEqual(partnerRetailDiscountFromPercent([], '10', 'IRT', services), { amount: '20.08', currency: 'IRT' });
});

test('service totals enforce currency and remain unavailable until wholesale quote exists', () => {
  assert.equal(partnerRetailSummary([], { amount: '0', currency: 'IRR' }, services).valid, false);
  const summary = partnerRetailSummary([], { amount: '0', currency: 'IRT' }, services.map(({ wholesaleUnitPrice, ...row }) => row));
  assert.ok(summary.valid);
  assert.equal(summary.pricingReady, false);
  assert.equal(summary.wholesale, undefined);
});

test('service-only wizard recovery preserves separate service references and omits pricing step', () => {
  const base: any = { recoveryId: 'recovery:services', recoveryRevision: 1, retailDiscount: { amount: '0', currency: 'IRT' } };
  const validated: any = { schemaVersion: 1, recoveryId: base.recoveryId, recoveryRevision: 1, inputRevision: 1,
    graphHash: `sha256-v1:${'a'.repeat(64)}`, updatedAt: '2026-10-03T00:00:00.000Z', rows: [],
    serviceRows: services.map(({ serviceRowId, quantity, unit }) => ({ serviceRowId, quantity, unit })) };
  const wizard = enterPartnerWizard({ base, validated, serviceRows: services, now: Date.now() });
  assert.ok(wizard);
  assert.deepEqual(wizard.rows, []);
  assert.deepEqual(wizard.materialInquiryRows, []);
  assert.deepEqual(wizard.intent.serviceRows, [{ serviceRowId: 'service:1' }, { serviceRowId: 'service:2' }]);
  assert.equal(partnerWizardStepsForDraft(wizard).some(step => step.id === 'pricing'), false);
  assert.equal(enterPartnerWizard({ base, validated, serviceRows: [], now: Date.now() }), null);
});

test('invalid product allocations for services are retained for explicit repair', () => {
  const deliveries: any = [{ date: '2026-10-03', destination: 'یزد', projectManagerName: 'مدیر', receiverName: 'گیرنده',
    items: [{ productRowId: 'service:1', quantity: '1' }] }];
  assert.deepEqual(reconcilePartnerDeliveriesToProducts(deliveries, []), deliveries);
  assert.ok(partnerDeliveryPlanIssue(deliveries, []));
  assert.equal(partnerDeliveryPlanIssue([], []), null);
});


test('service execution scheduling preserves separate IDs, retains changed quantities for explicit repair and requires full allocation', () => {
  const deliveries: any = [{ date: '2026-10-03', destination: 'یزد', projectManagerName: 'مدیر', receiverName: 'گیرنده',
    items: [], serviceItems: [{ serviceRowId: 'service:1', quantity: '1' }, { serviceRowId: 'service:2', quantity: '1' }] }];
  assert.equal(partnerDeliveryPlanIssue(deliveries, [], services), null);
  assert.ok(partnerDeliveryPlanIssue([], [], services));
  assert.ok(partnerDeliveryPlanIssue([{ ...deliveries[0], serviceItems: [{ serviceRowId: 'service:1', quantity: '0.5' }] }], [], services));
  assert.ok(partnerDeliveryPlanIssue([{ ...deliveries[0], serviceItems: [{ serviceRowId: 'unknown', quantity: '1' }] }], [], services));
  const trimmed = reconcilePartnerDeliveriesToProducts(deliveries, [], [{ serviceRowId: 'service:1', quantity: '0.5' }]);
  assert.deepEqual(trimmed[0].items, []);
  assert.deepEqual(trimmed, deliveries);
  assert.ok(partnerDeliveryPlanIssue(trimmed, [], [{ serviceRowId: 'service:1', quantity: '0.5' }]));
  assert.deepEqual(preservePartnerDeliveriesAcrossProductEdit(deliveries, [], ['service:1'])[0].serviceItems,
    deliveries[0].serviceItems);
});
