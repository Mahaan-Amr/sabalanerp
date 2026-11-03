import assert from 'node:assert/strict';
import {
  ContractPartyIdentityValidationError,
  validateContractPartyChangeCompleteness,
  validateContractPartyIdentity
} from '../contractPartyIdentity';

const lookup = {
  findCustomer: async (id: string) => id === 'customer-1'
    ? { id, firstName: 'فریبا', lastName: 'پور شهید', companyName: null }
    : null,
  findProject: async (id: string) => id === 'project-1'
    ? { id, customerId: 'customer-1' }
    : id === 'project-other' ? { id, customerId: 'customer-2' } : null
};

const run = async () => {
assert.throws(
  () => validateContractPartyChangeCompleteness({
    previousCustomerId: 'customer-old',
    customerId: 'customer-1',
    contractData: { customerId: 'customer-1' }
  }),
  (error: unknown) => error instanceof ContractPartyIdentityValidationError &&
    error.message === 'تغییر مشتری فقط همراه با اطلاعات کامل مشتری، پروژه و متن تازه قرارداد مجاز است.'
);

await validateContractPartyIdentity({
  customerId: 'customer-1',
  content: '<p>قرارداد فریبا پور شهید</p>',
  contractData: { customerId: 'customer-1', customer: { id: 'customer-1', firstName: 'فریبا', lastName: 'پور شهید' }, projectId: 'project-1', project: { id: 'project-1' } }
}, lookup);

await assert.rejects(
  validateContractPartyIdentity({
    customerId: 'customer-1',
    content: '<p>قرارداد فریبا پورشهید</p>',
    contractData: { customerId: 'customer-1', customer: { id: 'customer-1', firstName: 'فریبا', lastName: 'پور شهید' }, projectId: 'project-1', project: { id: 'project-1' } }
  }, lookup),
  (error: unknown) => error instanceof ContractPartyIdentityValidationError &&
    error.message === 'متن قرارداد با مشتری اصلی قرارداد یکسان نیست.'
);

await assert.rejects(
  validateContractPartyIdentity({ customerId: 'customer-1' }, lookup),
  (error: unknown) => error instanceof ContractPartyIdentityValidationError &&
    error.message === 'اطلاعات مشتری و پروژه قرارداد باید به‌صورت کامل ارسال شود.'
);

await assert.rejects(
  validateContractPartyIdentity({
    customerId: 'customer-1',
    content: '<p>فریبا پور شهید</p>',
    contractData: { customerId: 'customer-2', customer: { id: 'customer-2' }, projectId: 'project-other', project: { id: 'project-other' } }
  }, lookup),
  (error: unknown) => error instanceof ContractPartyIdentityValidationError &&
    error.message === 'هویت مشتری در اطلاعات قرارداد با مشتری اصلی یکسان نیست.'
);

await assert.rejects(
  validateContractPartyIdentity({
    customerId: 'customer-1',
    content: '<p>فریبا پور شهید</p>',
    contractData: { customerId: 'customer-1', customer: { id: 'customer-1', firstName: 'فریبا', lastName: 'پور شهید' }, projectId: 'project-other', project: { id: 'project-other' } }
  }, lookup),
  (error: unknown) => error instanceof ContractPartyIdentityValidationError &&
    error.message === 'پروژه انتخاب‌شده متعلق به مشتری اصلی قرارداد نیست.'
);
};

void run();

console.log('contract party identity backend tests passed');
