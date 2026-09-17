import type {
  PartnerTechnicalDraft,
  PartnerTechnicalProduct,
  PartnerTechnicalSaveReceipt,
} from '@sabalanerp/partner-sales-contracts';

export interface PartnerInquirySubjectOption {
  productRowId: string;
  role: 'PRIMARY' | 'ADDITIONAL_MATERIAL';
  label: string;
}

export function buildPartnerInquirySubjectOptions({ saved, draft, catalog }: {
  saved: PartnerTechnicalSaveReceipt;
  draft: PartnerTechnicalDraft;
  catalog: readonly PartnerTechnicalProduct[];
}): PartnerInquirySubjectOption[] {
  const subjects = saved.pricingSubjects ?? saved.rows.map(row => ({
    configurationRef: row.configurationRef,
    role: 'PRIMARY' as const,
  }));
  let additionalIndex = 0;
  return subjects.map(subject => {
    const productRowId = subject.configurationRef.productRowId;
    const draftRow = draft.rows.find(row => row.productRowId === productRowId);
    const product = draftRow && catalog.find(item => item.catalogItemId === draftRow.catalogItemId
      && item.catalogSnapshotVersion === draftRow.catalogSnapshotVersion);
    if (subject.role === 'ADDITIONAL_MATERIAL') additionalIndex += 1;
    return {
      productRowId,
      role: subject.role,
      label: subject.role === 'PRIMARY'
        ? product?.name ?? productRowId
        : `جزء جانبی ${additionalIndex.toLocaleString('fa-IR')}`,
    };
  });
}
