import { canonicalHash } from '@sabalanerp/partner-sales-contracts';

export type PartnerCustomerDraft = {
  firstName: string;
  lastName: string;
  companyName: string;
  customerType: 'Individual' | 'Company';
  city: string;
  address: string;
  nationalCode: string;
  phone: string;
};

export const emptyPartnerCustomerDraft: PartnerCustomerDraft = {
  firstName: '', lastName: '', companyName: '', customerType: 'Individual',
  city: '', address: '', nationalCode: '', phone: '',
};

export function validatePartnerCustomerDraft(draft: PartnerCustomerDraft): boolean {
  return Boolean(draft.firstName.trim() && draft.lastName.trim() && draft.address.trim()
    && draft.phone.trim().replace(/\D/g, '').length >= 7);
}

export async function buildPartnerCustomerCreateCommand(draft: PartnerCustomerDraft, ids: {
  commandId: string;
  correlationId: string;
  idempotencyKey: string;
}) {
  const intent = {
    schemaVersion: 1 as const,
    firstName: draft.firstName.trim(),
    lastName: draft.lastName.trim(),
    ...(draft.companyName.trim() ? { companyName: draft.companyName.trim() } : {}),
    customerType: draft.customerType,
    ...(draft.city.trim() ? { city: draft.city.trim() } : {}),
    address: draft.address.trim(),
    ...(draft.nationalCode.trim() ? { nationalCode: draft.nationalCode.trim() } : {}),
    phone: draft.phone.trim(),
    reason: 'ثبت مشتری توسط فروشنده همکار',
  };
  return { ...intent, ...ids, payloadHash: await canonicalHash(intent) };
}
