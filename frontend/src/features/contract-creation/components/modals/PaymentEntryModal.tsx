// Payment Entry Modal — minimal, compact overlay for adding/editing a payment

import React from 'react';
import { dispatchCreditApi, type SellerCreditBalance } from '@/features/sales/dispatchCreditApi';
import { ErpInlineState } from '@/components/erp';
import type { PaymentEntry } from '../../types/contract.types';
import { CentralProductModalShell } from '../product-modal-system';
import { ContractPaymentInstallmentFields } from '../shared/ContractPaymentInstallmentFields';
import { ContractPaymentCheckFields } from '../shared/ContractPaymentCheckFields';
import { crmAPI } from '@/lib/api';
import { formatCustomerCreditRials } from '@/features/crm/customerCreditPresentation';
import type { CustomerCreditView } from '@/features/crm/CustomerCreditPanel';

interface PaymentEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  form: Partial<PaymentEntry>;
  onFormChange: (updates: Partial<PaymentEntry>) => void;
  onSave: () => void;
  currency: string;
  error?: string;
  fieldErrors?: Partial<Record<'method' | 'amount' | 'paymentDate' | 'checkNumber' | 'checkOwnerName' | 'handoverDate' | 'nationalCode', string>>;
  isEdit?: boolean;
  nationalCodeRequired?: boolean;
  showNationalCode?: boolean;
  nationalCodeConflict?: {
    existing: string;
    entered: string;
  } | null;
  onContinueNationalCodeConflict?: () => void;
  disabledAmount?: boolean;
  existingContract?: boolean;
  allowCustomerBalance?: boolean;
  dateFormat?: 'jalali' | 'gregorian';
  requireMethodSelection?: boolean;
  allowSellerCredit?: boolean;
  contractId?: string;
  allowSpecialCustomerCredit?: boolean;
  customerId?: string;
}

export const PaymentEntryModal: React.FC<PaymentEntryModalProps> = ({
  isOpen,
  onClose,
  form,
  onFormChange,
  onSave,
  currency: _currency,
  error,
  fieldErrors = {},
  isEdit,
  nationalCodeRequired = false,
  showNationalCode = nationalCodeRequired,
  nationalCodeConflict = null,
  onContinueNationalCodeConflict,
  disabledAmount = false,
  existingContract = false,
  allowCustomerBalance = false,
  dateFormat = 'jalali',
  requireMethodSelection = false,
  allowSellerCredit = false,
  contractId,
  allowSpecialCustomerCredit = false,
  customerId,
}) => {
  const [balance, setBalance] = React.useState<SellerCreditBalance | null>(null);
  const [creditError, setCreditError] = React.useState(false);
  const [customerCredit, setCustomerCredit] = React.useState<CustomerCreditView | null>(null);
  const [customerCreditError, setCustomerCreditError] = React.useState(false);
  React.useEffect(() => {
    setCustomerCredit(null);
    setCustomerCreditError(false);
    if (!isOpen || !customerId) return;
    let active = true;
    crmAPI.getCustomerCredit(customerId).then(response => { if (active) setCustomerCredit(response.data.data); })
      .catch(() => { if (active) setCustomerCreditError(true); });
    return () => { active = false; };
  }, [isOpen, customerId]);
  React.useEffect(() => {
    if (!isOpen || !allowSellerCredit) return;
    let active = true;
    setBalance(null); setCreditError(false);
    const projectId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('potentialProjectId') ?? undefined : undefined;
    dispatchCreditApi.balance(contractId, projectId).then(value => { if (active) setBalance(value); })
      .catch(() => { if (active) setCreditError(true); });
    return () => { active = false; };
  }, [isOpen, allowSellerCredit, contractId]);
  if (!isOpen) return null;

  const method = form.method ?? (requireMethodSelection ? undefined : 'CASH_CARD');
  const isCheck = method === 'CHECK';
  const isCustomerBalance = method === 'CUSTOMER_BALANCE';

  return (
    <CentralProductModalShell
      open
      title={isEdit ? 'ویرایش پرداخت' : 'افزودن پرداخت'}
      view="main"
      onClose={onClose}
      closeVariant="outline"
      primaryLabel={nationalCodeConflict ? 'ادامه بدون تغییر اطلاعات مشتری' : 'ذخیره'}
      pending={false}
      onPrimary={nationalCodeConflict && onContinueNationalCodeConflict
        ? onContinueNationalCodeConflict
        : onSave}
    >
        <div className="mx-auto w-full max-w-3xl px-0 py-0">
          <div className="space-y-3">
            <ContractPaymentInstallmentFields dateFormat={dateFormat} method={method} amount={String(form.amount ?? '')}
              allowSpecialCustomerCredit={customerCredit?.trustCategory === 'SPECIAL' || (existingContract && allowSpecialCustomerCredit && form.method === 'SPECIAL_CUSTOMER_CREDIT')}
              allowSellerCredit={allowSellerCredit && !!balance} sellerCreditLabel={balance ? `مانده: ${Number(balance.availableRials).toLocaleString('fa-IR')} ریال` : 'در حال دریافت مانده'}
              existingContract={existingContract} allowCustomerBalance={allowCustomerBalance}
              date={form.paymentDate ?? ''}
              amountLabel={isCustomerBalance ? 'مبلغ مانده مشتری (تومان)' : isCheck ? 'مبلغ چک (تومان)' : 'مبلغ (تومان)'}
              dateLabel={method === 'SELLER_CREDIT' || method === 'SPECIAL_CUSTOMER_CREDIT' ? 'تاریخ وعده پرداخت مشتری' : isCustomerBalance ? 'تاریخ استفاده از مانده' : isCheck ? 'تاریخ سررسید چک' : 'تاریخ پرداخت'}
              methodError={fieldErrors.method} amountError={fieldErrors.amount} dateError={fieldErrors.paymentDate}
              disabledAmount={disabledAmount}
              onMethodChange={value => onFormChange({ method: value })}
              onAmountChange={value => onFormChange({ amount: Number(value || 0) })}
              onDateChange={value => onFormChange({ paymentDate: value })} />

            {(isCheck || showNationalCode) && <ContractPaymentCheckFields dateFormat={dateFormat} showCheckFields={isCheck}
              nationalCodeRequired={nationalCodeRequired} showNationalCode={showNationalCode}
              value={{ number: form.checkNumber ?? '', ownerName: form.checkOwnerName ?? '',
                handoverDate: form.handoverDate ?? '', nationalCode: form.nationalCode ?? '' }}
              errors={{ number: fieldErrors.checkNumber, ownerName: fieldErrors.checkOwnerName,
                handoverDate: fieldErrors.handoverDate, nationalCode: fieldErrors.nationalCode }}
              onChange={updates => onFormChange({
                ...(updates.number !== undefined ? { checkNumber: updates.number } : {}),
                ...(updates.ownerName !== undefined ? { checkOwnerName: updates.ownerName } : {}),
                ...(updates.handoverDate !== undefined ? { handoverDate: updates.handoverDate } : {}),
                ...(updates.nationalCode !== undefined ? { nationalCode: updates.nationalCode } : {}),
              })} />}

            {error && <ErpInlineState kind="error" title={error} />}
            {method === 'SPECIAL_CUSTOMER_CREDIT' && customerCredit && <ErpInlineState kind="empty" title={`اعتبار آزاد مشتری: ${formatCustomerCreditRials(customerCredit.availableRials)}`} />}
            {customerCreditError && <ErpInlineState kind="error" title="وضعیت اعتبار مشتری دریافت نشد؛ فرم پرداخت را دوباره باز کنید." />}
            {creditError && <ErpInlineState kind="error" title="مانده اعتبار دریافت نشد؛ فرم پرداخت را دوباره باز کنید." />}

            {nationalCodeConflict && (
              <ErpInlineState kind="stale" title={
                <span className="space-y-1">
                  <span className="block">کد ملی واردشده با کد ملی ثبت‌شده مشتری متفاوت است.</span>
                  <span className="block font-normal">کد ثبت‌شده: {nationalCodeConflict.existing}</span>
                  <span className="block font-normal">کد واردشده: {nationalCodeConflict.entered}</span>
                  <span className="block font-normal">این مقدار فقط برای پرداخت ثبت می‌شود و اطلاعات مشتری تغییر نمی‌کند.</span>
                </span>
              } />
            )}
          </div>
        </div>
    </CentralProductModalShell>
  );
};
