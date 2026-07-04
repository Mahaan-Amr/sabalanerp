'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { FaFileContract } from 'react-icons/fa';
import { dashboardAPI, salesAPI } from '@/lib/api';
import { getContractPermissions, type User } from '@/lib/permissions';
import type { ContractWizardData } from '@/features/contract-creation/types/contract.types';

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

interface ContractForEdit {
  id: string;
  status: string;
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
      <div className="flex items-center justify-center py-12" dir="rtl">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500" />
      </div>
    );
  }

  if (error || !contract?.contractData) {
    return (
      <div className="text-center py-12" dir="rtl">
        <FaFileContract className="mx-auto text-4xl text-slate-500 dark:text-slate-400 mb-4" />
        <p className="text-slate-500 dark:text-slate-400 mb-4">{error || 'قرارداد یافت نشد'}</p>
        <Link href={`/dashboard/sales/contracts/${contractId}`} className="glass-liquid-btn-primary">
          مشاهده قرارداد
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4" dir="rtl">
      {contract.canOpenCorrectionEdit && contract.activeCorrectionRequest && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100">
          <p className="font-semibold">اصلاح قرارداد با تایید حسابداری</p>
          <p className="mt-2 leading-6">{contract.activeCorrectionRequest.accountantNote}</p>
          <p className="mt-2 text-xs opacity-80">دسته اصلاح: {contract.activeCorrectionRequest.category}</p>
        </div>
      )}
      <CreateContractWizardClient
        mode="edit"
        contractId={contract.id}
        initialContractStatus={contract.status}
        initialWizardData={contract.contractData}
      />
    </div>
  );
}
