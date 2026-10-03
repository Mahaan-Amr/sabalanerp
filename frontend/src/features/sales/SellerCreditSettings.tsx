'use client';
import { useCallback, useEffect, useState } from 'react';
import { ErpButton, ErpField, ErpInlineState, ErpLoading, ErpRialInput, ErpSection } from '@/components/erp';
import { dispatchCreditApi, type SellerCreditBalance } from './dispatchCreditApi';
import { userFacingError } from '@/features/dispatch/userFacingError';
type Row = SellerCreditBalance & { id: string; firstName: string; lastName: string; username: string };
const money = (value: string) => BigInt(value).toLocaleString('fa-IR');
export default function SellerCreditSettings() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { const values = await dispatchCreditApi.sellers(); setRows(values); setLimits(Object.fromEntries(values.map(row => [row.id, row.limitRials]))); }
    catch (failure) { setError(userFacingError(failure, 'فهرست اعتبار فروشندگان دریافت نشد.')); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const save = async (row: Row) => {
    setPending(row.id); setError(null); setSaved(null);
    try { const balance = await dispatchCreditApi.limit(row.id, limits[row.id]);
      setRows(previous => previous?.map(item => item.id === row.id ? { ...item, ...balance } : item) ?? []);
      setSaved(row.id);
    } catch (failure) { setError(userFacingError(failure, 'سقف اعتبار ذخیره نشد.')); }
    finally { setPending(null); }
  };
  return <ErpSection title="اعتبار فروشندگان">
    {error && <ErpInlineState kind="error" title={error} action={{ label: 'تلاش دوباره', onClick: () => void load() }} />}
    {!rows && !error && <ErpLoading />}
    {rows && <div className="overflow-x-auto"><table className="w-full text-right text-sm">
      <caption className="sr-only">سقف و مانده اعتبار فروشندگان به ریال</caption>
      <thead><tr>{['فروشنده / حساب', 'سقف اعتبار (ریال)', 'مصرف‌شده', 'قابل‌مصرف', 'ثبت'].map(label => <th key={label} scope="col" className="p-3 sds-text-secondary">{label}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.id} className="border-t border-[var(--sds-border-default)]">
        <td className="p-3"><span className="block">{row.firstName} {row.lastName}</span><span className="sds-text-muted">{row.username}</span></td>
        <td className="p-3"><ErpField label={`سقف اعتبار ${row.firstName} ${row.lastName}`}><ErpRialInput value={limits[row.id] ?? ''} disabled={!!pending}
          onValueChange={value => { setLimits(previous => ({ ...previous, [row.id]: value })); setSaved(null); }} /></ErpField></td>
        <td className="p-3">{money(row.usedRials)}</td><td className="p-3">{money(row.availableRials)}
          {BigInt(row.balanceRials) < BigInt(0) && <span className="block sds-text-danger">کسری: {money(String(-BigInt(row.balanceRials)))}</span>}</td>
        <td className="p-3"><ErpButton label={saved === row.id ? 'ذخیره شد' : 'ذخیره اعتبار'} disabled={!!pending || !/^\d+$/.test(limits[row.id] ?? '')}
          onClick={() => void save(row)} /></td>
      </tr>)}</tbody>
    </table></div>}
    {rows?.length === 0 && <ErpInlineState kind="empty" title="فروشنده دارای دسترسی فعال یافت نشد." />}
  </ErpSection>;
}
