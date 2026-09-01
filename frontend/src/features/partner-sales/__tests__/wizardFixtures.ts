import { PartnerInquiryViewV2Schema } from '@sabalanerp/partner-sales-contracts';
import { createPartnerFixtures } from '@sabalanerp/partner-sales-contracts/testing';

export function createWizardFixtures() {
  const base = createPartnerFixtures();
  return { ...base,
    technicalSaved: {
      schemaVersion: 1 as const, recoveryId: base.configurationDraft.recoveryId,
      recoveryRevision: base.configurationDraft.recoveryRevision, inputRevision: 1,
      graphHash: base.draftSubmissionReference.graphHash, updatedAt: '2026-08-27T08:30:00.000Z',
      rows: [{ configurationRef: base.configurationDraft, quantity: '2', unit: 'meter' as const, configurationChange: 'NEW' as const }],
    },
    inquiry: PartnerInquiryViewV2Schema.parse({ ...base.inquiry, schemaVersion: 2,
    rows: base.inquiry.rows.map(row => ({ ...row, configurationRef: base.configurationDraft })),
  }) };
}
