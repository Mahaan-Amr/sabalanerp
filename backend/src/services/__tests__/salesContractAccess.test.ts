import assert from 'node:assert/strict';
import test from 'node:test';
import { validateContractAccess, salesContractAccessWhere } from '../salesContractAccess';

const amin = { id: 'amin', role: 'USER', departmentId: 'sales' };
const assigned = { departmentId: 'management', responsibleSellerId: 'amin', partnerKind: null, partnerCaseId: null };

test('an ordinary assignment extends only the current owner’s contract scope', () => {
  assert.equal(validateContractAccess(assigned, amin), true);
  assert.equal(validateContractAccess({ ...assigned, responsibleSellerId: 'ali' }, amin), false);
  assert.equal(validateContractAccess({ ...assigned, partnerKind: 'PARTNER_CUSTOMER' }, amin), false);
  assert.equal(validateContractAccess({ ...assigned, partnerCaseId: 'partner-case' }, amin), false);
  assert.equal(validateContractAccess(assigned, { ...amin, id: undefined }), false);
  assert.equal(validateContractAccess(assigned, { ...amin, id: 'another-seller' }), false);
});

test('existing department/admin scope and assigned-contract query agree', () => {
  assert.equal(validateContractAccess({ departmentId: 'sales' }, amin), true);
  assert.equal(validateContractAccess(assigned, { ...amin, role: 'ADMIN' }), true);
  assert.deepEqual(salesContractAccessWhere(amin), { OR: [
    { departmentId: 'sales' }, { responsibleSellerId: 'amin', partnerKind: null, partnerCaseId: null },
  ] });
  assert.deepEqual(salesContractAccessWhere({ ...amin, role: 'ADMIN' }), {});
});
