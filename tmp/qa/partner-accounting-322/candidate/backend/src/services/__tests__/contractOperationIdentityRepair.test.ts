import assert from 'node:assert/strict';
import { readLegacyProductGraph } from '@sabalanerp/contract-product-graph';
import { CURRENT_CONTRACT_PRODUCT_POLICY } from '../contractProductGraphMigration';
import { repairContractDataOperationIdentities } from '../contractOperationIdentityRepair';

const derivedGroupIdentity = 'server-derived-owner:no-operations';
const contractData = {
  customerId: 'customer-1',
  products: [{
    rowId: 'server-derived-owner',
    productRowId: 'server-derived-owner',
    productId: 'catalog-1',
    productType: 'longitudinal',
    name: 'No operations',
    totalPrice: 0,
    operationPolicyInput: {
      policyVersion: 'calculation-v1',
      pricingPolicyVersion: 'pricing-v1',
      roundingPolicyVersion: 'rounding-v1',
      productRowId: 'server-derived-owner',
      lengthMeters: '4',
      widthMeters: '0.23',
      groups: [],
      tools: [],
      finishings: []
    }
  }, {
    rowId: 'server-explicit-owner',
    productRowId: 'server-explicit-owner',
    productId: 'catalog-1',
    productType: 'longitudinal',
    name: 'Half round',
    totalPrice: 200000,
    operationPolicyInput: {
      policyVersion: 'calculation-v1',
      pricingPolicyVersion: 'pricing-v1',
      roundingPolicyVersion: 'rounding-v1',
      productRowId: 'server-explicit-owner',
      lengthMeters: '4',
      widthMeters: '0.23',
      groups: [{
        operationGroupId: derivedGroupIdentity,
        scope: '4'
      }],
      tools: [{
        toolSelectionId: 'server-explicit-tool',
        operationGroupId: derivedGroupIdentity,
        catalogItemId: 'tool-1',
        catalogSnapshotVersion: 'catalog-v1',
        name: 'Half round',
        unit: 'meter',
        rateToman: '50000',
        edges: ['front']
      }],
      finishings: []
    },
    appliedSubServices: [{
      id: 'server-explicit-tool',
      subServiceId: 'tool-1',
      meter: 4,
      cost: 200000
    }]
  }]
};

const repair = repairContractDataOperationIdentities(contractData);
assert.deepEqual(repair.blockedProductRowIds, []);
assert.deepEqual(repair.repairedProductRowIds, ['server-explicit-owner']);
assert.deepEqual(repair.evidence, [{
  productRowId: 'server-explicit-owner',
  collisionKinds: ['derived-no-operation-group-collision'],
  collisionCount: 1
}]);
assert.notEqual(repair.contractData, contractData);

const repairedContractData = repair.contractData as typeof contractData;
assert.equal(repairedContractData.customerId, contractData.customerId);
assert.deepEqual(
  repairedContractData.products.map(product => product.totalPrice),
  contractData.products.map(product => product.totalPrice)
);
assert.notEqual(
  repairedContractData.products[1].operationPolicyInput.groups[0]
    ?.operationGroupId,
  derivedGroupIdentity
);
assert.equal(
  repairedContractData.products[1].appliedSubServices?.[0]?.id,
  repairedContractData.products[1].operationPolicyInput.tools[0]
    ?.toolSelectionId
);

const migration = readLegacyProductGraph({
  contractId: 'server-repaired-contract',
  revision: 1,
  calculationPolicy: CURRENT_CONTRACT_PRODUCT_POLICY,
  products: repairedContractData.products
});
assert.equal(
  migration.ok,
  true,
  migration.ok ? undefined : JSON.stringify(migration.conflicts)
);

const retry = repairContractDataOperationIdentities(repairedContractData);
assert.deepEqual(retry.repairedProductRowIds, []);
assert.equal(retry.contractData, repairedContractData);

console.log('contract operation identity repair tests passed');
