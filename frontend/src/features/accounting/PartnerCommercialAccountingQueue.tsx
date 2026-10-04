
'use client';
import { useCallback, useEffect, useState } from 'react';
import { partnerCommercialLabels, partnerInquiryLabels, type PartnerCommercialState, type RevisionRef } from '@sabalanerp/partner-sales-contracts';
import { ErpDisclosure, ErpFieldView, ErpButton, ErpCard, ErpInlineState, ErpLoading } from '@/components/erp';
import api from '@/lib/api';

type Row = { caseId: string; contractNumber: string; owner: RevisionRef; commercial: PartnerCommercialState; canRegister: boolean; canPaper: boolean };
export function PartnerCommercialAccountingQueue() {
  const [rows, setRows] = useState<Row[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setPending(true);
    try { const result = await api.get('/partner/accounting/commercial-candidates');
      if (!result.data.success) throw new Error(result.data.error);
      setRows(result.data.data); setError('');
    } catch (reason: any) { if (reason.response?.status !== 403) setError(reason.response?.data?.error || 'دریافت قراردادهای همکار انجام نشد.'); }
    finally { setPending(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const perform = async (row: Row, paper: boolean) => {
    setPending(true);
    try { const response = await api.post(paper ? `/partner/accounting/${encodeURIComponent(row.caseId)}/customer-paper-signature` : '/partner/accounting/enqueue', paper ? { revision: row.commercial.revision } : row.owner);
      if (!response.data.success) throw new Error(response.data.error);
      await load();
    } catch (reason: any) { setError(reason.response?.data?.error || reason.message || 'ثبت انجام نشد؛ صفحه را تازه‌سازی کنید.'); }
    finally { setPending(false); }
  };
  if (!rows.length && !error) return null;
  return <ErpDisclosure title="قراردادهای همکار پیش از ثبت مالی">
    {error && <ErpInlineState kind="error" title={error} />}
    {pending && <ErpLoading />}
    {rows.map(row => <ErpCard key={row.caseId}>
      <ErpFieldView label="قرارداد" value={row.contractNumber} />
      <ErpFieldView label="وضعیت" value={partnerCommercialLabels[row.commercial.status]} />
      <ErpFieldView label="استعلام" value={partnerInquiryLabels[row.commercial.inquiry]} />
      {row.canPaper && <ErpButton label="ثبت امضای کاغذی مشتری" disabled={pending} onClick={() => void perform(row, true)} />}
      {row.canRegister && <ErpButton label="ثبت پیش‌نویس مالی" disabled={pending} onClick={() => void perform(row, false)} />}
    </ErpCard>)}
  </ErpDisclosure>;
}
