'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  FaCalendarAlt,
  FaCheck,
  FaCreditCard,
  FaDownload,
  FaEdit,
  FaFileContract,
  FaPrint,
  FaRedo,
  FaSignature,
  FaTimes,
  FaTruck,
} from 'react-icons/fa';
import {
  ErpBadge,
  ErpEmptyState,
  ErpFieldView,
  ErpLoading,
  ErpPage,
  ErpSection,
  ErpTwoColumn,
  type ErpAction,
  type ErpMetric,
  type ErpTone,
} from '@/components/erp';
import { dashboardAPI, salesAPI } from '@/lib/api';
import { downloadBlobResponse } from '@/lib/downloadFile';
import { formatDisplayNumber, formatPrice, formatSquareMeters, sumNumericValues, toFiniteNumber } from '@/lib/numberFormat';
import PersianCalendar from '@/lib/persian-calendar';
import { getContractPermissions, hasFeatureAccess, User as PermissionUser } from '@/lib/permissions';
import { sanitizeUiText, sanitizeUiTextWithCandidates } from '@/lib/textSanitizer';
import { normalizeProductFinishing } from '@/features/contract-creation/utils/finishingUtils';

interface Contract {
  id: string;
  contractNumber: string;
  title: string;
  titlePersian: string;
  content?: string;
  status: string;
  totalAmount: number | string | null;
  currency: string;
  notes?: string;
  contractData?: any;
  createdAt: string;
  updatedAt: string;
  signedAt?: string;
  printedAt?: string;
  isSigned?: boolean;
  accountingEditLocked?: boolean;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    companyName?: string;
    customerType: string;
    primaryContact?: {
      firstName: string;
      lastName: string;
      email?: string;
      phone?: string;
    };
  };
  department: {
    id: string;
    name: string;
    namePersian: string;
  };
  createdByUser: {
    id: string;
    firstName: string;
    lastName: string;
    username: string;
  };
  approvedByUser?: {
    firstName: string;
    lastName: string;
  };
  signedByUser?: {
    firstName: string;
    lastName: string;
  };
  items?: any[];
  deliveries?: any[];
  payments?: any[];
}

const statusLabels: Record<string, string> = {
  DRAFT: 'پیش‌نویس',
  PENDING_APPROVAL: 'در انتظار تایید',
  APPROVED: 'تایید شده',
  SIGNED: 'امضا شده',
  PRINTED: 'چاپ شده',
  CANCELLED: 'لغو شده',
  EXPIRED: 'منقضی شده',
};

const statusTones: Record<string, ErpTone> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'info',
  SIGNED: 'success',
  PRINTED: 'purple',
  CANCELLED: 'danger',
  EXPIRED: 'neutral',
};

const formatCurrency = (amount: number | string | null | undefined, currency: string) => formatPrice(amount, currency);

const getCustomerName = (contract: Contract) =>
  sanitizeUiTextWithCandidates(
    [
      `${contract.customer.firstName || ''} ${contract.customer.lastName || ''}`.trim(),
      contract.customer.companyName,
    ],
    'نامشخص'
  );

export default function ContractDetailPage() {
  const params = useParams();
  const contractId = params.id as string;

  const [contract, setContract] = useState<Contract | null>(null);
  const [currentUser, setCurrentUser] = useState<PermissionUser | null>(null);
  const [contractPermissions, setContractPermissions] = useState({
    canView: false,
    canCreate: false,
    canEdit: false,
    canApprove: false,
    canReject: false,
    canSign: false,
    canPrint: false,
  });
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadContract();
    loadCurrentUser();
  }, [contractId]);

  const loadContract = async () => {
    try {
      setLoading(true);
      const response = await salesAPI.getContract(contractId);
      if (response.data.success) {
        setContract(response.data.data);
        setError(null);
      } else {
        setError('قرارداد یافت نشد');
      }
    } catch (error: any) {
      console.error('Error loading contract:', error);
      setError(error.response?.data?.error || 'خطا در بارگذاری قرارداد');
    } finally {
      setLoading(false);
    }
  };

  const loadCurrentUser = async () => {
    try {
      const response = await dashboardAPI.getProfile();
      if (response.data.success) {
        const user = response.data.data;
        setCurrentUser(user);
        setContractPermissions(getContractPermissions(user));
      }
    } catch (error) {
      console.error('Error loading user profile:', error);
    }
  };

  const handleAction = async (action: string, note?: string) => {
    if (!contract) return;

    setActionLoading(action);
    try {
      let response;
      switch (action) {
        case 'approve':
          response = await salesAPI.approveContract(contract.id, note);
          break;
        case 'reject':
          response = await salesAPI.rejectContract(contract.id, note);
          break;
        case 'sign':
          response = await salesAPI.signContract(contract.id, note);
          break;
        default:
          return;
      }

      if (response.data.success) {
        setContract(response.data.data);
        setError(null);
      } else {
        setError(response.data.error || 'خطا در انجام عملیات');
      }
    } catch (error: any) {
      console.error(`Error ${action}ing contract:`, error);
      setError(error.response?.data?.error || 'خطا در انجام عملیات');
    } finally {
      setActionLoading(null);
    }
  };

  const openPdfUrl = (url: string, tryPrint: boolean) => {
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    if (!win || !tryPrint) return;

    try {
      const triggerPrint = () => {
        try {
          win.focus();
          win.print();
        } catch (error) {
          console.error('Print trigger failed:', error);
        }
      };
      win.addEventListener('load', triggerPrint, { once: true });
      setTimeout(triggerPrint, 1200);
    } catch (error) {
      console.error('Print setup failed:', error);
    }
  };

  const handleDownloadPdf = async () => {
    if (!contract) return;
    setActionLoading('download');
    try {
      const response = await salesAPI.downloadContractPdf(contract.id, { fresh: false });
      downloadBlobResponse(response, `sales_contract_${contract.contractNumber || contract.id}.pdf`);
    } catch (error: any) {
      setError(error.response?.data?.error || 'خطا در دانلود PDF قرارداد');
    } finally {
      setActionLoading(null);
    }
  };

  const handlePrintContract = async () => {
    if (!contract) return;
    setActionLoading('print');
    try {
      const response = await salesAPI.printContract(contract.id);
      if (!response.data?.success) {
        setError(response.data?.error || 'پرینت قرارداد ناموفق بود');
        return;
      }

      setContract(response.data.data);
      const pdfResponse = await salesAPI.getContractPdf(contract.id, { fresh: false });
      if (pdfResponse.data?.success && pdfResponse.data?.data?.url) {
        openPdfUrl(pdfResponse.data.data.url, true);
      }
    } catch (error: any) {
      setError(error.response?.data?.error || 'خطا در پرینت قرارداد');
    } finally {
      setActionLoading(null);
    }
  };

  const handleResendConfirmation = async () => {
    if (!contract) return;
    setActionLoading('resend-confirmation');
    try {
      const response = await salesAPI.resendConfirmation(contract.id);
      if (response.data?.success) {
        setError(null);
      } else {
        setError(response.data?.error || 'ارسال دوباره کد تایید ناموفق بود');
      }
    } catch (error: any) {
      setError(error.response?.data?.error || 'خطا در ارسال دوباره کد تایید');
    } finally {
      setActionLoading(null);
    }
  };

  const products = useMemo(() => {
    if (!contract) return [];
    return contract.contractData?.products?.length ? contract.contractData.products : contract.items || [];
  }, [contract]);

  const deliveries = useMemo(() => {
    if (!contract) return [];
    return contract.deliveries?.length ? contract.deliveries : contract.contractData?.deliveries || [];
  }, [contract]);

  const payments = useMemo(() => {
    if (!contract) return [];
    return contract.payments?.length ? contract.payments : contract.contractData?.payment?.installments || [];
  }, [contract]);

  if (loading) {
    return <ErpLoading />;
  }

  if (error || !contract) {
    return (
      <ErpEmptyState
        icon={FaFileContract}
        title={error || 'قرارداد یافت نشد'}
        description="برای ادامه می‌توانید به لیست قراردادهای فروش برگردید."
        action={{ label: 'بازگشت به لیست قراردادها', href: '/dashboard/sales/contracts', tone: 'primary', variant: 'solid' }}
      />
    );
  }

  const totalAmount =
    toFiniteNumber(contract.totalAmount) ||
    sumNumericValues(products, (item: any) => item.totalPrice) ||
    toFiniteNumber(contract.contractData?.payment?.totalAmount);

  const canEdit = !contract.accountingEditLocked && (contractPermissions.canEdit || contract.createdByUser.id === currentUser?.id);
  const canApprove = (contract.status === 'DRAFT' || contract.status === 'PENDING_APPROVAL') && contractPermissions.canApprove;
  const canReject = (contract.status === 'DRAFT' || contract.status === 'PENDING_APPROVAL') && contractPermissions.canReject;
  const canSign = contract.status === 'APPROVED' && contractPermissions.canSign;
  const canDownloadPdf = contractPermissions.canView;
  const canPrint = contractPermissions.canPrint;
  const canResendConfirmation =
    contract.status !== 'CANCELLED' &&
    !contract.isSigned &&
    hasFeatureAccess(currentUser, 'sales_verification_send', 'edit');

  const actions: ErpAction[] = [
    ...(canEdit ? [{ label: 'ویرایش', href: `/dashboard/sales/contracts/${contract.id}/edit`, icon: FaEdit, tone: 'info' as ErpTone, variant: 'soft' as const }] : []),
    ...(canApprove ? [{ label: 'تایید', onClick: () => handleAction('approve'), icon: FaCheck, tone: 'success' as ErpTone, disabled: actionLoading === 'approve' }] : []),
    ...(canReject ? [{ label: 'رد', onClick: () => handleAction('reject'), icon: FaTimes, tone: 'danger' as ErpTone, disabled: actionLoading === 'reject' }] : []),
    ...(canSign ? [{ label: 'امضا', onClick: () => handleAction('sign'), icon: FaSignature, tone: 'success' as ErpTone, disabled: actionLoading === 'sign' }] : []),
    ...(canPrint ? [{ label: 'دانلود PDF', onClick: handleDownloadPdf, icon: FaDownload, tone: 'success' as ErpTone, disabled: actionLoading === 'download' }] : []),
    ...(canPrint ? [{ label: 'پرینت', onClick: handlePrintContract, icon: FaPrint, tone: 'purple' as ErpTone, disabled: actionLoading === 'print' }] : []),
  ];

  if (!canPrint && canDownloadPdf) {
    actions.push({
      label: 'دانلود PDF',
      onClick: handleDownloadPdf,
      icon: FaDownload,
      tone: 'success' as ErpTone,
      disabled: actionLoading === 'download'
    });
  }

  if (canResendConfirmation) {
    actions.push({
      label: 'ارسال دوباره کد تایید',
      onClick: handleResendConfirmation,
      icon: FaRedo,
      tone: 'info' as ErpTone,
      disabled: actionLoading === 'resend-confirmation'
    });
  }

  const metrics: ErpMetric[] = [
    { label: 'وضعیت', value: statusLabels[contract.status] || contract.status, icon: FaFileContract, tone: statusTones[contract.status] || 'neutral' },
    { label: 'مبلغ کل', value: formatCurrency(totalAmount, sanitizeUiText(contract.currency, 'تومان')), icon: FaCreditCard, tone: 'success' },
    { label: 'اقلام', value: products.length.toLocaleString('fa-IR'), hint: 'محصول ثبت شده', icon: FaFileContract, tone: 'info' },
    { label: 'برنامه تحویل', value: deliveries.length.toLocaleString('fa-IR'), hint: 'مرحله تحویل', icon: FaTruck, tone: 'warning' },
  ];

  return (
    <ErpPage
      eyebrow="قرارداد فروش"
      title={sanitizeUiTextWithCandidates([contract.titlePersian, contract.title, contract.contractNumber], 'قرارداد فروش')}
      description={`شماره قرارداد: ${sanitizeUiText(contract.contractNumber, '—')}`}
      backHref="/dashboard/sales/contracts"
      actions={actions}
      metrics={metrics}
    >
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
          {error}
        </div>
      )}

      <ErpTwoColumn
        main={
          <>
            <ErpSection
              title="اطلاعات قرارداد"
              description="خلاصه وضعیت، مبلغ، تاریخ‌ها و یادداشت‌های ثبت شده."
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ErpFieldView label="شماره قرارداد" value={sanitizeUiText(contract.contractNumber, '—')} tone="primary" />
                <ErpFieldView
                  label="وضعیت"
                  value={<ErpBadge tone={statusTones[contract.status] || 'neutral'}>{statusLabels[contract.status] || contract.status}</ErpBadge>}
                />
                <ErpFieldView label="تاریخ ایجاد" value={PersianCalendar.formatForDisplay(contract.createdAt)} />
                <ErpFieldView label="آخرین بروزرسانی" value={PersianCalendar.formatForDisplay(contract.updatedAt)} />
              </div>
              {contract.notes && (
                <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {sanitizeUiText(contract.notes, '—')}
                </div>
              )}
            </ErpSection>

            <ErpSection title="اقلام قرارداد" description="محصولات، متراژ و قیمت‌های ثبت شده در قرارداد.">
              {products.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">اقلامی برای این قرارداد ثبت نشده است.</p>
              ) : (
                <div className="space-y-3">
                  {products.map((item: any, index: number) => {
                    const product = item.product || item;
                    const productName = sanitizeUiTextWithCandidates([product.namePersian, product.name, item.namePersian, item.name], `محصول ${index + 1}`);
                    const quantity = toFiniteNumber(item.quantity);
                    const squareMeters = item.squareMeters ?? product.squareMeter ?? 0;
                    const unitPrice = item.unitPrice ?? item.pricePerSquareMeter ?? 0;
                    const itemTotal = item.totalPrice ?? 0;
                    const finishing = normalizeProductFinishing(item);

                    return (
                      <div key={`${productName}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="font-semibold text-slate-900 dark:text-white">{productName}</p>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              {product.widthValue && product.thicknessValue ? `${product.widthValue} × ${product.thicknessValue} cm` : 'ابعاد نامشخص'}
                            </p>
                          </div>
                          <ErpBadge tone="primary">{formatCurrency(itemTotal, sanitizeUiText(item.currency || contract.currency, 'تومان'))}</ErpBadge>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                          <ErpFieldView label="تعداد" value={formatDisplayNumber(quantity)} />
                          <ErpFieldView label="متراژ" value={formatSquareMeters(squareMeters)} />
                          <ErpFieldView label="قیمت واحد" value={toFiniteNumber(unitPrice) > 0 ? formatPrice(unitPrice, sanitizeUiText(item.currency || contract.currency, 'تومان')) : 'نامشخص'} />
                          <ErpFieldView label="جمع" value={toFiniteNumber(itemTotal) > 0 ? formatPrice(itemTotal, sanitizeUiText(item.currency || contract.currency, 'تومان')) : 'نامشخص'} tone="primary" />
                        </div>
                        {finishing && finishing.cost > 0 && (
                          <div className="mt-3 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-xs leading-5 text-teal-800 dark:border-teal-800 dark:bg-teal-900/20 dark:text-teal-200">
                            <span className="font-semibold">{sanitizeUiText(item.finishingName || finishing.name || 'پرداخت سنگ')}</span>
                            <span className="mx-1">•</span>
                            <span>{finishing.amountLabel}</span>
                            {finishing.rateLabel && (
                              <>
                                <span className="mx-1">×</span>
                                <span>{finishing.rateLabel}</span>
                              </>
                            )}
                            <span className="mx-1">=</span>
                            <span className="font-semibold">{formatPrice(finishing.cost, sanitizeUiText(item.currency || contract.currency, 'تومان'))}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </ErpSection>

            <ErpSection title="تحویل و پرداخت" description="برنامه‌های تحویل و اطلاعات پرداخت مرتبط با قرارداد.">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">برنامه تحویل</h3>
                  {deliveries.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">برنامه تحویلی ثبت نشده است.</p>
                  ) : (
                    deliveries.map((delivery: any, index: number) => (
                      <div key={index} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                        <p className="font-medium text-slate-900 dark:text-white">{delivery.deliveryDate || delivery.date || 'تاریخ نامشخص'}</p>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{sanitizeUiText(delivery.notes || delivery.deliveryAddress, 'بدون توضیحات')}</p>
                      </div>
                    ))
                  )}
                </div>
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">پرداخت</h3>
                  <ErpFieldView label="روش پرداخت" value={sanitizeUiText(contract.contractData?.payment?.method, 'ثبت نشده')} tone="primary" />
                  <ErpFieldView label="مبلغ پرداخت" value={formatCurrency(contract.contractData?.payment?.totalAmount || totalAmount, sanitizeUiText(contract.currency, 'تومان'))} tone="success" />
                  {payments.length > 0 && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">{payments.length.toLocaleString('fa-IR')} قسط/پرداخت ثبت شده است.</p>
                  )}
                </div>
              </div>
            </ErpSection>
          </>
        }
        aside={
          <>
            <ErpSection title="مشتری">
              <div className="space-y-3">
                <ErpFieldView label="نام" value={getCustomerName(contract)} tone="primary" />
                {contract.customer.companyName && <ErpFieldView label="شرکت" value={sanitizeUiText(contract.customer.companyName, '—')} />}
                <ErpFieldView label="نوع مشتری" value={sanitizeUiText(contract.customer.customerType, 'نامشخص')} />
                {contract.customer.primaryContact && (
                  <ErpFieldView
                    label="تماس اصلی"
                    value={`${contract.customer.primaryContact.firstName || ''} ${contract.customer.primaryContact.lastName || ''}`.trim() || 'نامشخص'}
                    hint={contract.customer.primaryContact.phone || contract.customer.primaryContact.email}
                  />
                )}
              </div>
            </ErpSection>

            <ErpSection title="بخش و کاربران">
              <div className="space-y-3">
                <ErpFieldView label="بخش" value={sanitizeUiText(contract.department.namePersian, '—')} />
                <ErpFieldView label="ایجاد کننده" value={`${contract.createdByUser.firstName} ${contract.createdByUser.lastName}`} />
                {contract.approvedByUser && <ErpFieldView label="تایید کننده" value={`${contract.approvedByUser.firstName} ${contract.approvedByUser.lastName}`} />}
                {contract.signedByUser && <ErpFieldView label="امضا کننده" value={`${contract.signedByUser.firstName} ${contract.signedByUser.lastName}`} />}
              </div>
            </ErpSection>

            <ErpSection title="تاریخچه">
              <div className="space-y-3">
                <TimelineItem icon={FaCalendarAlt} label="ایجاد شده" value={PersianCalendar.formatForDisplay(contract.createdAt)} tone="primary" />
                {contract.signedAt && <TimelineItem icon={FaSignature} label="امضا شده" value={PersianCalendar.formatForDisplay(contract.signedAt)} tone="success" />}
                {contract.printedAt && <TimelineItem icon={FaPrint} label="چاپ شده" value={PersianCalendar.formatForDisplay(contract.printedAt)} tone="purple" />}
              </div>
            </ErpSection>
          </>
        }
      />
    </ErpPage>
  );
}

function TimelineItem({ icon: Icon, label, value }: { icon: typeof FaCalendarAlt; label: string; value: string; tone: ErpTone }) {
  return (
    <div className="flex items-center gap-3">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#074747]/10 text-[#074747] dark:bg-teal-900/30 dark:text-teal-100">
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <p className="text-sm font-medium text-slate-900 dark:text-white">{label}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{value}</p>
      </div>
    </div>
  );
}
