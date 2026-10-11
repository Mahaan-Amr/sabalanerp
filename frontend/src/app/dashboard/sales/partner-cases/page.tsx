import { PartnerCaseRuntime } from '@/features/partner-sales/cases/PartnerCaseRuntime';

import { PartnerContractListEntry } from '@/features/partner-sales/cases/PartnerContractListEntry';

export default function PartnerCasesPage() {
  return <PartnerContractListEntry legacy ordinary={<PartnerCaseRuntime />} />;
}
