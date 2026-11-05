'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FaShoppingCart } from 'react-icons/fa';
import { ErpButton, ErpCard, ErpField, ErpInput, ErpInlineState, ErpLoading, ErpSearchableSelect, ErpSheet, ErpFieldView } from '@/components/erp';
import { purchasingAPI, purchaseError, type Option } from './api';
import { usePurchasingCommand } from './usePurchasingCommand';
import { purchaseDimensions } from './presentation';

type Entry = {source: {contractId: string; contractNumber: string; itemId: string;technical?: Record<string,unknown>; stone: string; unit: string}; remaining: string; documents: any[]; access: {buyer: boolean; seller: boolean; actorId: string}};
export function ContractPurchaseAction({contractId, rowId, enabled = true}: {contractId: string; rowId?: string; enabled?: boolean}) {
  const router = useRouter();
  const [open, setOpen] = useState(false), [entry, setEntry] = useState<Entry | null>(null), [buyers, setBuyers] = useState<Option[]>([]), [quantity, setQuantity] = useState(''), [ownerId, setOwnerId] = useState(''), [loading, setLoading] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('');
  async function load() {
    setLoading(true); setError('');
    try { const [r, b] = await Promise.all([purchasingAPI.contractEntry(contractId, rowId || ''), purchasingAPI.lookup('buyers')]); const data = r.data.data as Entry; setEntry(data); setBuyers(b.data.data); setQuantity(data.remaining); setOwnerId(data.access.buyer || data.access.seller ? data.access.actorId : b.data.data.length === 1 ? b.data.data[0].id : ''); }
    catch(e) { setError(purchaseError(e)); } finally {setLoading(false);}
  }
  const command = usePurchasingCommand(async r => {setSuccess(r.message);setOpen(false);router.push(`/dashboard/purchasing/inquiries?document=${encodeURIComponent(r.id)}`);});
  if (!enabled) return null;
  const inquiries = entry?.documents.filter(d => d.kind === 'INQUIRY') || [];
  const existing = entry?.documents.filter(d => d.kind === 'REQUEST' && d.status !== 'CANCELLED') || [];
  const locked = command.busy || command.uncertain;
  return <>
    <ErpButton label="درخواست خرید" aria-label="درخواست خرید این محصول" icon={FaShoppingCart} variant="outline" tone="primary" onClick={() => {setOpen(true); setSuccess(''); void load();}} />
    <ErpSheet open={open} onClose={() => setOpen(false)} title="درخواست خرید این محصول" presentation="modal" scope="workspace" pending={command.busy} dismissible={!locked} footer={<ErpButton label="بستن" variant="outline" disabled={locked} onClick={() => setOpen(false)} />}>
      <div className="space-y-4">
        {(error || command.error) && <ErpInlineState kind="error" title={error || command.error} />}
        {success && <ErpInlineState kind="success" title={success} />}
        {command.uncertain && <ErpInlineState kind="stale" title="نتیجه ثبت نامشخص است؛ ثبت تازه ایجاد نکنید." action={{label:'بررسی نتیجه ثبت', onClick:command.recover}} />}
        {command.uncertain && <ErpButton label="ارسال دوباره همین ثبت" onClick={command.retry} disabled={command.busy} />}
        {loading ? <ErpLoading /> : entry && <>
          <ErpFieldView label={`قرارداد ${entry.source.contractNumber}`} value={entry.source.stone} />
          {purchaseDimensions(entry.source.technical) && <ErpFieldView label="ابعاد موردنیاز" value={purchaseDimensions(entry.source.technical)} />}
          <ErpField label={`مقدار موردنیاز (${entry.source.unit})`} required><ErpInput value={quantity} inputMode="decimal" disabled={locked} onChange={e => setQuantity(e.target.value)} /></ErpField>
          {existing.length > 0 && <ErpCard className="space-y-2 p-3"><strong>درخواست‌های ثبت‌شده برای همین ردیف</strong>{existing.map(d => <div key={d.id} className="flex flex-wrap items-center justify-between gap-2"><p>{d.number} · {d.data.quantity} {d.data.unit}</p><ErpButton label="پیگیری درخواست" variant="ghost" disabled={locked} onClick={()=>router.push(`/dashboard/purchasing?document=${encodeURIComponent(d.id)}`)} /></div>)}</ErpCard>}
          {inquiries.map(d => <ErpCard key={d.id} className="space-y-3 p-3"><p>{d.number} · {d.data.offers?.length || 0} پیشنهاد · {d.data.selection?.length ? 'دارای پیشنهاد منتخب' : 'در انتظار انتخاب مسئول خرید'}</p><div className="flex flex-wrap gap-2">
            <ErpButton label="پیگیری استعلام" variant="outline" disabled={locked} onClick={() => router.push(`/dashboard/purchasing/inquiries?document=${encodeURIComponent(d.id)}`)} />
          </div></ErpCard>)}
          {entry.remaining !== '0' && <><ErpField label="مسئول پیگیری خرید" required><ErpSearchableSelect aria-label="مسئول پیگیری خرید" value={ownerId} disabled={locked} onChange={e => setOwnerId(e.target.value)}><option value="">انتخاب کنید</option>{buyers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</ErpSearchableSelect></ErpField>
          <ErpButton label={inquiries.length ? 'ثبت استعلام تازه برای این ردیف' : 'ثبت استعلام برای این ردیف'} disabled={locked || !ownerId || !quantity} onClick={() => command.run('INQUIRY_CREATE', {contractId, rowId, quantity, ownerId})} />
          {!inquiries.length && <ErpInlineState kind="permission" title="ادامه کار در استعلام خرید همین ردیف انجام می‌شود." />}</>}
        </>}
      </div>
    </ErpSheet>
  </>;
}
