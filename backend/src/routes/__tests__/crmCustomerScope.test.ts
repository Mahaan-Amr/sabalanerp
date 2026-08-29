import assert from 'node:assert/strict';
import { customerScopeForActor, ordinaryCrmRelatedVisibility, ordinaryCrmResponse, ordinaryProjectSearch } from '../crm';

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
    phoneNumbers: [{ number: '09120000000', isPrimary: true, secret: 'نباید منتشر شود' }] },
  customer: { id: 'private-customer', partnerOwnerProfileId: 'partner', firstName: 'نام زنده و محرمانه',
    lastName: 'جدید', companyName: 'ویرایش پس از انتقال', phoneNumbers: [{ number: '09999999999', isPrimary: true }] } });
assert.equal(transferred.customerTransferred, true);
assert.deepEqual(transferred.customer, { id: null, firstName: 'نام پیشین', lastName: 'مشتری', companyName: null,
  phoneNumbers: [{ number: '09120000000', isPrimary: true }] });
assert.equal(JSON.stringify(transferred).includes('نام زنده و محرمانه'), false);
assert.equal(JSON.stringify(transferred).includes('نباید منتشر شود'), false);
assert.equal('customerTransferSnapshot' in transferred, false);
assert.deepEqual(ordinaryProjectSearch('مالک'), { OR: [
  { title: { contains: 'مالک', mode: 'insensitive' } },
  { address: { contains: 'مالک', mode: 'insensitive' } },
  { description: { contains: 'مالک', mode: 'insensitive' } },
  { customer: { partnerOwnerProfileId: null, OR: [
    { firstName: { contains: 'مالک', mode: 'insensitive' } },
    { lastName: { contains: 'مالک', mode: 'insensitive' } },
    { companyName: { contains: 'مالک', mode: 'insensitive' } },
  ] } },
  { customerTransferSnapshot: { path: ['firstName'], string_contains: 'مالک' } },
  { customerTransferSnapshot: { path: ['lastName'], string_contains: 'مالک' } },
  { customerTransferSnapshot: { path: ['companyName'], string_contains: 'مالک' } },
] });

console.log('CRM customer ownership scope tests passed.');
