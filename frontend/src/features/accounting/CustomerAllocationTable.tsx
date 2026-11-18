'use client';
import { Fragment, useRef } from 'react';
import { ErpBadge, ErpButton, ErpCard, ErpCheckboxControl, ErpField, ErpInput } from '@/components/erp';
import { dateFa } from './accountingUi';
import { tomanNumber, tomanRials, visibleAllocationGroups, ZERO, type AllocationDraft, type AllocationGroup, type customerAllocationPlan } from './customerAllocationPlan';
import styles from './customerAllocation.module.css';

export default function CustomerAllocationTable({ groups, draft, plan, search, onSearch, onChange, disabled, footer }: {
  groups: AllocationGroup[]; draft: AllocationDraft; plan: ReturnType<typeof customerAllocationPlan>; search: string;
  onSearch: (value: string) => void; onChange: (draft: AllocationDraft) => void; disabled: boolean; footer: React.ReactNode;
}) {
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const visible = visibleAllocationGroups(groups, search);
  const toggle = (id: string, checked: boolean) => onChange({ ...draft, selected: checked ? Array.from(new Set([...draft.selected, id])) : draft.selected.filter(row => row !== id) });
  const hiddenSelected = draft.selected.filter(id => !visible.some(group => group.debts.some(debt => debt.item.id === id))).length;
  return <ErpCard>
    <div className={styles.toolbar}><ErpField label="جستجوی قرارداد یا مدرک"><ErpInput type="search" value={search} onChange={event => onSearch(event.target.value)} placeholder="شماره یا عنوان" /></ErpField>
      <div className="flex flex-wrap gap-2"><ErpButton label="انتخاب همه بدهی‌ها" tone="neutral" disabled={disabled} onClick={() => onChange({ ...draft, selected: Array.from(new Set([...draft.selected, ...visible.flatMap(group => group.debts.map(debt => debt.item.id))])) })} />
        <ErpButton label="پاک‌کردن انتخاب" variant="ghost" disabled={disabled} onClick={() => onChange({ ...draft, selected: [], amounts: {} })} /></div>
      {hiddenSelected > 0 && <p className={styles.hint}>{hiddenSelected.toLocaleString('fa-IR')} بدهی منتخب خارج از نتیجه جستجو نیز در جمع تخصیص منظور می‌شود.</p>}
    </div>
    <div className={styles.tableWrap}><table className={styles.table}>
      <caption className="sr-only">بدهی‌های قطعی گروه‌بندی‌شده بر اساس قرارداد؛ مبالغ به تومان</caption>
      <thead><tr>{['انتخاب', 'بدهی / مدرک', 'سررسید', 'اصل بدهی', 'تخصیص قبلی', 'مانده', 'تخصیص این‌بار', 'مانده بعد', 'عملیات'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{visible.map(group => <Fragment key={group.id}>
        <tr className={styles.group}><th colSpan={9} scope="rowgroup">{group.label}</th></tr>
        {!group.debts.length && <tr><td colSpan={9}><span className="sds-text-muted">بدهی قطعی قابل تخصیص ندارد</span></td></tr>}
        {group.debts.map(debt => {
          const selected = draft.selected.includes(debt.item.id);
          const amount = selected ? tomanRials(draft.amounts[debt.item.id] || '') : ZERO;
          const after = debt.remaining - (amount ?? ZERO);
          const error = plan.debtErrors[debt.item.id];
          const errorId = `allocation-debt-${debt.item.id}`;
          return <tr key={debt.item.id} className={selected ? styles.selected : undefined}>
            <td><label className="inline-flex min-h-11 min-w-11 items-center justify-center"><ErpCheckboxControl aria-label={`انتخاب ${debt.label}`} checked={selected} disabled={disabled} onChange={event => toggle(debt.item.id, event.target.checked)} /></label></td>
            <td><strong>{debt.label}</strong></td>
            <td data-label="سررسید:">{dateFa(debt.item.dueAt)} {debt.item.agingDays > 0 && <ErpBadge tone="warning">معوق</ErpBadge>}</td>
            <td data-label="اصل بدهی:" className={styles.money}>{tomanNumber(debt.original)}</td>
            <td data-label="تخصیص قبلی:" className={styles.money}>{tomanNumber(debt.original - debt.remaining)}</td>
            <td data-label="مانده:" className={styles.money}>{tomanNumber(debt.remaining)}</td>
            <td className={styles.amount}><ErpInput ref={element => { inputs.current[debt.item.id] = element; }} numberFormat="money" aria-label={`تخصیص ${debt.label}`} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}
              disabled={disabled || !selected} value={draft.amounts[debt.item.id] || ''} placeholder="تومان" onChange={event => onChange({ ...draft, amounts: { ...draft.amounts, [debt.item.id]: event.target.value } })} />
              {error && <p id={errorId} className={styles.error}>{error}</p>}</td>
            <td data-label="مانده بعد:" className={styles.money}>{amount === null ? 'مبلغ نامعتبر' : after < ZERO ? 'بیش از مانده' : tomanNumber(after)}</td>
            <td><ErpButton label="تخصیص" variant="ghost" disabled={disabled} onClick={() => { if (!selected) toggle(debt.item.id, true); requestAnimationFrame(() => inputs.current[debt.item.id]?.focus()); }} /></td>
          </tr>;
        })}
      </Fragment>)}{!visible.length && <tr><td colSpan={9}>موردی پیدا نشد</td></tr>}</tbody>
    </table></div>
    {footer}
  </ErpCard>;
}
