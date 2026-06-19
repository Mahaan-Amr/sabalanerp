'use client';

import dynamic from 'next/dynamic';

const CreateContractWizardClient = dynamic(
  () => import('@/features/contract-creation/CreateContractWizardClient'),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center" dir="rtl">
        <div className="text-gray-600">در حال بارگذاری...</div>
      </div>
    )
  }
);

export default function CreateCollaborationContractPage() {
  return <CreateContractWizardClient contractKind="collaboration" />;
}
