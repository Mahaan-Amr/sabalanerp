'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ErpInlineState, ErpLoading } from '@/components/erp';
import { dashboardAPI, salesAPI } from '@/lib/api';
import { getContractPermissions, type User } from '@/lib/permissions';
import type { ContractWizardData } from '@/features/contract-creation/types/contract.types';

const CreateContractWizardClient = dynamic(
  () => import('@/features/contract-creation/CreateContractWizardClient'),
  {
    ssr: false,
    loading: () => <ErpLoading />
  }
);

interface ContractForEdit {
  id: string;
  status: string;
  isInactive?: boolean;
  accountingEditLocked?: boolean;
  canOpenCorrectionEdit?: boolean;
  activeCorrectionRequest?: {
    id: string;
    category: string;
    priority?: string;
    accountantNote: string;
    resolutionNote?: string | null;
  } | null;
  contractData?: ContractWizardData | null;
  productGraphProjection?: { revision: number } | null;
  customerId?: string;
  contractNumber: string;
  createdByUser?: {
    id: string;
  };
}

export default function SalesContractEditPage() {
  const params = useParams();
  const contractId = params.id as string;
  const [contract, setContract] = useState<ContractForEdit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        setLoading(true);
        const [contractResponse, profileResponse] = await Promise.all([
          salesAPI.getContract(contractId),
          dashboardAPI.getProfile()
        ]);

        if (!mounted) return;
        if (!contractResponse.data.success || !contractResponse.data.data) {
          setError('قرارداد یافت نشد');
          return;
        }

        const nextContract = contractResponse.data.data as ContractForEdit;
        const user = profileResponse.data?.data as User | undefined;
        const permissions = user ? getContractPermissions(user) : null;

        if (!permissions?.canEdit && nextContract.createdByUser?.id !== user?.id) {
          setError('شما مجاز به ویرایش این قرارداد نیستید');
          return;
        }

        if (nextContract.isInactive) {
          setError('قرارداد غیرفعال فقط‌خواندنی است و قابل ویرایش نیست');
          return;
        }

        if (nextContract.accountingEditLocked && !nextContract.canOpenCorrectionEdit) {
          setError('این قرارداد پس از تایید مالی حسابداری قابل ویرایش نیست');
          return;
        }

        if (!nextContract.contractData) {
          setError('اطلاعات قابل ویرایش قرارداد موجود نیست');
          return;
        }

        setContract(nextContract);
        setError(null);
      } catch (err: any) {
        if (!mounted) return;
        setError(err.response?.data?.error || 'خطا در بارگذاری قرارداد');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();

    return () => {
      mounted = false;
    };
  }, [contractId]);

  if (loading) {
    return (
      <div className="sds-workspace" dir="rtl">
        <ErpLoading />
      </div>
    );
  }

  if (error || !contract?.contractData) {
    return (
      <div className="sds-workspace py-8" dir="rtl">
        <ErpInlineState
          kind="error"
          title={error || 'قرارداد یافت نشد'}
          action={{
            label: 'مشاهده قرارداد',
            href: `/dashboard/sales/contracts/${contractId}`
          }}
        />
      </div>
    );
  }

  return (
    <div className="sds-workspace space-y-4" dir="rtl">
      {contract.canOpenCorrectionEdit && contract.activeCorrectionRequest && (
        <ErpInlineState
          kind="stale"
          title={
            <span>
              اصلاح قرارداد با تایید حسابداری — {contract.activeCorrectionRequest.accountantNote}
              <span className="mr-2 text-xs opacity-80">
                دسته اصلاح: {contract.activeCorrectionRequest.category}
              </span>
            </span>
          }
        />
      )}
      <CreateContractWizardClient
        mode="edit"
        contractId={contract.id}
        initialContractStatus={contract.status}
        initialWizardData={{
          ...contract.contractData,
          productGraphRevision: contract.productGraphProjection?.revision ?? 0
        }}
      />
    </div>
  );
}
