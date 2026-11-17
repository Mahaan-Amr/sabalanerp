import { accountStatusLabels, normalizeAccountAmount, receiptIsCheck, receiptRemainingRials, type AccountItem, type CustomerAccount } from './customerAccountModel';
import { dateFa } from './accountingUi';

export const ZERO = BigInt(0);
const TEN = BigInt(10);
export function tomanRials(text: string): bigint | null {
  const value = normalizeAccountAmount(text).replace(/٫/g, '.');
  if (!value) return ZERO;
  if (!/^\d+(?:\.\d)?$/.test(value)) return null;
  const [whole, fraction = '0'] = value.split('.');
  return BigInt(whole) * TEN + BigInt(fraction);
}
export function tomanInput(rials: bigint) {
  return `${rials / TEN}${rials % TEN ? `.${rials % TEN}` : ''}`;
}
export function tomanNumber(rials: bigint): string {
  if (rials < ZERO) return `−${tomanNumber(-rials)}`;
  return `${(rials / TEN).toLocaleString('fa-IR')}${rials % TEN ? `٫${(rials % TEN).toLocaleString('fa-IR')}` : ''}`;
}
export const tomanMoney = (rials: bigint) => `${tomanNumber(rials)} تومان`;
export const allocationSearch = (value: string) => normalizeAccountAmount(value).trim().toLocaleLowerCase('fa-IR');

export type AllocationDebt = { item: AccountItem; groupId: string; label: string; remaining: bigint; original: bigint };
export type AllocationGroup = { id: string; label: string; debts: AllocationDebt[] };
export type AllocationSource = { key: string; receiptId?: string; creditItemId?: string; label: string; note: string; remaining: bigint; unavailable?: string };
export type AllocationDraft = { selected: string[]; enabled: string[]; amounts: Record<string, string>; budgets: Record<string, string> };
export const emptyAllocationDraft = (): AllocationDraft => ({ selected: [], enabled: [], amounts: {}, budgets: {} });

export function customerAllocationData(account: CustomerAccount) {
  const groups: AllocationGroup[] = account.contracts.map(row => ({ id: row.id, label: `قرارداد ${row.contractNumber} · ${row.titlePersian}`, debts: [] }));
  const debts: AllocationDebt[] = [];
  for (const item of account.openItems) {
    if (item.kind !== 'RECEIVABLE' || BigInt(item.remainingRials) <= ZERO) continue;
    const debt = { item, groupId: item.contractId || 'standalone', label: item.invoiceNumber || item.description || 'قلم قطعی', remaining: BigInt(item.remainingRials), original: BigInt(item.originalRials) };
    debts.push(debt);
    let group = groups.find(row => row.id === debt.groupId);
    if (!group) {
      group = { id: debt.groupId, label: item.contractId ? 'قرارداد تاریخی' : 'بدهی‌های مستقل و افتتاحیه', debts: [] };
      groups.push(group);
    }
    group.debts.push(debt);
  }
  const sources: AllocationSource[] = account.receipts.filter(row => BigInt(receiptRemainingRials(row)) > ZERO).map(row => {
    const isCheck = receiptIsCheck(row);
    const check = account.treasuryChecks.find(check => check.id === (row.checkInstrumentId || row.source?.id));
    const unavailable = isCheck && !row.checkInstrumentId ? 'ابزار دریافت قدیمی باید تطبیق داده شود.'
      : isCheck && (!check || ['BOUNCED', 'RETURNED', 'CANCELLED', 'REPLACED'].includes(check.status)) ? 'اعتبار این چک برای تخصیص معتبر نیست.' : undefined;
    return { key: `receipt:${row.id}`, receiptId: row.id, remaining: BigInt(receiptRemainingRials(row)), unavailable,
      label: `${accountStatusLabels[row.componentKind || (isCheck ? 'CHECK' : 'BANK')] || 'دریافت'}${check ? ` ${check.serialNumber}` : ''} · ${dateFa(row.occurredAt)}`,
      note: check ? `${check.bankName} · ${accountStatusLabels[check.status] || 'وضعیت نیازمند بررسی'} · سررسید ${dateFa(check.dueAt)}` : 'مانده دریافت ثبت‌شده' };
  });
  sources.push(...account.openItems.filter(row => row.kind === 'CREDIT' && BigInt(row.remainingRials) > ZERO).map(row => ({ key: `credit:${row.id}`, creditItemId: row.id, remaining: BigInt(row.remainingRials), label: `بستانکاری · ${row.invoiceNumber}`, note: 'اعتبار مستقل؛ بدون دریافت نقدی' })));
  const labels = new Map<string, number>();
  for (const source of sources) labels.set(source.label, (labels.get(source.label) || 0) + 1);
  for (const source of sources) if ((labels.get(source.label) || 0) > 1) source.label += ` · مرجع ${source.receiptId || source.creditItemId}`;
  return { groups, debts, sources };
}

export function visibleAllocationGroups(groups: AllocationGroup[], search: string): AllocationGroup[] {
  const query = allocationSearch(search);
  if (!query) return groups;
  return groups.flatMap(group => {
    if (allocationSearch(group.label).includes(query)) return [group];
    const debts = group.debts.filter(debt => allocationSearch(debt.label).includes(query));
    return debts.length ? [{ ...group, debts }] : [];
  });
}

/** A draft is only a proposal. The existing atomic settlement command owns all financial checks. */
export function customerAllocationPlan(data: ReturnType<typeof customerAllocationData>, draft: AllocationDraft) {
  const debtErrors: Record<string, string> = {};
  const sourceErrors: Record<string, string> = {};
  const selectedDebts = data.debts.filter(row => draft.selected.includes(row.item.id));
  const enabledSources = data.sources.filter(row => draft.enabled.includes(row.key));
  if (draft.selected.some(id => !data.debts.some(row => row.item.id === id))) debtErrors.missing = 'بعضی بدهی‌های انتخاب‌شده دیگر مانده باز ندارند؛ انتخاب‌ها را بررسی کنید.';
  if (draft.enabled.some(key => !data.sources.some(row => row.key === key))) sourceErrors.missing = 'بعضی منابع انتخاب‌شده دیگر مانده آزاد ندارند؛ منابع را بررسی کنید.';
  let total = ZERO;
  for (const debt of selectedDebts) {
    const amount = tomanRials(draft.amounts[debt.item.id] || '');
    if (amount === null) debtErrors[debt.item.id] = 'مبلغ تومان باید نامنفی و حداکثر یک رقم اعشار داشته باشد.';
    else if (amount > debt.remaining) debtErrors[debt.item.id] = 'مبلغ از مانده بدهی بیشتر است.';
    if (amount !== null) total += amount;
  }
  let capacity = ZERO;
  const remainingBySource = new Map<string, bigint>();
  for (const source of enabledSources) {
    const amount = tomanRials(draft.budgets[source.key] ?? tomanInput(source.remaining));
    if (source.unavailable) sourceErrors[source.key] = source.unavailable;
    else if (amount === null) sourceErrors[source.key] = 'سقف مصرف باید نامنفی و حداکثر یک رقم اعشار داشته باشد.';
    else if (amount > source.remaining) sourceErrors[source.key] = 'سقف مصرف از مانده منبع بیشتر است.';
    const usable = sourceErrors[source.key] ? ZERO : amount ?? ZERO;
    capacity += usable;
    remainingBySource.set(source.key, usable);
  }
  const shares: Array<{ sourceKey: string; debtId: string; amountRials: bigint }> = [];
  for (const debt of selectedDebts) {
    let needed = debtErrors[debt.item.id] ? ZERO : tomanRials(draft.amounts[debt.item.id] || '') ?? ZERO;
    for (const source of enabledSources) {
      const free = remainingBySource.get(source.key) || ZERO;
      const share = needed < free ? needed : free;
      if (share > ZERO) shares.push({ sourceKey: source.key, debtId: debt.item.id, amountRials: share });
      remainingBySource.set(source.key, free - share);
      needed -= share;
    }
  }
  const error = Object.values(debtErrors)[0] || Object.values(sourceErrors)[0] || (total > capacity ? 'جمع تخصیص از سقف منابع منتخب بیشتر است.' : undefined);
  const sourceAllocations = enabledSources.flatMap(source => {
    const allocations = shares.filter(row => row.sourceKey === source.key).map(row => ({ openItemId: row.debtId, amountRials: row.amountRials.toString() }));
    return allocations.length ? [{ receiptId: source.receiptId, creditItemId: source.creditItemId, allocations }] : [];
  });
  return { total, capacity, selectedDebts, enabledSources, debtErrors, sourceErrors, shares, sourceAllocations, error, valid: total > ZERO && !error };
}

export function fillCustomerAllocation(data: ReturnType<typeof customerAllocationData>, draft: AllocationDraft): AllocationDraft {
  const plan = customerAllocationPlan(data, draft);
  if (Object.keys(plan.sourceErrors).length) return draft;
  let remaining = plan.capacity;
  const amounts = { ...draft.amounts };
  for (const debt of plan.selectedDebts) {
    const amount = debt.remaining < remaining ? debt.remaining : remaining;
    amounts[debt.item.id] = tomanInput(amount);
    remaining -= amount;
  }
  return { ...draft, amounts };
}
