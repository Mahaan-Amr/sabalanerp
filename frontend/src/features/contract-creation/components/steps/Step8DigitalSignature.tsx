// Step 8: Digital Signature Component
// SMS verification and digital signature

import React from 'react';
import { FaFileContract, FaUser, FaCreditCard, FaCheck, FaSpinner } from 'react-icons/fa';
import { formatPriceWithRial } from '@/lib/numberFormat';
import type { ContractWizardData } from '../../types/contract.types';

interface Step8DigitalSignatureProps {
  wizardData: ContractWizardData;
  updateWizardData: (updates: Partial<ContractWizardData>) => void;
  errors: Record<string, string>;
  sendingCode: boolean;
  verifyingCode: boolean;
  countdown: number;
  handleSendVerificationCode: () => void;
  handleVerifyCode: () => void;
  handlePhoneNumberChange: (phoneNumber: string) => void;
  handleVerificationCodeChange: (code: string) => void;
}

export const Step8DigitalSignature: React.FC<Step8DigitalSignatureProps> = ({
  wizardData,
  updateWizardData,
  errors,
  sendingCode,
  verifyingCode,
  countdown,
  handleSendVerificationCode,
  handleVerifyCode,
  handlePhoneNumberChange,
  handleVerificationCodeChange
}) => {
  const paymentSum = wizardData.payment.payments.reduce((sum, p) => sum + p.amount, 0);
  const remainingPaymentAmount = wizardData.payment.totalContractAmount - paymentSum;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">
          امضای دیجیتال
        </h3>
        <p className="text-gray-600 dark:text-gray-300">
          قرارداد را با کد تایید SMS امضا کنید
        </p>
      </div>

      {/* Contract Summary */}
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="bg-gradient-to-r from-teal-50 to-blue-50 dark:from-teal-900/20 dark:to-blue-900/20 border-2 border-teal-200 dark:border-teal-800 rounded-xl p-6 shadow-lg">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-2xl font-bold text-gray-800 dark:text-white">
              خلاصه قرارداد
            </h3>
            <FaFileContract className="text-3xl text-teal-600 dark:text-teal-400" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Contract Information */}
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
                </div>
              </div>

              {/* Customer Information */}
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
                  {wizardData.customer?.companyName && (
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">شرکت:</span>
                      <span className="font-medium text-gray-800 dark:text-white">{wizardData.customer.companyName}</span>
                    </div>
                  )}
                  {wizardData.customer?.phoneNumbers && wizardData.customer.phoneNumbers.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">تلفن:</span>
                      <span className="font-medium text-gray-800 dark:text-white">
                        {wizardData.customer.phoneNumbers[0].number}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Financial Summary */}
            <div className="space-y-4">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                  <FaCreditCard className="text-teal-600" />
                  خلاصه مالی
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">مبلغ کل قرارداد:</span>
                    <span className="font-bold text-lg text-teal-600 dark:text-teal-400">
                      {formatPriceWithRial(wizardData.payment.totalContractAmount, wizardData.payment.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">تعداد پرداخت‌ها:</span>
                    <span className="font-medium text-gray-800 dark:text-white">{wizardData.payment.payments.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">مجموع پرداخت‌ها:</span>
                    <span className="font-medium text-gray-800 dark:text-white">
                      {formatPriceWithRial(paymentSum, wizardData.payment.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
                    <span className="text-gray-600 dark:text-gray-400">مبلغ باقیمانده:</span>
                    <span className={`font-semibold ${
                      Math.abs(remainingPaymentAmount) < 0.01
                        ? 'text-green-600 dark:text-green-400'
                        : remainingPaymentAmount > 0
                          ? 'text-yellow-600 dark:text-yellow-400'
                          : 'text-red-600 dark:text-red-400'
                    }`}>
                      {formatPriceWithRial(remainingPaymentAmount, wizardData.payment.currency)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* SMS Verification */}
        {wizardData.signature && (
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
            <h4 className="font-semibold text-gray-800 dark:text-white mb-4">
              تایید شماره تلفن
            </h4>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  شماره تلفن
                </label>
                <input
                  type="tel"
                  value={wizardData.signature.phoneNumber || ''}
                  onChange={(e) => handlePhoneNumberChange(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                  placeholder="09123456789"
                  disabled={wizardData.signature.codeSent}
                />
                {errors.phoneNumber && (
                  <p className="text-red-500 text-sm mt-1">{errors.phoneNumber}</p>
                )}
              </div>

              {!wizardData.signature.codeSent ? (
                <button
                  onClick={handleSendVerificationCode}
                  disabled={sendingCode || !wizardData.signature.phoneNumber}
                  className="w-full px-4 py-2 bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white rounded-lg transition-all duration-200 font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sendingCode ? (
                    <>
                      <FaSpinner className="w-4 h-4 animate-spin" />
                      در حال ارسال...
                    </>
                  ) : (
                    'ارسال کد تایید'
                  )}
                </button>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      کد تایید
                    </label>
                    <input
                      type="text"
                      value={wizardData.signature.verificationCode}
                      onChange={(e) => handleVerificationCodeChange(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white text-center text-2xl tracking-widest"
                      placeholder="000000"
                      maxLength={6}
                      disabled={wizardData.signature.codeVerified}
                    />
                    {errors.verificationCode && (
                      <p className="text-red-500 text-sm mt-1">{errors.verificationCode}</p>
                    )}
                    {countdown > 0 && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 text-center">
                        ارسال مجدد کد در {countdown} ثانیه
                      </p>
                    )}
                  </div>

                  {!wizardData.signature.codeVerified ? (
                    <button
                      onClick={handleVerifyCode}
                      disabled={verifyingCode || wizardData.signature.verificationCode.length !== 6}
                      className="w-full px-4 py-2 bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white rounded-lg transition-all duration-200 font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {verifyingCode ? (
                        <>
                          <FaSpinner className="w-4 h-4 animate-spin" />
                          در حال تایید...
                        </>
                      ) : (
                        'تایید کد'
                      )}
                    </button>
                  ) : (
                    <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                      <p className="text-green-700 dark:text-green-300 text-sm flex items-center gap-2">
                        <FaCheck className="w-4 h-4" />
                        کد تایید با موفقیت تایید شد
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

