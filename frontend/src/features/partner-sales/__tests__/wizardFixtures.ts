import { PartnerInquiryViewV2Schema } from '@sabalanerp/partner-sales-contracts';
import { createPartnerFixtures } from '@sabalanerp/partner-sales-contracts/testing';

export function createWizardFixtures() {
  const base = createPartnerFixtures();
  return { ...base, inquiry: PartnerInquiryViewV2Schema.parse({ ...base.inquiry, schemaVersion: 2,
    rows: base.inquiry.rows.map(row => ({ ...row, configurationRef: base.configurationDraft })),
  }) };
}
