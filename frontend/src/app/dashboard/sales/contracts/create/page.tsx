'use client';

import nextDynamic from 'next/dynamic';
import { ErpLoading } from '@/components/erp';
import { PartnerCreationBoundary } from '@/features/contract-creation/partner/PartnerCreationChannel';

export const dynamic = 'force-dynamic';

const CreateContractWizardClient = nextDynamic(
  () => import('@/features/contract-creation/CreateContractWizardClient'),
  {
    ssr: false,
    loading: () => <ErpLoading />
  }
);

export default function CreateContractPage() {
  return <PartnerCreationBoundary><CreateContractWizardClient /></PartnerCreationBoundary>;
}
