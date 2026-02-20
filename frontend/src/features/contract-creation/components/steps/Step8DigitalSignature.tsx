import React from 'react';
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
  deliveryDetails: ContractStep8DeliveryDetail[];
  paymentDetails: ContractStep8PaymentDetail[];
  financialSummary: ContractStep8FinancialSummary;
}

const renderStatusBadge = (
  status: ContractWizardData['signature'] extends infer T
    ? T extends { confirmationStatus: infer S }
      ? S
      : never
    : never
) => {
  if (status === 'VERIFIED') {
    return (
      <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
        <FaCheckCircle /> تایید شده
      </span>
    );
  }

  if (status === 'PENDING') {
    return (
      <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300">
        <FaClock /> در انتظار تایید
      </span>
    );
  }

  if (status === 'CANCELLED') {
    return (
      <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
        <FaTimesCircle /> لغو شده
      </span>
    );
  }

  if (status === 'EXPIRED') {
    return (
      <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
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
  deliveryDetails,
  paymentDetails,
  financialSummary
}) => {
  const signature = wizardData.signature;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">تایید دیجیتال قرارداد</h3>
        <p className="text-gray-600 dark:text-gray-300">
          وضعیت تایید مشتری را بررسی کنید و در صورت نهایی شدن، فایل کامل قرارداد را دانلود یا پرینت کنید.
        </p>
      </div>

      <div className="max-w-6xl mx-auto space-y-6">
        <div className="bg-gradient-to-r from-teal-50 to-blue-50 dark:from-teal-900/20 dark:to-blue-900/20 border-2 border-teal-200 dark:border-teal-800 rounded-xl p-6 shadow-lg">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-2xl font-bold text-gray-800 dark:text-white">خلاصه قرارداد</h3>
            <FaFileContract className="text-3xl text-teal-600 dark:text-teal-400" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                  <FaFileContract className="text-teal-600" />
                  اطلاعات قرارداد
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">شماره قرارداد:</span>
                    <span className="font-medium text-gray-800 dark:text-white">{wizardData.contractNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">تاریخ قرارداد:</span>
                    <span className="font-medium text-gray-800 dark:text-white">{wizardData.contractDate}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">وضعیت:</span>
                    <span className="font-medium text-gray-800 dark:text-white">
                      {signature?.contractStatus || '—'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                  <FaUser className="text-teal-600" />
                  اطلاعات مشتری
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">نام:</span>
                    <span className="font-medium text-gray-800 dark:text-white">
                      {wizardData.customer?.firstName} {wizardData.customer?.lastName}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">شماره تماس:</span>
                    <span className="font-medium text-gray-800 dark:text-white">
                      {signature?.phoneNumber || wizardData.customer?.homeNumber || wizardData.customer?.workNumber || 'ثبت نشده'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                  <FaCreditCard className="text-teal-600" />
                  جمع‌بندی مالی
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">جمع محصولات:</span>
                    <span className="font-medium text-gray-800 dark:text-white">
                      {formatPriceWithRial(financialSummary.productsTotal, financialSummary.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">جمع خدمات:</span>
                    <span className="font-medium text-gray-800 dark:text-white">
                      {formatPriceWithRial(financialSummary.servicesTotal, financialSummary.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">جمع پرداختی:</span>
                    <span className="font-medium text-gray-800 dark:text-white">
                      {formatPriceWithRial(financialSummary.paymentTotal, financialSummary.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
                    <span className="text-gray-600 dark:text-gray-400">مبلغ نهایی قرارداد:</span>
                    <span className="font-semibold text-teal-600 dark:text-teal-400">
                      {formatPriceWithRial(financialSummary.grandTotal, financialSummary.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">مانده پرداخت:</span>
                    <span className="font-semibold text-yellow-600 dark:text-yellow-400">
                      {formatPriceWithRial(financialSummary.remainingAmount, financialSummary.currency)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-gray-700 dark:text-gray-300">وضعیت تایید مشتری</h4>
                  {renderStatusBadge(signature?.confirmationStatus ?? null)}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-300 space-y-1">
                  <p>تعداد تلاش: {signature?.attemptsUsed ?? 0} / {signature?.maxAttempts ?? 5}</p>
                  <p>تعداد ارسال مجدد: {signature?.resendCount ?? 0}</p>
                  {signature?.lastSentAt && <p>آخرین ارسال: {new Date(signature.lastSentAt).toLocaleString('fa-IR')}</p>}
                  {signature?.lastOpenedAt && <p>آخرین بازدید مشتری: {new Date(signature.lastOpenedAt).toLocaleString('fa-IR')}</p>}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <details open className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <summary className="px-4 py-3 cursor-pointer font-semibold text-gray-800 dark:text-white flex items-center gap-2">
              <FaListAlt className="text-teal-500" />
              محصولات قرارداد ({productDetails.length})
            </summary>
            <div className="px-4 pb-4 overflow-x-auto">
              {productDetails.length === 0 ? (
                <p className="text-sm text-gray-500">—</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-right text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
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
                      <tr key={p.id} className="border-b border-gray-100 dark:border-gray-700/60">
                        <td className="py-2 text-gray-700 dark:text-gray-300">{p.code || '—'}</td>
                        <td className="py-2 text-gray-700 dark:text-gray-300">{p.name || '—'}</td>
                        <td className="py-2 text-gray-700 dark:text-gray-300">{p.stairPartType !== '—' ? `${p.productType} / ${p.stairPartType}` : p.productType}</td>
                        <td className="py-2 text-gray-700 dark:text-gray-300">{p.dimensions}</td>
                        <td className="py-2 text-gray-700 dark:text-gray-300">{p.quantity}</td>
                        <td className="py-2 text-gray-700 dark:text-gray-300">{p.squareMeters}</td>
                        <td className="py-2 text-gray-700 dark:text-gray-300">{formatPriceWithRial(p.totalPrice, financialSummary.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </details>

          <details className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <summary className="px-4 py-3 cursor-pointer font-semibold text-gray-800 dark:text-white flex items-center gap-2">
              <FaTools className="text-teal-500" />
              خدمات و عملیات وابسته ({serviceDetails.length})
            </summary>
            <div className="px-4 pb-4 overflow-x-auto">
              {serviceDetails.length === 0 ? (
                <p className="text-sm text-gray-500">—</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-right text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
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
                      <tr key={s.id} className="border-b border-gray-100 dark:border-gray-700/60">
                        <td className="py-2 text-gray-700 dark:text-gray-300">{s.productName}</td>
                        <td className="py-2 text-gray-700 dark:text-gray-300">{s.category}</td>
                        <td className="py-2 text-gray-700 dark:text-gray-300">{s.name}</td>
                        <td className="py-2 text-gray-700 dark:text-gray-300">{s.amountLabel}</td>
                        <td className="py-2 text-gray-700 dark:text-gray-300">{s.rateLabel || '—'}</td>
                        <td className="py-2 text-gray-700 dark:text-gray-300">{formatPriceWithRial(s.cost, financialSummary.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </details>

          <details className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <summary className="px-4 py-3 cursor-pointer font-semibold text-gray-800 dark:text-white flex items-center gap-2">
              <FaTruck className="text-teal-500" />
              برنامه تحویل ({deliveryDetails.length})
            </summary>
            <div className="px-4 pb-4 space-y-3">
              {deliveryDetails.length === 0 ? (
                <p className="text-sm text-gray-500">—</p>
              ) : deliveryDetails.map((delivery) => (
                <div key={delivery.id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                    <p><span className="text-gray-500">تاریخ:</span> {delivery.deliveryDate || '—'}</p>
                    <p><span className="text-gray-500">آدرس:</span> {delivery.deliveryAddress || '—'}</p>
                    <p><span className="text-gray-500">مدیر پروژه:</span> {delivery.projectManagerName || '—'}</p>
                    <p><span className="text-gray-500">تحویل‌گیرنده:</span> {delivery.receiverName || '—'}</p>
                  </div>
                  <p className="text-sm mt-2"><span className="text-gray-500">توضیحات:</span> {delivery.notes || '—'}</p>
                  <div className="mt-2 text-sm">
                    <p className="text-gray-500 mb-1">اقلام:</p>
                    <ul className="list-disc pr-5 space-y-1">
                      {delivery.products.length === 0 ? <li>—</li> : delivery.products.map((product, index) => (
                        <li key={`${delivery.id}-product-${index}`}>{product.productName} ({product.quantity})</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </details>

          <details className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <summary className="px-4 py-3 cursor-pointer font-semibold text-gray-800 dark:text-white flex items-center gap-2">
              <FaMoneyCheckAlt className="text-teal-500" />
              برنامه پرداخت ({paymentDetails.length})
            </summary>
            <div className="px-4 pb-4 overflow-x-auto">
              {paymentDetails.length === 0 ? (
                <p className="text-sm text-gray-500">—</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-right text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
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
                      <tr key={payment.id} className="border-b border-gray-100 dark:border-gray-700/60">
                        <td className="py-2 text-gray-700 dark:text-gray-300">{payment.methodLabel}</td>
                        <td className="py-2 text-gray-700 dark:text-gray-300">{formatPriceWithRial(payment.amount, financialSummary.currency)}</td>
                        <td className="py-2 text-gray-700 dark:text-gray-300">{payment.paymentDate || '—'}</td>
                        <td className="py-2 text-gray-700 dark:text-gray-300">{payment.handoverDate || '—'}</td>
                        <td className="py-2 text-gray-700 dark:text-gray-300">{payment.checkNumber || '—'}</td>
                        <td className="py-2 text-gray-700 dark:text-gray-300">{payment.checkOwnerName || '—'}</td>
                        <td className="py-2 text-gray-700 dark:text-gray-300">{payment.status || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </details>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
          <h4 className="font-semibold text-gray-800 dark:text-white mb-4">عملیات تایید قرارداد</h4>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={onSendForConfirmation}
              disabled={sendingCode}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg disabled:opacity-50 flex items-center gap-2"
            >
              {sendingCode ? <FaSpinner className="animate-spin" /> : null}
              ارسال برای تایید
            </button>
            <button
              onClick={onResendConfirmation}
              disabled={sendingCode || !signature?.confirmationSent}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
            >
              ارسال مجدد کد
            </button>
            <button
              onClick={onRefreshStatus}
              disabled={sendingCode || !signature?.contractId}
              className="px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-lg disabled:opacity-50"
            >
              بروزرسانی وضعیت
            </button>
            <button
              onClick={onCancelContract}
              disabled={sendingCode || !signature?.contractId}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50"
            >
              لغو قرارداد
            </button>
          </div>

          {signature?.contractId && (
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <h5 className="font-semibold text-gray-800 dark:text-white mb-3">نسخه نهایی قرارداد</h5>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={onDownloadContractPdf}
                  disabled={pdfActionLoading || !canDownloadPdfAction}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50 flex items-center gap-2"
                >
                  {pdfActionLoading ? <FaSpinner className="animate-spin" /> : <FaDownload />}
                  دانلود PDF قرارداد کامل
                </button>
                <button
                  onClick={onPrintContractPdf}
                  disabled={printActionLoading || !canPrintPdfAction}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg disabled:opacity-50 flex items-center gap-2"
                >
                  {printActionLoading ? <FaSpinner className="animate-spin" /> : <FaPrint />}
                  پرینت قرارداد
                </button>
              </div>

              {!canPrintPdfAction && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-3">
                  برای پرینت، قرارداد باید در وضعیت قابل چاپ باشد.
                </p>
              )}
            </div>
          )}

          {errors.signature && <p className="text-red-500 text-sm mt-3">{errors.signature}</p>}
          {errors.verificationCode && <p className="text-red-500 text-sm mt-3">{errors.verificationCode}</p>}
        </div>
      </div>
    </div>
  );
};
