export type AccountingWorkAttention = {
  priority: number;
  reason: string;
  evidence: string;
  owner: string;
  waitingSince: Date;
  nextAction: string;
};

type WorkSignal = {
  createdAt: Date;
  assignedToUserId?: string | null;
  title?: string | null;
};

export function resolveAccountingWorkAttention(input: {
  eligible: boolean;
  invoiceStatus: string;
  receivableStatus: string;
  taxStatus: string;
  hasReceivable: boolean;
  missingTaxFields: string[];
  openCorrections: WorkSignal[];
  openBlockerFlags: WorkSignal[];
  openInvoiceCandidates: WorkSignal[];
  overdueReceivables: Array<{ dueDate: Date }>;
  assignedUsers: Record<string, string>;
  signedAt?: Date | null;
  createdAt: Date;
}): AccountingWorkAttention | null {
  const owner = (signal: WorkSignal) => signal.assignedToUserId
    ? input.assignedUsers[signal.assignedToUserId] || 'مسئول تعیین‌شده'
    : 'تعیین نشده';
  const oldest = <T,>(items: T[], date: (item: T) => Date) => items.reduce<T | undefined>(
    (first, item) => !first || date(item).getTime() < date(first).getTime() ? item : first, undefined);
  const firstFlag = oldest(input.openBlockerFlags, item => item.createdAt);
  const candidateCorrection = oldest(input.openCorrections, item => item.createdAt);
  const firstCorrection = candidateCorrection && (!firstFlag || candidateCorrection.createdAt <= firstFlag.createdAt)
    ? candidateCorrection : undefined;
  if (firstCorrection) return {
    priority: 1,
    reason: 'درخواست اصلاح باز', evidence: 'شرح و مدارک اصلاح در پرونده قرارداد قرار دارد.',
    owner: owner(firstCorrection), waitingSince: firstCorrection.createdAt, nextAction: 'بررسی اصلاح',
  };
  if (firstFlag) return {
    priority: 1,
    reason: 'مغایرت مسدودکننده', evidence: firstFlag.title || 'جزئیات مغایرت در پرونده قرارداد قرار دارد.',
    owner: owner(firstFlag), waitingSince: firstFlag.createdAt, nextAction: 'بررسی مغایرت',
  };
  const firstCandidate = oldest(input.openInvoiceCandidates, item => item.createdAt);
  if (input.eligible && firstCandidate) return {
    priority: 2,
    reason: 'پیش‌نویس در انتظار بررسی مالی', evidence: 'مبلغ، پرداخت‌ها و مدارک منشأ در پرونده بررسی شوند.',
    owner: 'حسابداری', waitingSince: firstCandidate.createdAt, nextAction: 'بررسی و تأیید مالی',
  };
  const overdue = oldest(input.overdueReceivables, item => item.dueDate);
  if (overdue) return {
    priority: 2,
    reason: 'دریافتنی سررسیدگذشته', evidence: 'مانده و دریافت‌های ثبت‌شده در پرونده بررسی شوند.',
    owner: 'حسابداری', waitingSince: overdue.dueDate, nextAction: 'بررسی دریافتنی',
  };
  if (input.eligible && input.invoiceStatus === 'NONE') return {
    priority: 3,
    reason: 'صورتحساب مالی هنوز آماده نشده',
    evidence: input.missingTaxFields.length ? `مدارک مالیاتی ناقص: ${input.missingTaxFields.join('، ')}` : 'مدرک ناقص ثبت‌شده‌ای در این خلاصه نیست.',
    owner: 'حسابداری', waitingSince: input.signedAt || input.createdAt, nextAction: 'بررسی قرارداد',
  };
  if (input.eligible && input.invoiceStatus === 'ISSUED' && !input.hasReceivable) return {
    priority: 2,
    reason: 'دریافتنی پس از تأیید مالی ثبت نشده', evidence: 'صورتحساب تأییدشده در پرونده موجود است.',
    owner: 'حسابداری', waitingSince: input.signedAt || input.createdAt, nextAction: 'بررسی دریافتنی',
  };
  if (input.eligible && input.taxStatus === 'NOT_READY') return {
    priority: 3,
    reason: 'مدارک مالیاتی ناقص',
    evidence: input.missingTaxFields.length ? input.missingTaxFields.join('، ') : 'جزئیات در بخش مالیات پرونده قرار دارد.',
    owner: 'حسابداری', waitingSince: input.signedAt || input.createdAt, nextAction: 'بررسی مالیات',
  };
  return null;
}
