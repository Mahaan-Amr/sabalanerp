import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { projectPartnerTechnicalProduct, projectPartnerTechnicalOperation } from '../../services/partnerSales/crm/technicalCatalog';

const stone = {
  id: 'stone-1', code: 'STONE-1', namePersian: 'سنگ سفید', updatedAt: new Date('2026-08-27T10:00:00.000Z'),
  widthValue: '40.25', motherLengthValue: '3.000', thicknessValue: '2.00',
  stoneTypeNamePersian: 'تراورتن', mineNamePersian: 'عباس‌آباد', finishNamePersian: 'صیقلی',
  colorNamePersian: 'سفید', qualityNamePersian: 'ممتاز', cuttingDimensionNamePersian: 'طولی',
  isActive: true, deletedAt: null, isAvailable: true,
  availableInLongitudinalContracts: true, availableInStairContracts: false,
  availableInSlabContracts: true, availableInVolumetricContracts: true,
  basePrice: 'private-rate', financialEvidence: { hash: 'private-hash' },
};

test('inventory product projection retains units and eligibility but never serializes internal prices or unknown fields', () => {
  const result = projectPartnerTechnicalProduct(stone);
  if (!result.ok) throw new Error(result.error.code);
  assert.deepEqual(result.value.dimensions, {
    motherWidthCentimeters: '40.25', motherLengthMeters: '3', thicknessCentimeters: '2',
  });
  assert.deepEqual(result.value.families, ['longitudinal', 'slab', 'prepared', 'volumetric']);
  assert.equal(result.value.catalogSnapshotVersion, '2026-08-27T10:00:00.000Z');
  assert.equal(JSON.stringify(result).includes('private-'), false);
  assert.equal(JSON.stringify(result).includes('basePrice'), false);
});

test('operation projection uses inventory units, requires known bases, and keeps rates server-side', () => {
  const common = { id: 'operation-1', updatedAt: stone.updatedAt, isActive: true, pricePerMeter: 'private-rate' };
  const tool = projectPartnerTechnicalOperation({ ...common, kind: 'TOOL', namePersian: 'ابزار', calculationBase: 'length' });
  if (!tool.ok) throw new Error(tool.error.code);
  assert.equal(tool.value.unit, 'meter');
  const finishing = projectPartnerTechnicalOperation({ ...common, kind: 'FINISHING', namePersian: 'پرداخت',
    calculationBase: 'squareMeters', incompatibleCatalogItemIds: ['incompatible-1'],
  });
  if (!finishing.ok || finishing.value.kind !== 'FINISHING') throw new Error('Finishing missing');
  assert.deepEqual(finishing.value.incompatibleCatalogItemIds, ['incompatible-1']);
  const layer = projectPartnerTechnicalOperation({ ...common, kind: 'LAYER', name: 'دوبل', calculationUnit: 'physicalPiece' });
  if (!layer.ok) throw new Error(layer.error.code);
  assert.equal(layer.value.unit, 'physicalPiece');
  assert.equal(JSON.stringify([tool, finishing, layer]).includes('private-rate'), false);
  assert.equal(projectPartnerTechnicalOperation({ ...common, kind: 'TOOL', namePersian: 'ابزار', calculationBase: 'unknown' }).ok, false);
  const inactive = projectPartnerTechnicalOperation({ ...common, isActive: false, kind: 'LAYER', name: 'دوبل', calculationUnit: 'set' });
  if (inactive.ok) throw new Error('Inactive layer was exposed');
  assert.equal(inactive.error.code, 'NOT_FOUND');
});

test('inactive/deleted inventory is unavailable while missing geometry remains missing and invalid geometry fails safely', () => {
  for (const source of [{ ...stone, isActive: false }, { ...stone, deletedAt: new Date() }]) {
    const result = projectPartnerTechnicalProduct(source);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error('Inactive inventory was exposed');
    assert.equal(result.error.code, 'NOT_FOUND');
  }
  const missing = projectPartnerTechnicalProduct({ ...stone, motherLengthValue: null, widthValue: null });
  if (!missing.ok) throw new Error(missing.error.code);
  assert.equal(missing.value.dimensions.motherLengthMeters, undefined);
  assert.equal(missing.value.dimensions.motherWidthCentimeters, undefined);
  for (const widthValue of ['0', '-4', 'private-malformed-value']) {
    const result = projectPartnerTechnicalProduct({ ...stone, widthValue });
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes(widthValue === 'private-malformed-value' ? widthValue : 'widthValue'), false);
  }
});
