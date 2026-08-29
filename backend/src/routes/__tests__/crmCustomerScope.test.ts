import assert from 'node:assert/strict';
import { customerScopeForActor, ordinaryCrmRelatedVisibility, ordinaryCrmResponse } from '../crm';

assert.deepEqual(customerScopeForActor({ userId: 'admin', role: 'ADMIN', canAssignOwner: false }), { partnerOwnerProfileId: null });
assert.deepEqual(customerScopeForActor({ userId: 'manager', role: 'MANAGER', canAssignOwner: true }), { partnerOwnerProfileId: null });
assert.deepEqual(customerScopeForActor({ userId: 'seller', role: 'USER', canAssignOwner: false }), {
  partnerOwnerProfileId: null,
  OR: [{ ownerUserId: 'seller' }, { ownerUserId: null, createdBy: 'seller' }],
});
assert.deepEqual(ordinaryCrmRelatedVisibility, { OR: [{ customer: { partnerOwnerProfileId: null } },
  { potentialProject: { partnerRevision: null } }] });
const transferred = ordinaryCrmResponse({ id: 'project', customerId: 'private-customer',
  customerTransferSnapshot: { schemaVersion: 1, firstName: 'نام پیشین', lastName: 'مشتری', companyName: null,
    phoneNumbers: [{ number: '09120000000', isPrimary: true }] },
  customer: { id: 'private-customer', partnerOwnerProfileId: 'partner', firstName: 'نام زنده و محرمانه',
    lastName: 'جدید', companyName: 'ویرایش پس از انتقال', phoneNumbers: [{ number: '09999999999', isPrimary: true }] } });
assert.equal(transferred.customerTransferred, true);
assert.deepEqual(transferred.customer, { id: null, firstName: 'نام پیشین', lastName: 'مشتری', companyName: null,
  phoneNumbers: [{ number: '09120000000', isPrimary: true }] });
assert.equal(JSON.stringify(transferred).includes('نام زنده و محرمانه'), false);
assert.equal('customerTransferSnapshot' in transferred, false);

console.log('CRM customer ownership scope tests passed.');
