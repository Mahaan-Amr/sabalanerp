'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ErpCard, ErpInlineState, ErpLoading } from '@/components/erp';
import { dashboardAPI, salesAPI } from '@/lib/api';
import { getContractPermissions, type User } from '@/lib/permissions';
import type { ContractWizardData } from '@/features/contract-creation/types/contract.types';
import {
  contractCorrectionBannerTitle,
  contractCorrectionCategoryLabel,
} from '@/features/contract-creation/services/contractCorrectionPresentation';
import { resolvePartnerContractRoute } from '@/features/partner-sales/cases/partnerContractRouting';
import { getSalesOperationalErrorKind, getSalesOperationalErrorMessage } from '@/features/sales/salesOperationalError';

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
  partnerKind?: string | null;
  partnerCaseId?: string | null;
  partnerRevision?: number | null;
  partnerIntegrityHash?: string | null;
}

export default function SalesContractEditPage() {
  const params = useParams();
  const contractId = params.id as string;
  const [contract, setContract] = useState<ContractForEdit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<'error' | 'permission' | 'stale'>('error');

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
          setError('قرارداد پیدا نشد. به فهرست قراردادها برگردید و قرارداد دیگری را انتخاب کنید.');
          setErrorKind('stale');
          return;
        }

        const nextContract = contractResponse.data.data as ContractForEdit;
        const user = profileResponse.data?.data as User | undefined;
        const permissions = user ? getContractPermissions(user) : null;

        if (resolvePartnerContractRoute(nextContract).kind !== 'ordinary') {
          setContract(nextContract);
          setError(null);
          return;
        }

        if (!permissions?.canEdit && nextContract.createdByUser?.id !== user?.id) {
          setError('ویرایش این قرارداد برای شما مجاز نیست. به صفحه مشاهده قرارداد برگردید.');
          setErrorKind('permission');
          return;
        }

        if (nextContract.isInactive) {
          setError('این قرارداد غیرفعال و فقط‌خواندنی است. به صفحه مشاهده قرارداد برگردید.');
          setErrorKind('stale');
          return;
        }

        if (nextContract.accountingEditLocked && !nextContract.canOpenCorrectionEdit) {
          setError('این قرارداد پس از تأیید مالی قابل‌ویرایش نیست. از صفحه قرارداد، مسیر درخواست اصلاح را بررسی کنید.');
          setErrorKind('permission');
          return;
        }

        if (!nextContract.contractData) {
          setError('نسخهٔ قابل‌ویرایش این قرارداد موجود نیست. به صفحه مشاهده قرارداد برگردید.');
          setErrorKind('stale');
          return;
        }

        setContract(nextContract);
        setError(null);
        setErrorKind('error');
      } catch (err: any) {
        if (!mounted) return;
        setError(getSalesOperationalErrorMessage(err, {
          failedAction: 'دریافت اطلاعات ویرایش قرارداد',
          nextStep: 'به صفحه مشاهده قرارداد برگردید یا دوباره تلاش کنید.'
        }));
        setErrorKind(getSalesOperationalErrorKind(err));
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

  if (error || !contract) {
    return (
      <div className="sds-workspace py-8" dir="rtl">
        <ErpInlineState
          kind={errorKind}
          title={error || 'قرارداد پیدا نشد. به فهرست قراردادها برگردید.'}
          action={{
            label: 'مشاهده قرارداد',
            href: `/dashboard/sales/contracts/${contractId}`
          }}
        />
      </div>
    );
  }

  const partnerRoute = resolvePartnerContractRoute(contract);
  if (partnerRoute.kind !== 'ordinary') {
    return <ErpCard className="py-8"><ErpInlineState
      kind={partnerRoute.kind === 'blocked' ? 'error' : 'permission'}
      title={partnerRoute.kind === 'blocked' ? 'شواهد نسخه پرونده فروش همکار کامل نیست؛ ویرایش متوقف شد.' : 'اصلاح پرونده فروش همکار از جریان نسخه‌دار و یک‌بار ذخیره انجام می‌شود، نه ویرایش قرارداد عادی.'}
      action={{ label: 'مشاهده پرونده', href: `/dashboard/sales/contracts/${contractId}` }} /></ErpCard>;
  }

  if (!contract.contractData) {
    return <ErpCard className="py-8"><ErpInlineState kind="stale" title="نسخهٔ قابل‌ویرایش این قرارداد موجود نیست. به صفحه مشاهده قرارداد برگردید."
      action={{ label: 'مشاهده قرارداد', href: `/dashboard/sales/contracts/${contractId}` }} /></ErpCard>;
  }

  return (
    <div className="sds-workspace space-y-4" dir="rtl">
      {contract.canOpenCorrectionEdit && contract.activeCorrectionRequest && (
        <ErpInlineState
          kind="stale"
          title={
            <span>
              {contractCorrectionBannerTitle(contract.activeCorrectionRequest.accountantNote)}
              <span className="mr-2 text-xs opacity-80">
                دسته: {contractCorrectionCategoryLabel(contract.activeCorrectionRequest.category)}
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
