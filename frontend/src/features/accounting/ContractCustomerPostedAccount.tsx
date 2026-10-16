'use client';
import { useEffect, useState } from 'react';
import { ErpButton, ErpInlineState, ErpSheet } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { accountingFailureMessage } from './accountingUi';
import type { CustomerAccount } from './customerAccountModel';
import CustomerPostedItems from './CustomerPostedItems';
import AccountingLedgerEvidence from './AccountingLedgerEvidence';

export default function ContractCustomerPostedAccount({ customerId, contractId, contractNumber, refreshToken }: {
  customerId: string; contractId: string; contractNumber: string; refreshToken: object;
}) {
  const [account, setAccount] = useState<CustomerAccount>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [evidence, setEvidence] = useState<unknown>();
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let current = true; setAccount(undefined); setError('');
    accountingAPI.getCustomerWorkspace(`customer:${customerId}`).then(response => { if (current) setAccount(response.data.data); })
      .catch(reason => { if (current) setError(accountingFailureMessage(reason, 'اقلام قطعی مرتبط بارگیری نشد.')); });
    return () => { current = false; };
  }, [customerId, contractId, refreshToken, retry]);
  async function openEvidence(id: string) {
    setPending(true); setError('');
    try { const response = await accountingAPI.getLedgerVoucherEvidence(id, 'بررسی سند دفتر مالی مرتبط با قرارداد'); setEvidence(response.data.data); }
    catch (reason) { setError(accountingFailureMessage(reason, 'سند مرتبط بارگیری نشد.')); }
    finally { setPending(false); }
  }
  return <div className="space-y-3">
    <ErpInlineState kind="empty" title="شاخص‌های بالای صفحه از رکوردهای عملیاتی قراردادند؛ افتتاحیه و تخصیص‌های دفتر مالی در بخش زیر نمایش داده می‌شوند و با آنها جمع نمی‌شوند." />
    {error && <ErpInlineState kind="error" title={error} action={{ label: 'تلاش دوباره', onClick: () => setRetry(value => value + 1) }} />}
    {account ? <CustomerPostedItems account={account} items={account.activityItems.filter(item => item.contractId === contractId)} title={`اقلام قطعی دفتر مالی قرارداد ${contractNumber}`} onEvidence={id => void openEvidence(id)} evidenceLoading={pending} /> : !error && <ErpInlineState kind="empty" title="در حال بارگیری اقلام قطعی قرارداد…" />}
    <ErpButton label="پرونده کامل مالی مشتری" href={`/dashboard/accounting/customer-accounts/${encodeURIComponent(`customer:${customerId}`)}`} tone="neutral" />
    <ErpSheet open={Boolean(evidence)} onClose={() => setEvidence(undefined)} title="سند مرتبط قرارداد" presentation="modal" size="wide">{Boolean(evidence) && <AccountingLedgerEvidence evidence={evidence} />}</ErpSheet>
  </div>;
}
