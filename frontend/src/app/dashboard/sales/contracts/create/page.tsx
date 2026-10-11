'use client';

import nextDynamic from 'next/dynamic';
import { ErpLoading, ErpInlineState } from '@/components/erp';
import { PartnerCreationRuntime } from '@/features/contract-creation/partner/PartnerCreationRuntime';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { salesAPI } from '@/lib/api';
import { buildReplacementWizardData } from '@/features/contract-creation/services/contractReplacement';
import type { ContractWizardData } from '@/features/contract-creation/types/contract.types';
import { assertSuccessfulSalesResponse, getSalesOperationalErrorMessage } from '@/features/sales/salesOperationalError';

export const dynamic = 'force-dynamic';

const CreateContractWizardClient = nextDynamic(
  () => import('@/features/contract-creation/CreateContractWizardClient'),
  {
    ssr: false,
    loading: () => <ErpLoading />
  }
);

export default function CreateContractPage() {
  const params = useSearchParams();
  const sourceId = params.get('copyFrom');
  const [replacement, setReplacement] = useState<{ sourceId: string; data?: ContractWizardData; error?: string } | null>(null);
  useEffect(() => {
    if (!sourceId) return;
    let current = true;
    void salesAPI.getContract(sourceId).then(response => {
      assertSuccessfulSalesResponse(response);
      const contract = response.data.data;
      if (!contract.reactivationActions?.canCreateReplacement || !contract.contractData || !contract.customer) {
        throw new Error('ساخت قرارداد جایگزین مجاز نیست؛ وضعیت قرارداد و اطلاعات مشتری را بررسی کنید.');
      }
      const data = buildReplacementWizardData(contract);
      if (current) setReplacement({ sourceId, data });
    }).catch(failure => {
      if (current) setReplacement({ sourceId, error: getSalesOperationalErrorMessage(failure,
        { failedAction: 'آماده‌سازی قرارداد جدید', nextStep: 'به قرارداد قبلی برگردید و دوباره تلاش کنید.' }) });
    });
    return () => { current = false; };
  }, [sourceId]);
  if (sourceId && replacement?.sourceId !== sourceId) return <ErpLoading />;
  if (sourceId && replacement?.error) return <ErpInlineState kind="error" title={replacement.error} />;
  return <PartnerCreationRuntime ordinary={<CreateContractWizardClient key={sourceId || 'ordinary'}
    replacementWizardData={sourceId ? replacement?.data : undefined} />} />;
}
