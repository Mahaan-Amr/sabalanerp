export type AccountingVoidReasonKind = 'DUPLICATE_ISSUE' | 'ENTRY_ERROR' | 'SALE_CANCELLED' | 'OTHER';
export type AccountingVoidCaseStatus = 'OPEN' | 'CANCELLED' | 'COMPLETED';

type VoidCaseView = {
  id: string;
  status: AccountingVoidCaseStatus;
  sourceRecordId: string;
  reasonKind: AccountingVoidReasonKind;
  reason: string;
  effectiveAt: Date;
  retainedRecordId?: string | null;
  startedAt: Date;
};

type ReceivableView = {
  id: string;
  status: string;
  paidAmount: string | number | { toString(): string };
  remainingAmount: string | number | { toString(): string };
  metadata?: unknown;
};

type PaymentView = {
  id: string;
  receivableId?: string | null;
  method: string;
  status: string;
  checkStatus?: string | null;
  metadata?: unknown;
};

type TaxView = { id: string; submissionStatus: string };

export type AccountingVoidNextAction = {
  kind: 'REVERSE_RECEIPT' | 'RETURN_CHECK' | 'RESOLVE_TAX' | 'VOID_RECEIVABLE' | 'VOID_FINANCIAL_RECORD';
  targetId: string;
  href: string;
  labelFa: string;
};

export type AccountingVoidStep = {
  id: 'COLLECTIONS' | 'TAX' | 'RECEIVABLES' | 'FINANCIAL_RECORD';
  titleFa: string;
  state: 'DONE' | 'ACTIONABLE' | 'WAITING' | 'BLOCKED';
  messageFa: string;
  action?: AccountingVoidNextAction;
};

const terminalCheckStatuses = new Set(['BOUNCED', 'RETURNED', 'REPLACED']);
const submittedTaxStatuses = new Set([
  'SUBMITTED_MANUALLY',
  'SUBMITTED_EXTERNALLY',
  'ACCEPTED',
  'REJECTED',
  'NEEDS_CORRECTION',
]);
const isPositive = (value: ReceivableView['paidAmount']) => Number(value.toString()) > 0;
const tehranDayKey = (value: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(value);
const linkedVoidCaseId = (metadata: unknown) => metadata && typeof metadata === 'object' && !Array.isArray(metadata)
  ? String((metadata as Record<string, unknown>).voidCaseId || '')
  : '';

export const validateAccountingVoidCaseStart = (input: {
  sourceRecord: { id: string; contractId?: string | null; status: string; createdAt: Date };
  retainedRecord: { id: string; contractId?: string | null; status: string } | null;
  reasonKind: AccountingVoidReasonKind;
  reason: string;
  effectiveAt: Date;
  now: Date;
}) => {
  if (!['ISSUED', 'POSTED'].includes(input.sourceRecord.status)) {
    throw new Error('فقط رکورد مالی صادرشده یا ثبت‌شده وارد گردش ابطال می‌شود.');
  }
  if (!input.sourceRecord.contractId) throw new Error('این رکورد مالی به قرارداد معتبری متصل نیست.');
  if (!input.reason.trim()) throw new Error('دلیل ابطال را وارد کنید.');
  if (tehranDayKey(input.effectiveAt) < tehranDayKey(input.sourceRecord.createdAt)) {
    throw new Error('تاریخ مؤثر ابطال نمی‌تواند پیش از تاریخ ایجاد رکورد مالی باشد.');
  }
  if (tehranDayKey(input.effectiveAt) > tehranDayKey(input.now)) {
    throw new Error('تاریخ مؤثر ابطال نمی‌تواند در آینده باشد.');
  }
  if (input.reasonKind === 'DUPLICATE_ISSUE') {
    if (!input.retainedRecord) throw new Error('فاکتور معتبر باقی‌مانده را انتخاب کنید.');
    if (input.retainedRecord.id === input.sourceRecord.id) throw new Error('رکورد مالی نمی‌تواند خودش به‌عنوان فاکتور معتبر انتخاب شود.');
    if (input.retainedRecord.contractId !== input.sourceRecord.contractId) throw new Error('فاکتور معتبر باقی‌مانده باید متعلق به همان قرارداد باشد.');
    if (!['ISSUED', 'POSTED'].includes(input.retainedRecord.status)) throw new Error('فاکتور معتبر باقی‌مانده باید صادرشده و باطل‌نشده باشد.');
  }
};

const paymentAction = (payment: PaymentView): AccountingVoidNextAction | null => {
  if (payment.method === 'CHECK') {
    if (payment.status === 'REVERSED' || (payment.checkStatus && terminalCheckStatuses.has(payment.checkStatus))) return null;
    return {
      kind: 'RETURN_CHECK',
      targetId: payment.id,
      href: `/dashboard/accounting/payments?recordId=${payment.id}`,
      labelFa: payment.checkStatus === 'CLEARED' ? 'ثبت برگشت چک وصول‌شده' : 'عودت چک',
    };
  }
  if (payment.status === 'REVERSED' || payment.status === 'EXPECTED') return null;
  return {
    kind: 'REVERSE_RECEIPT',
    targetId: payment.id,
    href: `/dashboard/accounting/payments?recordId=${payment.id}`,
    labelFa: 'برگشت دریافت',
  };
};

export const buildAccountingVoidWorkflow = (input: {
  voidCase: VoidCaseView;
  sourceRecord: { id: string; status: string };
  receivables: ReceivableView[];
  payments: PaymentView[];
  taxRecords: TaxView[];
}) => {
  const activePayment = input.payments.map(payment => ({ payment, action: paymentAction(payment) }))
    .find((item): item is { payment: PaymentView; action: AccountingVoidNextAction } => Boolean(item.action));
  const submittedTax = input.taxRecords.find(tax => submittedTaxStatuses.has(tax.submissionStatus));
  const activeReceivable = input.receivables.find(receivable => receivable.status !== 'VOIDED');
  const collectionsChanged = input.payments.some(payment => linkedVoidCaseId(payment.metadata) === input.voidCase.id);
  const downstreamChanged = collectionsChanged || input.receivables.some(
    receivable => linkedVoidCaseId(receivable.metadata) === input.voidCase.id,
  );

  const blockers: Array<{ code: string; messageFa: string; responsibleRoleFa: string }> = [];
  if (activePayment?.payment.method === 'CHECK') blockers.push({
    code: 'ACTIVE_CHECK',
    messageFa: activePayment.payment.checkStatus === 'DEPOSITED'
      ? 'چک واگذارشده را ابتدا عودت دهید.'
      : activePayment.payment.checkStatus === 'CLEARED'
        ? 'اثر چک وصول‌شده را ابتدا برگشت بزنید.'
        : 'چک فعال را ابتدا عودت دهید.',
    responsibleRoleFa: 'مدیر حسابداری',
  });
  if (activePayment?.payment.method !== 'CHECK') blockers.push({
    code: 'ACTIVE_RECEIPT', messageFa: 'ابتدا دریافت ثبت‌شده را برگشت بزنید.', responsibleRoleFa: 'مدیر حسابداری',
  });
  if (submittedTax) blockers.push({
    code: 'SUBMITTED_TAX', messageFa: 'سابقه مالیاتی ارسال‌شده باید ابتدا اصلاح و تعیین‌تکلیف شود.', responsibleRoleFa: 'مدیر حسابداری',
  });
  if (activeReceivable && isPositive(activeReceivable.paidAmount) && !activePayment) blockers.push({
    code: 'PAID_RECEIVABLE', messageFa: 'مبلغ پرداخت‌شده دریافتنی باید ابتدا با برگشت دریافت به صفر برسد.', responsibleRoleFa: 'مدیر حسابداری',
  });

  let nextAction: AccountingVoidNextAction | null = activePayment?.action || null;
  if (!nextAction && submittedTax) nextAction = {
    kind: 'RESOLVE_TAX', targetId: submittedTax.id,
    href: `/dashboard/accounting/tax?recordId=${submittedTax.id}`, labelFa: 'تعیین‌تکلیف مالیات',
  };
  if (!nextAction && activeReceivable && !isPositive(activeReceivable.paidAmount)) nextAction = {
    kind: 'VOID_RECEIVABLE', targetId: activeReceivable.id,
    href: `/dashboard/accounting/receivables?recordId=${activeReceivable.id}`, labelFa: 'ابطال دریافتنی',
  };
  if (!nextAction && !activeReceivable && !submittedTax && input.sourceRecord.status !== 'VOIDED') nextAction = {
    kind: 'VOID_FINANCIAL_RECORD', targetId: input.sourceRecord.id,
    href: `/dashboard/accounting/invoice-candidates?recordId=${input.sourceRecord.id}`, labelFa: 'ابطال رکورد مالی',
  };

  const stepState = (kind: AccountingVoidNextAction['kind']): AccountingVoidStep['state'] => {
    if (nextAction?.kind === kind) return 'ACTIONABLE';
    return nextAction ? 'WAITING' : 'DONE';
  };
  const collectionsDone = !activePayment;
  const taxDone = !submittedTax;
  const receivablesDone = !activeReceivable;
  const recordDone = input.sourceRecord.status === 'VOIDED';
  const steps: AccountingVoidStep[] = [
    {
      id: 'COLLECTIONS', titleFa: 'تعیین‌تکلیف دریافت‌ها و چک‌ها',
      state: collectionsDone ? 'DONE' : 'ACTIONABLE',
      messageFa: collectionsDone ? 'همه دریافت‌ها و چک‌ها تعیین‌تکلیف شده‌اند.' : blockers[0]?.messageFa || 'دریافت فعال را تعیین‌تکلیف کنید.',
      ...(!collectionsDone && nextAction ? { action: nextAction } : {}),
    },
    {
      id: 'TAX', titleFa: 'تعیین‌تکلیف مالیات',
      state: taxDone ? 'DONE' : collectionsDone ? stepState('RESOLVE_TAX') : 'WAITING',
      messageFa: taxDone ? 'مانع مالیاتی ارسال‌شده وجود ندارد.' : 'سابقه مالیاتی ارسال‌شده باید ابتدا اصلاح و تعیین‌تکلیف شود.',
      ...(nextAction?.kind === 'RESOLVE_TAX' ? { action: nextAction } : {}),
    },
    {
      id: 'RECEIVABLES', titleFa: 'ابطال دریافتنی',
      state: receivablesDone ? 'DONE' : collectionsDone && taxDone ? stepState('VOID_RECEIVABLE') : 'WAITING',
      messageFa: receivablesDone ? 'دریافتنی باطل شده است.' : collectionsDone && taxDone
        ? 'دریافتنی بدون وصول آماده ابطال است.' : 'پس از تعیین‌تکلیف مراحل قبل، دریافتنی را باطل کنید.',
      ...(nextAction?.kind === 'VOID_RECEIVABLE' ? { action: nextAction } : {}),
    },
    {
      id: 'FINANCIAL_RECORD', titleFa: 'ابطال رکورد مالی',
      state: recordDone ? 'DONE' : receivablesDone && taxDone ? stepState('VOID_FINANCIAL_RECORD') : 'WAITING',
      messageFa: recordDone ? 'رکورد مالی باطل شده است.' : receivablesDone && taxDone
        ? 'رکورد مالی آماده ابطال نهایی است.' : 'پس از تکمیل مراحل قبل، رکورد مالی را باطل کنید.',
      ...(nextAction?.kind === 'VOID_FINANCIAL_RECORD' ? { action: nextAction } : {}),
    },
  ];

  return {
    id: input.voidCase.id,
    sourceRecordId: input.voidCase.sourceRecordId,
    status: recordDone ? 'COMPLETED' as const : input.voidCase.status,
    reasonKind: input.voidCase.reasonKind,
    reason: input.voidCase.reason,
    effectiveAt: input.voidCase.effectiveAt,
    retainedRecordId: input.voidCase.retainedRecordId || null,
    steps,
    blockers,
    nextAction,
    canCancel: input.voidCase.status === 'OPEN' && !downstreamChanged,
  };
};
