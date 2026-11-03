'use client';

import dynamic from 'next/dynamic';
import { ErpLoading } from '@/components/erp';

const CreateContractWizardClient = dynamic(
  () => import('@/features/contract-creation/CreateContractWizardClient'),
  {
    ssr: false,
    loading: () => <ErpLoading />
  }
);

export default function CreateCollaborationContractPage() {
  return <CreateContractWizardClient contractKind="collaboration" />;
}
