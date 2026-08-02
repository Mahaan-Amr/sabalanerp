import React from 'react';
import { ErpNeumorphicCard, ErpNeumorphicDisclosure, ErpPressable } from '@/components/erp';
import {
  FaFileContract,
  FaUser,
  FaCreditCard,
  FaSpinner,
  FaClock,
  FaCheckCircle,
  FaTimesCircle,
  FaDownload,
  FaPrint,
  FaTools,
  FaTruck,
  FaListAlt,
  FaMoneyCheckAlt
} from 'react-icons/fa';
import { formatPriceWithRial } from '@/lib/numberFormat';
import type {
  ContractWizardData,
  ContractStep8DeliveryDetail,
  ContractStep8FinancialSummary,
  ContractStep8PaymentDetail,
  ContractStep8ProductDetail,
  ContractStep8ServiceDetail
} from '../../types/contract.types';

interface Step8DigitalSignatureProps {
  wizardData: ContractWizardData;
  errors: Record<string, string>;
  sendingCode: boolean;
  onSendForConfirmation: () => void;
  onResendConfirmation: () => void;
  onRefreshStatus: () => void;
  onCancelContract: () => void;
  onDownloadContractPdf: () => void;
  onPrintContractPdf: () => void;
  canDownloadPdfAction: boolean;
  canPrintPdfAction: boolean;
  pdfActionLoading: boolean;
  printActionLoading: boolean;
  productDetails: ContractStep8ProductDetail[];
  serviceDetails: ContractStep8ServiceDetail[];
  standaloneServiceDetails: ContractStep8ServiceDetail[];
  deliveryDetails: ContractStep8DeliveryDetail[];
  paymentDetails: ContractStep8PaymentDetail[];
  financialSummary: ContractStep8FinancialSummary;
}

const normalizeIranMobileNumber = (value?: string | null) => {
  if (!value) return null;

  const digits = value.replace(/\D/g, '');
  let normalized = digits;

  if (digits.startsWith('0098')) {
    normalized = `0${digits.slice(4)}`;
  } else if (digits.startsWith('98') && digits.length === 12) {
    normalized = `0${digits.slice(2)}`;
  } else if (digits.startsWith('9') && digits.length === 10) {
    normalized = `0${digits}`;
  }

  return /^09\d{9}$/.test(normalized) ? normalized : null;
};

const getCustomerSmsPhoneNumber = (wizardData: ContractWizardData) => {
  const phoneNumbers = wizardData.customer?.phoneNumbers || [];
  const candidates = [
    wizardData.signature?.phoneNumber,
    phoneNumbers.find((phone) => phone.isPrimary && phone.type === 'mobile')?.number,
    ...phoneNumbers.filter((phone) => phone.type === 'mobile').map((phone) => phone.number),
    phoneNumbers.find((phone) => phone.isPrimary)?.number,
    wizardData.customer?.projectManagerNumber,
    ...phoneNumbers.filter((phone) => phone.isActive !== false).map((phone) => phone.number),
    ...phoneNumbers.map((phone) => phone.number),
    wizardData.customer?.homeNumber,
    wizardData.customer?.workNumber
  ];

  for (const candidate of candidates) {
    const mobile = normalizeIranMobileNumber(candidate);
    if (mobile) return mobile;
  }

  return null;
};

const renderStatusBadge = (
  status: ContractWizardData['signature'] extends infer T
    ? T extends { confirmationStatus: infer S }
      ? S
      : never
    : never
) => {
  if (status === 'VERIFIED') {
    return (
      <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--sds-success-surface)] text-[var(--sds-success)] dark:bg-[var(--sds-success-surface)] dark:text-[var(--sds-success)]">
        <FaCheckCircle /> تایید شده
      </span>
    );
  }

  if (status === 'PENDING') {
    return (
      <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--sds-warning-surface)] text-[var(--sds-warning)] dark:bg-[var(--sds-warning-surface)] dark:text-[var(--sds-warning)]">
        <FaClock /> در انتظار تایید
      </span>
    );
  }

  if (status === 'CANCELLED') {
    return (
      <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--sds-danger-surface)] text-[var(--sds-danger)] dark:bg-[var(--sds-danger-surface)] dark:text-[var(--sds-danger)]">
        <FaTimesCircle /> لغو شده
      </span>
    );
  }

  if (status === 'EXPIRED') {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-[var(--sds-warning-surface)] px-3 py-1 text-[var(--sds-warning)]">
        <FaClock /> منقضی شده
      </span>
    );
  }

  return null;
};

export const Step8DigitalSignature: React.FC<Step8DigitalSignatureProps> = ({
  wizardData,
  errors,
  sendingCode,
  onSendForConfirmation,
  onResendConfirmation,
  onRefreshStatus,
  onCancelContract,
  onDownloadContractPdf,
  onPrintContractPdf,
  canDownloadPdfAction,
  canPrintPdfAction,
  pdfActionLoading,
  printActionLoading,
  productDetails,
  serviceDetails,
  standaloneServiceDetails,
  deliveryDetails,
  paymentDetails,
  financialSummary
}) => {
  const signature = wizardData.signature;
  const smsPhoneNumber = getCustomerSmsPhoneNumber(wizardData);

  return (
    <div className="space-y-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <ErpNeumorphicCard className="border-[var(--sds-accent)] p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-2xl font-bold text-[var(--sds-text-primary)]">خلاصه قرارداد</h3>
            <FaFileContract className="text-3xl text-[var(--sds-accent)] dark:text-[var(--sds-accent)]" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <ErpNeumorphicCard className="p-4">
                <h4 className="font-semibold text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] mb-3 flex items-center gap-2">
                  <FaFileContract className="text-[var(--sds-accent)]" />
                  اطلاعات قرارداد
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">شماره قرارداد:</span>
                    <span className="font-medium text-[var(--sds-text-primary)]">{wizardData.contractNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">تاریخ قرارداد:</span>
                    <span className="font-medium text-[var(--sds-text-primary)]">{wizardData.contractDate}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">وضعیت:</span>
                    <span className="font-medium text-[var(--sds-text-primary)]">
                      {signature?.contractStatus || '—'}
                    </span>
                  </div>
                </div>
              </ErpNeumorphicCard>

              <ErpNeumorphicCard className="p-4">
                <h4 className="font-semibold text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] mb-3 flex items-center gap-2">
                  <FaUser className="text-[var(--sds-accent)]" />
                  اطلاعات مشتری
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">نام:</span>
                    <span className="font-medium text-[var(--sds-text-primary)]">
                      {wizardData.customer?.firstName} {wizardData.customer?.lastName}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">شماره موبایل تایید:</span>
                    <span className="font-medium text-[var(--sds-text-primary)]">
                      {smsPhoneNumber || 'موبایل معتبر ثبت نشده'}
                    </span>
                  </div>
                </div>
              </ErpNeumorphicCard>
            </div>

            <div className="space-y-4">
              <ErpNeumorphicCard className="p-4">
                <h4 className="font-semibold text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] mb-3 flex items-center gap-2">
                  <FaCreditCard className="text-[var(--sds-accent)]" />
                  جمع‌بندی مالی
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">جمع محصولات:</span>
                    <span className="font-medium text-[var(--sds-text-primary)]">
                      {formatPriceWithRial(financialSummary.productsTotal, financialSummary.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">جمع خدمات:</span>
                    <span className="font-medium text-[var(--sds-text-primary)]">
                      {formatPriceWithRial(financialSummary.servicesTotal, financialSummary.currency)}
                    </span>
                  </div>
                  {financialSummary.discountAmount && financialSummary.discountAmount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
                        تخفیف ({financialSummary.discountPercent || 0}٪):
                      </span>
                      <span className="font-medium text-[var(--sds-success)] dark:text-[var(--sds-success)]">
                        {formatPriceWithRial(financialSummary.discountAmount, financialSummary.currency)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">جمع پرداختی:</span>
                    <span className="font-medium text-[var(--sds-text-primary)]">
                      {formatPriceWithRial(financialSummary.paymentTotal, financialSummary.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-[var(--sds-border-default)] dark:border-[var(--sds-border-subtle)]">
                    <span className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">مبلغ نهایی قرارداد:</span>
                    <span className="font-semibold text-[var(--sds-accent)] dark:text-[var(--sds-accent)]">
                      {formatPriceWithRial(financialSummary.grandTotal, financialSummary.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">مانده پرداخت:</span>
                    <span className="font-semibold text-[var(--sds-warning)] dark:text-[var(--sds-warning)]">
                      {formatPriceWithRial(financialSummary.remainingAmount, financialSummary.currency)}
                    </span>
                  </div>
                </div>
              </ErpNeumorphicCard>

              <ErpNeumorphicCard className="space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">وضعیت تایید مشتری</h4>
                  {renderStatusBadge(signature?.confirmationStatus ?? null)}
                </div>
                <div className="text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] space-y-1">
                  <p>تعداد تلاش: {signature?.attemptsUsed ?? 0} / {signature?.maxAttempts ?? 5}</p>
                  <p>تعداد ارسال مجدد: {signature?.resendCount ?? 0}</p>
                  {signature?.lastSentAt && <p>آخرین ارسال: {new Date(signature.lastSentAt).toLocaleString('fa-IR')}</p>}
                  {signature?.lastOpenedAt && <p>آخرین بازدید مشتری: {new Date(signature.lastOpenedAt).toLocaleString('fa-IR')}</p>}
                </div>
              </ErpNeumorphicCard>
            </div>
          </div>
        </ErpNeumorphicCard>

        <div className="grid grid-cols-1 gap-3">
          <ErpNeumorphicDisclosure open>
            <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 font-semibold text-[var(--sds-text-primary)]">
              <FaListAlt className="text-[var(--sds-accent)]" />
              محصولات قرارداد ({productDetails.length})
            </summary>
            <div className="px-4 pb-4 overflow-x-auto">
              {productDetails.length === 0 ? (
                <p className="text-sm text-[var(--sds-text-muted)]">—</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-right text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] border-b border-[var(--sds-border-default)] dark:border-[var(--sds-border-subtle)]">
                      <th className="py-2">کد</th>
                      <th className="py-2">نام</th>
                      <th className="py-2">نوع</th>
                      <th className="py-2">ابعاد</th>
                      <th className="py-2">تعداد</th>
                      <th className="py-2">متراژ</th>
                      <th className="py-2">مبلغ کل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productDetails.map((p) => (
                      <tr key={p.id} className="border-b border-[var(--sds-border-subtle)] dark:border-[var(--sds-border-subtle)]/60">
                        <td className="py-2 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{p.code || '—'}</td>
                        <td className="py-2 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{p.name || '—'}</td>
                        <td className="py-2 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{p.stairPartType !== '—' ? `${p.productType} / ${p.stairPartType}` : p.productType}</td>
                        <td className="py-2 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{p.dimensions}</td>
                        <td className="py-2 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{p.quantity}</td>
                        <td className="py-2 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{p.squareMeters}</td>
                        <td className="py-2 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{formatPriceWithRial(p.totalPrice, financialSummary.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </ErpNeumorphicDisclosure>

          <ErpNeumorphicDisclosure>
            <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 font-semibold text-[var(--sds-text-primary)]">
              <FaTools className="text-[var(--sds-accent)]" />
              خدمات و عملیات وابسته ({serviceDetails.length})
            </summary>
            <div className="px-4 pb-4 overflow-x-auto">
              {serviceDetails.length === 0 ? (
                <p className="text-sm text-[var(--sds-text-muted)]">—</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-right text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] border-b border-[var(--sds-border-default)] dark:border-[var(--sds-border-subtle)]">
                      <th className="py-2">محصول</th>
                      <th className="py-2">دسته</th>
                      <th className="py-2">شرح</th>
                      <th className="py-2">مقدار</th>
                      <th className="py-2">نرخ</th>
                      <th className="py-2">هزینه</th>
                    </tr>
                  </thead>
                  <tbody>
                    {serviceDetails.map((s) => (
                      <tr key={s.id} className="border-b border-[var(--sds-border-subtle)] dark:border-[var(--sds-border-subtle)]/60">
                        <td className="py-2 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{s.productName}</td>
                        <td className="py-2 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{s.category}</td>
                        <td className="py-2 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{s.name}</td>
                        <td className="py-2 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{s.amountLabel}</td>
                        <td className="py-2 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{s.rateLabel || '—'}</td>
                        <td className="py-2 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{formatPriceWithRial(s.cost, financialSummary.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </ErpNeumorphicDisclosure>

          <ErpNeumorphicDisclosure open>
            <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 font-semibold text-[var(--sds-text-primary)]">
              <FaTools className="text-[var(--sds-accent)]" />
              خدمات مستقل ({standaloneServiceDetails.length})
            </summary>
            <div className="px-4 pb-4 overflow-x-auto">
              {standaloneServiceDetails.length === 0 ? (
                <p className="text-sm text-[var(--sds-text-muted)]">—</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-right text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] border-b border-[var(--sds-border-default)] dark:border-[var(--sds-border-subtle)]">
                      <th className="py-2">دسته</th>
                      <th className="py-2">شرح</th>
                      <th className="py-2">مقدار</th>
                      <th className="py-2">نرخ</th>
                      <th className="py-2">هزینه</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standaloneServiceDetails.map((s) => (
                      <tr key={s.id} className="border-b border-[var(--sds-border-subtle)] dark:border-[var(--sds-border-subtle)]/60">
                        <td className="py-2 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{s.category}</td>
                        <td className="py-2 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{s.name}</td>
                        <td className="py-2 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{s.amountLabel}</td>
                        <td className="py-2 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{s.rateLabel || '—'}</td>
                        <td className="py-2 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{formatPriceWithRial(s.cost, financialSummary.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </ErpNeumorphicDisclosure>

          <ErpNeumorphicDisclosure>
            <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 font-semibold text-[var(--sds-text-primary)]">
              <FaTruck className="text-[var(--sds-accent)]" />
              برنامه تحویل ({deliveryDetails.length})
            </summary>
            <div className="px-4 pb-4 space-y-3">
              {deliveryDetails.length === 0 ? (
                <p className="text-sm text-[var(--sds-text-muted)]">—</p>
              ) : deliveryDetails.map((delivery) => (
                <div key={delivery.id} className="rounded-lg border border-[var(--sds-border-default)] dark:border-[var(--sds-border-subtle)] p-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                    <p><span className="text-[var(--sds-text-muted)]">تاریخ:</span> {delivery.deliveryDate || '—'}</p>
                    <p><span className="text-[var(--sds-text-muted)]">آدرس:</span> {delivery.deliveryAddress || '—'}</p>
                    <p><span className="text-[var(--sds-text-muted)]">مدیر پروژه:</span> {delivery.projectManagerName || '—'}</p>
                    <p><span className="text-[var(--sds-text-muted)]">تحویل‌گیرنده:</span> {delivery.receiverName || '—'}</p>
                  </div>
                  <p className="text-sm mt-2"><span className="text-[var(--sds-text-muted)]">توضیحات:</span> {delivery.notes || '—'}</p>
                  <div className="mt-2 text-sm">
                    <p className="text-[var(--sds-text-muted)] mb-1">اقلام:</p>
                    <ul className="list-disc pr-5 space-y-1">
                      {delivery.products.length === 0 ? <li>—</li> : delivery.products.map((product, index) => (
                        <li key={`${delivery.id}-product-${index}`}>{product.productName} ({product.amountLabel || product.quantity})</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </ErpNeumorphicDisclosure>

          <ErpNeumorphicDisclosure>
            <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 font-semibold text-[var(--sds-text-primary)]">
              <FaMoneyCheckAlt className="text-[var(--sds-accent)]" />
              برنامه پرداخت ({paymentDetails.length})
            </summary>
            <div className="px-4 pb-4 overflow-x-auto">
              {paymentDetails.length === 0 ? (
                <p className="text-sm text-[var(--sds-text-muted)]">—</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-right text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] border-b border-[var(--sds-border-default)] dark:border-[var(--sds-border-subtle)]">
                      <th className="py-2">روش</th>
                      <th className="py-2">مبلغ</th>
                      <th className="py-2">تاریخ پرداخت</th>
                      <th className="py-2">تاریخ تحویل چک</th>
                      <th className="py-2">شماره چک</th>
                      <th className="py-2">صاحب چک</th>
                      <th className="py-2">وضعیت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentDetails.map((payment) => (
                      <tr key={payment.id} className="border-b border-[var(--sds-border-subtle)] dark:border-[var(--sds-border-subtle)]/60">
                        <td className="py-2 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{payment.methodLabel}</td>
                        <td className="py-2 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{formatPriceWithRial(payment.amount, financialSummary.currency)}</td>
                        <td className="py-2 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{payment.paymentDate || '—'}</td>
                        <td className="py-2 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{payment.handoverDate || '—'}</td>
                        <td className="py-2 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{payment.checkNumber || '—'}</td>
                        <td className="py-2 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{payment.checkOwnerName || '—'}</td>
                        <td className="py-2 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{payment.status || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </ErpNeumorphicDisclosure>
        </div>

        <ErpNeumorphicCard className="p-6">
          <h4 className="mb-4 font-semibold text-[var(--sds-text-primary)]">عملیات تایید قرارداد</h4>
          <div className="flex flex-wrap gap-3">
            <ErpPressable
              onClick={onSendForConfirmation}
              disabled={sendingCode}
              className="px-4 py-2 bg-[var(--sds-accent-soft)] hover:bg-[var(--sds-accent-soft)] text-[var(--sds-text-inverse)] rounded-lg disabled:opacity-50 flex items-center gap-2"
            >
              {sendingCode ? <FaSpinner className="animate-spin" /> : null}
              ارسال برای تایید
            </ErpPressable>
            <ErpPressable
              onClick={onResendConfirmation}
              disabled={sendingCode || !signature?.confirmationSent}
              className="px-4 py-2 bg-[var(--sds-info-surface)] hover:bg-[var(--sds-info-surface)] text-[var(--sds-text-inverse)] rounded-lg disabled:opacity-50"
            >
              ارسال مجدد کد
            </ErpPressable>
            <ErpPressable
              onClick={onRefreshStatus}
              disabled={sendingCode || !signature?.contractId}
              className="sds-action sds-action-solid px-4 py-2 disabled:opacity-50"
            >
              بروزرسانی وضعیت
            </ErpPressable>
            <ErpPressable
              onClick={onCancelContract}
              disabled={sendingCode || !signature?.contractId}
              className="px-4 py-2 bg-[var(--sds-danger-surface)] hover:bg-[var(--sds-danger-surface)] text-[var(--sds-text-inverse)] rounded-lg disabled:opacity-50"
            >
              لغو قرارداد
            </ErpPressable>
          </div>

          {signature?.contractId && (
            <div className="mt-4 pt-4 border-t border-[var(--sds-border-default)] dark:border-[var(--sds-border-subtle)]">
              <h5 className="mb-3 font-semibold text-[var(--sds-text-primary)]">نسخه نهایی قرارداد</h5>
              <div className="flex flex-wrap gap-3">
                <ErpPressable
                  onClick={onDownloadContractPdf}
                  disabled={pdfActionLoading || !canDownloadPdfAction}
                  className="px-4 py-2 bg-[var(--sds-success-surface)] hover:bg-[var(--sds-success-surface)] text-[var(--sds-text-inverse)] rounded-lg disabled:opacity-50 flex items-center gap-2"
                >
                  {pdfActionLoading ? <FaSpinner className="animate-spin" /> : <FaDownload />}
                  دانلود PDF قرارداد کامل
                </ErpPressable>
                <ErpPressable
                  onClick={onPrintContractPdf}
                  disabled={printActionLoading || !canPrintPdfAction}
                  className="px-4 py-2 bg-[var(--sds-purple-surface)] hover:bg-[var(--sds-purple-surface)] text-[var(--sds-text-inverse)] rounded-lg disabled:opacity-50 flex items-center gap-2"
                >
                  {printActionLoading ? <FaSpinner className="animate-spin" /> : <FaPrint />}
                  پرینت قرارداد
                </ErpPressable>
              </div>

              {!canPrintPdfAction && (
                <p className="text-xs text-[var(--sds-warning)] dark:text-[var(--sds-warning)] mt-3">
                  برای پرینت، قرارداد باید در وضعیت قابل چاپ باشد.
                </p>
              )}
            </div>
          )}

          {errors.signature && <p className="text-[var(--sds-danger)] text-sm mt-3">{errors.signature}</p>}
          {errors.verificationCode && <p className="text-[var(--sds-danger)] text-sm mt-3">{errors.verificationCode}</p>}
        </ErpNeumorphicCard>
      </div>
    </div>
  );
};
