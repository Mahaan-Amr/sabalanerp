type JsonRecord = Readonly<Record<string, unknown>>;

export const FINANCIAL_EVIDENCE_REVIEW_PREFIX = 'financial-evidence:';

export type FinancialEvidenceReviewKind = 'QUANTITY' | 'AMOUNT' | 'SNAPSHOT' | 'GENERAL';
export type FinancialEvidenceRemediationKind =
  | 'RESPONSIBLE_SELLER_CORRECTION'
  | 'EVIDENCE_RECOVERY'
  | 'TECHNICAL_SUPPORT';

export type FinancialEvidenceReviewRecord = {
  id: string;
  contractId: string;
  sourceFinancialRecordId?: string | null;
  trackingCode?: string | null;
  title?: string | null;
  note?: string | null;
  status: string;
  severity?: string | null;
  evidence?: unknown;
  createdBy?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: Date | string | null;
  resolutionNote?: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
};

export type FinancialEvidenceWitness = {
  source: 'OPTIMIZER_TOTAL' | 'OPTIMIZER_PRODUCTION' | 'PRODUCT_GRAPH' | 'DELIVERY' | 'WIZARD_DELIVERY' | 'INVOICE';
  labelFa: string;
  rawValue: string;
  transformedValue?: string;
  ruleLabelFa?: string;
  unit: string;
  referenceId?: string;
};

const record = (value: unknown): JsonRecord => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
);

const stringValue = (value: unknown) => (
  typeof value === 'string' || typeof value === 'number' ? String(value) : ''
);

export const financialEvidenceReviewActionUrl = (contractId: string, caseId: string) =>
  `/dashboard/accounting/contracts/${encodeURIComponent(contractId)}/financial-evidence-reviews/${encodeURIComponent(caseId)}`;

export const isFinancialEvidenceReviewCase = (flag: Pick<FinancialEvidenceReviewRecord, 'trackingCode' | 'evidence'>) => {
  const evidence = record(flag.evidence);
  return Boolean(
    flag.trackingCode?.startsWith(FINANCIAL_EVIDENCE_REVIEW_PREFIX)
    || evidence.code === 'FINANCIAL_EVIDENCE_CONFLICT',
  );
};

export const assertGeneralFlagTransitionAllowed = (
  flag: Pick<FinancialEvidenceReviewRecord, 'trackingCode' | 'evidence'>,
) => {
  if (isFinancialEvidenceReviewCase(flag)) {
    throw new Error('پرونده بررسی شواهد مالی فقط پس از بازآزمایی موفق بسته می‌شود و امکان بستن یا لغو عمومی آن وجود ندارد.');
  }
};

const inferReviewKind = (evidence: JsonRecord, structured: JsonRecord): FinancialEvidenceReviewKind => {
  if (evidence.reviewKind === 'QUANTITY' || evidence.reviewKind === 'AMOUNT' ||
    evidence.reviewKind === 'SNAPSHOT' || evidence.reviewKind === 'GENERAL') {
    return evidence.reviewKind;
  }
  const message = `${stringValue(evidence.userMessageFa)} ${stringValue(evidence.technicalDetail)}`;
  if (/کمیت|quantity|optimizer|delivery/i.test(message) || structured.productRowId) return 'QUANTITY';
  if (/مبلغ|amount|pricing/i.test(message)) return 'AMOUNT';
  if (/snapshot|اسنپ/i.test(message)) return 'SNAPSHOT';
  return 'GENERAL';
};

const inferRemediation = (
  evidence: JsonRecord,
  structured: JsonRecord,
): FinancialEvidenceRemediationKind => {
  if (evidence.remediationKind === 'RESPONSIBLE_SELLER_CORRECTION' ||
    evidence.remediationKind === 'EVIDENCE_RECOVERY' || evidence.remediationKind === 'TECHNICAL_SUPPORT') {
    return evidence.remediationKind;
  }
  const message = `${stringValue(evidence.userMessageFa)} ${stringValue(evidence.technicalDetail)}`;
  if (/منشأ|provenance|missing|ناقص|مبهم|ambiguous/i.test(message)) return 'EVIDENCE_RECOVERY';
  if (structured.productRowId || /کمیت|quantity|delivery|optimizer|مبلغ|amount/i.test(message)) {
    return 'RESPONSIBLE_SELLER_CORRECTION';
  }
  return 'TECHNICAL_SUPPORT';
};

const quantityRuleLabelFa = (rule: string) => {
  if (rule === 'EXACT_DECIMAL') return 'مقایسه دقیق مقدار خام، بدون گردکردن';
  if (rule === 'ROUND_HALF_UP_SCALE_THREE') return 'گردکردن نیم‌به‌بالا با دقت سه رقم برای مقایسه Product Graph';
  if (rule === 'ROUND_HALF_UP_SCALE_TWO_PER_ROW_THEN_SUM') return 'گردکردن نیم‌به‌بالا با دقت دو رقم برای هر ردیف Delivery، سپس جمع';
  if (rule === 'ROUND_HALF_UP_SCALE_THREE_PER_ROW_THEN_SUM') return 'گردکردن نیم‌به‌بالا با دقت سه رقم برای هر ردیف Delivery، سپس جمع';
  return 'قاعده نسخه‌محور ثبت‌شده برای همین شاهد';
};

const quantityWitnesses = (structured: JsonRecord): FinancialEvidenceWitness[] => {
  const unit = structured.unit === 'meter' ? 'متر' : stringValue(structured.unit) || 'متر';
  const witnesses: FinancialEvidenceWitness[] = [];
  const add = (
    source: FinancialEvidenceWitness['source'],
    labelFa: string,
    value: unknown,
    transformedValue?: unknown,
    referenceId?: string,
    comparisonRule?: unknown,
  ) => {
    const rawValue = stringValue(value);
    const transformed = stringValue(transformedValue);
    if (rawValue) witnesses.push({
      source,
      labelFa,
      rawValue,
      ...(transformed ? { transformedValue: transformed } : {}),
      ...(stringValue(comparisonRule) ? { ruleLabelFa: quantityRuleLabelFa(stringValue(comparisonRule)) } : {}),
      unit,
      ...(referenceId ? { referenceId } : {}),
    });
  };
  add('OPTIMIZER_TOTAL', 'کمیت کل optimizer', structured.rawOptimizerQuantity, structured.transformedOptimizerQuantity, undefined, structured.optimizerComparisonRule);
  add('OPTIMIZER_PRODUCTION', 'جمع قطعات تولیدی optimizer', structured.rawProductionQuantity, structured.transformedProductionQuantity, undefined, structured.productionComparisonRule);
  add('PRODUCT_GRAPH', 'کمیت Product Graph', structured.rawCanonicalGraphQuantity, structured.transformedCanonicalGraphQuantity, undefined, structured.graphComparisonRule);
  const deliveryRows = Array.isArray(structured.rawPersistedDeliveryRows)
    ? structured.rawPersistedDeliveryRows
    : [];
  for (const [index, rawRow] of deliveryRows.entries()) {
    const row = record(rawRow);
    add(
      'DELIVERY',
      `تحویل ثبت‌شده ${index + 1}`,
      row.rawQuantity,
      row.transformedQuantity,
      stringValue(row.deliveryProductId) || undefined,
      structured.deliveryComparisonRule,
    );
  }
  if (deliveryRows.length === 0) {
    add('DELIVERY', 'جمع تحویل‌های ثبت‌شده', structured.rawPersistedDeliveryTotal, structured.transformedPersistedDeliveryTotal, undefined, structured.deliveryComparisonRule);
  }
  const wizardRows = Array.isArray(structured.rawWizardDeliveryRows) ? structured.rawWizardDeliveryRows : [];
  for (const [index, rawRow] of wizardRows.entries()) {
    const row = record(rawRow);
    add('WIZARD_DELIVERY', `شاهد تاریخی تحویل ${index + 1}`, row.rawQuantity, row.transformedQuantity, undefined, structured.deliveryComparisonRule);
  }
  add('INVOICE', 'کمیت خام پیش‌فاکتور', structured.rawInvoiceItemQuantity, structured.transformedInvoiceItemQuantity, undefined, structured.invoiceComparisonRule);
  return witnesses;
};

export const presentFinancialEvidenceReviewCase = (
  flag: FinancialEvidenceReviewRecord,
  actorLabel: (actorId: string) => string = actorId => actorId,
) => {
  if (!isFinancialEvidenceReviewCase(flag)) throw new Error('رکورد انتخاب‌شده پرونده بررسی شواهد مالی نیست.');
  const evidence = record(flag.evidence);
  const structured = record(evidence.structuredEvidence);
  const kind = inferReviewKind(evidence, structured);
  const remediationKind = inferRemediation(evidence, structured);
  const status = String(flag.status || 'OPEN');
  const recordedResolutionMode = stringValue(evidence.resolutionMode);
  const sourceDraftRetired = status === 'RESOLVED' && recordedResolutionMode === 'SOURCE_DRAFT_RETIRED';
  const reconciledByEvidenceRecheck = status === 'RESOLVED'
    && recordedResolutionMode === 'RECONCILED_BY_EVIDENCE_RECHECK'
    && Boolean(stringValue(evidence.reconciledApprovedPricingVersionId))
    && Boolean(stringValue(evidence.reconciledApprovedPricingIntegrityHash));
  const resolutionMode = sourceDraftRetired
    ? 'SOURCE_DRAFT_RETIRED' as const
    : reconciledByEvidenceRecheck
      ? 'RECONCILED_BY_EVIDENCE_RECHECK' as const
      : 'LEGACY_UNVERIFIED' as const;
  const readyForFinancialApproval = reconciledByEvidenceRecheck;
  const primaryAction = sourceDraftRetired
    ? {
        kind: 'OPEN_ACCOUNTING_CONTRACT' as const,
        labelFa: 'بازگشت برای ساخت پیش‌فاکتور تازه',
        href: `/dashboard/accounting/contracts/${encodeURIComponent(flag.contractId)}#financial-records`,
      }
    : remediationKind === 'RESPONSIBLE_SELLER_CORRECTION'
    ? {
        kind: 'OPEN_SALES_CONTRACT' as const,
        labelFa: 'رفتن به قرارداد فروش',
        href: `/dashboard/sales/contracts/${encodeURIComponent(flag.contractId)}`,
      }
    : remediationKind === 'EVIDENCE_RECOVERY'
      ? {
          kind: 'OPEN_SUPPORT' as const,
          labelFa: 'ارجاع برای بازیابی شواهد تاریخی',
          href: '/dashboard/support/new',
        }
      : {
          kind: 'OPEN_SUPPORT' as const,
          labelFa: 'گزارش مشکل فنی',
          href: '/dashboard/support/new',
        };
  const checklist = remediationKind === 'RESPONSIBLE_SELLER_CORRECTION'
    ? [
        { key: 'SALES_CORRECTION', labelFa: 'فروشنده مسئول از صفحه قرارداد فروش، درخواست اصلاح را ثبت و گردش تأیید را کامل کند', complete: readyForFinancialApproval },
        { key: 'DELETE_STALE_DRAFT', labelFa: 'حسابداری پیش‌فاکتور ناسازگار را با دکمه «حذف پیش‌نویس» حذف کند', complete: sourceDraftRetired || readyForFinancialApproval },
        { key: 'CREATE_FRESH_DRAFT', labelFa: 'پس از اعمال اصلاح مبدأ، پیش‌فاکتور تازه ایجاد شود', complete: readyForFinancialApproval },
        { key: 'RECHECK_AND_APPROVE', labelFa: 'شواهد پیش‌فاکتور تازه بازآزمایی و تأیید مالی دوباره اجرا شود', complete: readyForFinancialApproval },
      ]
    : remediationKind === 'EVIDENCE_RECOVERY'
      ? [
          { key: 'OPEN_SUPPORT', labelFa: 'پرونده بازیابی شواهد تاریخی برای پشتیبانی ثبت شود', complete: readyForFinancialApproval },
          { key: 'RECOVER_PROVENANCE', labelFa: 'نسخه تولیدکننده و قاعده تبدیل تاریخی با سند حسابرسی بازیابی شود', complete: readyForFinancialApproval },
          { key: 'RECHECK_EVIDENCE', labelFa: 'از همین صفحه «بازآزمایی شواهد» اجرا شود', complete: readyForFinancialApproval },
          { key: 'CONTINUE_APPROVAL', labelFa: 'فقط پس از بازآزمایی موفق، تأیید مالی ادامه پیدا کند', complete: readyForFinancialApproval },
        ]
      : [
          { key: 'OPEN_SUPPORT', labelFa: 'مشکل فنی با شناسه همین پرونده برای پشتیبانی ثبت شود', complete: readyForFinancialApproval },
          { key: 'FIX_AND_RECHECK', labelFa: 'پس از اصلاح فنی، از همین صفحه «بازآزمایی شواهد» اجرا شود', complete: readyForFinancialApproval },
          { key: 'CONTINUE_APPROVAL', labelFa: 'فقط پس از بازآزمایی موفق، تأیید مالی ادامه پیدا کند', complete: readyForFinancialApproval },
        ];
  const scalarDifference = stringValue(structured.difference || structured.persistedDifference);
  const comparisonDifferences = Array.isArray(structured.comparisonDifferences)
    ? structured.comparisonDifferences.flatMap(rawDifference => {
        const difference = record(rawDifference);
        const value = stringValue(difference.value);
        if (!value) return [];
        return [{
          labelFa: stringValue(difference.labelFa) || 'اختلاف دقیق',
          value,
          unit: difference.unit === 'meter' ? 'متر' : stringValue(difference.unit),
          key: stringValue(difference.key) || undefined,
          basis: stringValue(difference.basis) || undefined,
          ruleLabelFa: stringValue(difference.rule) ? quantityRuleLabelFa(stringValue(difference.rule)) : undefined,
          leftComparableValue: stringValue(difference.leftComparableValue) || undefined,
          rightComparableValue: stringValue(difference.rightComparableValue) || undefined,
        }];
      })
    : [];
  const rule = stringValue(structured.rule);
  const createdActorId = stringValue(evidence.createdActorId) || stringValue(evidence.actorId) || stringValue(flag.createdBy);
  const lastRecheckActorId = stringValue(evidence.lastRecheckedBy) || createdActorId;
  const ruleLabelFa = rule.includes('SCALE_TWO') || rule.includes('rounding-v1')
    ? 'قاعده تاریخی هر ردیف: گردکردن نیم‌به‌بالا با دقت دو رقم، سپس مقایسه قطعی'
    : rule.includes('SCALE_THREE') || rule.includes('rounding-v2')
      ? 'قاعده تاریخی هر ردیف: گردکردن نیم‌به‌بالا با دقت سه رقم، سپس مقایسه قطعی'
      : rule
        ? 'قاعده نسخه‌محور ثبت‌شده برای همین قرارداد'
        : null;
  return {
    id: flag.id,
    contractId: flag.contractId,
    sourceFinancialRecordId: flag.sourceFinancialRecordId ?? null,
    status,
    severity: flag.severity ?? null,
    kind,
    remediationKind,
    resolutionMode,
    readyForFinancialApproval,
    titleFa: kind === 'QUANTITY' ? 'پرونده بررسی کمیت قرارداد' : 'پرونده بررسی شواهد مالی',
    messageFa: stringValue(evidence.userMessageFa) || stringValue(flag.note) || 'شواهد مالی قرارداد نیازمند بررسی است.',
    productRowId: stringValue(structured.productRowId) || null,
    rule: rule || null,
    ruleLabelFa,
    witnesses: kind === 'QUANTITY' ? quantityWitnesses(structured) : [],
    differences: comparisonDifferences.length > 0
      ? comparisonDifferences
      : scalarDifference
        ? [{ labelFa: 'اختلاف دقیق', value: scalarDifference, unit: structured.unit === 'meter' ? 'متر' : stringValue(structured.unit) }]
        : [],
    guidance: remediationKind === 'RESPONSIBLE_SELLER_CORRECTION'
      ? 'فروشنده مسئول باید از صفحه قرارداد فروش درخواست اصلاح را آغاز کند. پس از اصلاح مبدأ یا ایجاد پیش‌فاکتور تازه، شواهد را دوباره بازآزمایی کنید.'
      : remediationKind === 'EVIDENCE_RECOVERY'
        ? 'این مورد با حدس یا گردکردن قابل حل نیست. مسئول پشتیبانی باید منشأ نسخه و شواهد تاریخی را بازیابی کند؛ حسابداری فقط وضعیت پرونده را پیگیری می‌کند.'
        : 'این مورد یک خرابی فنی است و نباید به‌عنوان تصمیم تجاری بسته شود. مشکل را برای پشتیبانی ثبت کنید.',
    primaryAction,
    canRetryReconciliation: status === 'OPEN',
    checklist,
    audit: {
      createdBy: createdActorId ? actorLabel(createdActorId) : 'ثبت سیستمی',
      createdAt: flag.createdAt ?? null,
      lastRecheckedBy: stringValue(evidence.lastRecheckedAt) && lastRecheckActorId
        ? actorLabel(lastRecheckActorId)
        : null,
      lastRecheckedAt: stringValue(evidence.lastRecheckedAt) || null,
      resolvedBy: flag.resolvedBy ? actorLabel(flag.resolvedBy) : null,
      resolvedAt: flag.resolvedAt ?? null,
      resolutionNote: flag.resolutionNote ?? null,
    },
    createdAt: flag.createdAt ?? null,
    updatedAt: flag.updatedAt ?? null,
  };
};
