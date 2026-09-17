import assert from 'node:assert/strict';
import test from 'node:test';
import { createWizardFixtures } from '../../partner-sales/__tests__/wizardFixtures';
import { buildPartnerInquirySubjectOptions } from './partnerInquirySubjectOptions';

test('initial inquiry options include primary and additional-material pricing subjects', () => {
  const fixture = createWizardFixtures();
  const primary = fixture.technicalSaved.rows[0].configurationRef;
  const additional = { ...primary, productRowId: 'additional-material-subject' };
  const options = buildPartnerInquirySubjectOptions({
    saved: { ...fixture.technicalSaved, pricingSubjects: [
      { configurationRef: primary, role: 'PRIMARY' },
      { configurationRef: additional, role: 'ADDITIONAL_MATERIAL' },
    ] },
    draft: { schemaVersion: 1, inputRevision: 1, rows: [{
      productRowId: primary.productRowId,
      catalogItemId: 'catalog-stone',
      catalogSnapshotVersion: '2026-08-01T00:00:00.000Z',
      family: 'prepared',
      configuration: { kind: 'readyPiece', unit: 'count', quantity: '1' },
    }], dependents: [], stairSystems: [], editingValues: [] },
    catalog: [{ catalogItemId: 'catalog-stone', catalogSnapshotVersion: '2026-08-01T00:00:00.000Z',
      name: 'سنگ اصلی', dimensions: {}, families: ['prepared'] }],
  });

  assert.deepEqual(options.map(option => option.productRowId), [primary.productRowId, additional.productRowId]);
  assert.deepEqual(options.map(option => option.role), ['PRIMARY', 'ADDITIONAL_MATERIAL']);
  assert.equal(options[0].label, 'سنگ اصلی');
  assert.match(options[1].label, /جزء جانبی/);
});
