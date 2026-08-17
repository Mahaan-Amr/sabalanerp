import assert from 'node:assert/strict';
import {
  buildAccountingContractSourceSnapshot,
  sanitizeContractDataCustomerSnapshot,
} from '../contractSnapshotBoundary';

const customerWithCrmHistory = {
  id: 'customer-1',
  firstName: 'فریبا',
  lastName: 'پور شهید',
  companyName: 'سنگ سبلان',
  nationalCode: '0012345678',
  homeNumber: '02100000000',
  primaryContact: { id: 'contact-1', mobile: '09120000000' },
  phoneNumbers: [{ id: 'phone-1', number: '09120000000', type: 'mobile', isPrimary: true }],
  projectAddresses: [{ id: 'project-1', address: 'تهران', projectName: 'پروژه اصلی' }],
  salesContracts: [{
    id: 'previous-contract',
    contractData: {
      customer: {
        id: 'customer-1',
        salesContracts: [{ id: 'older-contract' }],
      },
    },
  }],
  leads: [{ id: 'lead-1' }],
  communications: [{ id: 'communication-1' }],
  potentialProjects: [{ id: 'potential-project-1' }],
  contacts: [{ id: 'contact-2' }],
  ownerUser: { id: 'seller-1' },
  _count: { salesContracts: 8 },
};

const contractData = {
  customerId: 'customer-1',
  customer: customerWithCrmHistory,
  project: { id: 'project-1', address: 'تهران' },
  products: [{ rowId: 'row-1', productId: 'product-1', totalPrice: 100 }],
  deliveries: [{ id: 'delivery-1', products: [{ productRowId: 'row-1', quantity: 1 }] }],
  payment: { currency: 'تومان', totalContractAmount: 100 },
};

const sanitized = sanitizeContractDataCustomerSnapshot(contractData) as any;

assert.deepEqual(sanitized.customer, {
  id: 'customer-1',
  firstName: 'فریبا',
  lastName: 'پور شهید',
  companyName: 'سنگ سبلان',
  nationalCode: '0012345678',
  homeNumber: '02100000000',
  primaryContact: { id: 'contact-1', mobile: '09120000000' },
  phoneNumbers: [{ id: 'phone-1', number: '09120000000', type: 'mobile', isPrimary: true }],
  projectAddresses: [{ id: 'project-1', address: 'تهران', projectName: 'پروژه اصلی' }],
});
assert.deepEqual(sanitized.products, contractData.products);
assert.deepEqual(sanitized.deliveries, contractData.deliveries);
assert.deepEqual(sanitized.payment, contractData.payment);
assert.equal(customerWithCrmHistory.salesContracts.length, 1, 'the caller-owned input must remain unchanged');

const source = buildAccountingContractSourceSnapshot({
  id: 'contract-1',
  contractNumber: '100285',
  customerId: 'customer-1',
  contractData,
  items: [{ id: 'item-1', productRowId: 'row-1', totalPrice: 100 }],
  deliveries: [{ id: 'persisted-delivery-1', products: [{ productRowId: 'row-1', quantity: 1 }] }],
  payments: [{ id: 'payment-1', totalAmount: 100 }],
});

assert.equal(source.id, 'contract-1');
assert.deepEqual(source.items, [{ id: 'item-1', productRowId: 'row-1', totalPrice: 100 }]);
assert.deepEqual(source.deliveries, [{ id: 'persisted-delivery-1', products: [{ productRowId: 'row-1', quantity: 1 }] }]);
assert.deepEqual(source.payments, [{ id: 'payment-1', totalAmount: 100 }]);
assert.equal((source.contractData as any).customer.salesContracts, undefined);
assert.deepEqual((source.contractData as any).products, contractData.products);

console.log('contract and accounting snapshots exclude recursive CRM navigation data: ok');
