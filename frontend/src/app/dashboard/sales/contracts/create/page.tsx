'use client';

import nextDynamic from 'next/dynamic';
import { ErpLoading } from '@/components/erp';
import { PartnerCreationRuntime } from '@/features/contract-creation/partner/PartnerCreationRuntime';

export const dynamic = 'force-dynamic';

const CreateContractWizardClient = nextDynamic(
  () => import('@/features/contract-creation/CreateContractWizardClient'),
  {
    ssr: false,
    loading: () => <ErpLoading />
  }
);

export default function CreateContractPage() {
  return <PartnerCreationRuntime ordinary={<CreateContractWizardClient />} />;
}
