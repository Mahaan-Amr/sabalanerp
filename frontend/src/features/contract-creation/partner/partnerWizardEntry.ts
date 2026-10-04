import { IdSchema, QuantitySchema, PartnerCaseViewSchema, PartnerErrorSchema, PartnerTechnicalSavedViewSchema, partnerTrackingCode,
  type PartnerTechnicalSavedView } from '@sabalanerp/partner-sales-contracts';
import type { PartnerInquiryRow, PartnerInquiryView } from '../../partner-sales/inquiries/inquiryPresentation';
import { isUsableInquiryRow } from '../../partner-sales/inquiries/inquiryPresentation';
import { defaultPartnerRetailRows, partnerRetailIntentRows, remainingPartnerAmount, type PartnerRetailServiceRow } from './partnerRetail';
import type { PartnerWizardDraft } from './PartnerContractWizard';
import type { PartnerDraftIntent } from './partnerCaseSubmission';

export function partnerRequoteInquiryId(nonce: string): string {
  return IdSchema.parse(`partner-requote:${nonce}`);
}

export function partnerCasePricingInquiryIds(recoveryId: string, publishedIds: readonly string[],
  rows: readonly PartnerInquiryRow[], caseScoped = false): string[] {
  const ids = new Set(publishedIds.filter(id => caseScoped || id.startsWith(`partner-case-pricing:${recoveryId}:`)));
  for (const row of rows) for (const binding of [row.approvedRowBinding, row.predecessor, row.successor]) {
    if (binding) ids.add(binding.inquiryId);
  }
  return Array.from(ids);
}

export function partnerFinalizedContractPath(result: unknown, caseId: string): string {
  const response = result as { success?: boolean; data?: { customerContractId?: unknown; case?: unknown } } | null;
  const linkedId = IdSchema.safeParse(response?.data?.customerContractId);
  const view = PartnerCaseViewSchema.safeParse(response?.data?.case);
  if (!response?.success || !linkedId.success || !view.success ||
      view.data.owner.caseId !== caseId || view.data.state !== 'COMMITTED') {
    throw new Error('Finalized contract identity unavailable');
  }
  return `/dashboard/sales/contracts/${encodeURIComponent(linkedId.data)}`;
}

export const shouldPreferLocalPartnerWizard = (localServerRevision: number | undefined, currentServerRevision: number) =>
  localServerRevision === currentServerRevision;

export const shouldStartFreshPartnerCreation = (params: Pick<URLSearchParams, 'get'>) =>
  params.get('newCustomer') === '1' ||
  (!params.get('draftId') && !params.get('caseId') && params.get('newInquiry') === '1');

export const isExplicitPartnerCreationEntry = (params: Pick<URLSearchParams, 'get'>) =>
  params.get('entry') === 'new-contract';

export function partnerCreationRouteIdentity(params: Pick<URLSearchParams, 'get'>, mode: 'sale' | 'inquiry'): string {
  const resource = params.get('caseId') ? `case:${params.get('caseId')}`
    : params.get('draftId') ? `draft:${params.get('draftId')}`
      : params.get('inquiryId') ? `inquiry:${params.get('inquiryId')}` : 'new';
  return `${mode}:${resource}:${params.get('configure') === '1' ? `edit:${params.get('focusProductRowId') ?? ''}` : 'result'}`;
}

export function partnerCreationRequestedInquiry(params: Pick<URLSearchParams, 'get'>, latestInquiryId?: string): string | null {
  if (params.get('caseId')) return null;
  return params.get('inquiryId') || (params.get('draftId') ? null : latestInquiryId) || null;
}

export function partnerCaseResultStep(savedStep: PartnerWizardDraft['step'], openingNumberedResult: boolean): PartnerWizardDraft['step'] {
  return openingNumberedResult ? 'pricing' : savedStep;
}

export const partnerCaseReviewMessage = (caseReference: string, trackingNumber?: number) =>
  `این پرونده نیاز به بررسی دارد؛ با پشتیبانی تماس بگیرید و کد پرونده ${partnerTrackingCode(caseReference, trackingNumber)} را اعلام کنید.`;

export function latestMatchingPartnerInquiryRow(
  rows: readonly PartnerInquiryRow[], previous: PartnerInquiryRow,
): PartnerInquiryRow {
  return rows.filter(row => row.configurationRef.productRowId === previous.configurationRef.productRowId &&
    row.configurationRef.recoveryId === previous.configurationRef.recoveryId &&
    row.configurationRef.recoveryRevision === previous.configurationRef.recoveryRevision &&
    row.state !== 'SUPERSEDED' && !row.successor).at(0) ?? previous;
}

export function partnerCaseHasIntegrityError(error: unknown): boolean {
  const direct = PartnerErrorSchema.safeParse(error);
  if (direct.success) return direct.data.code === 'INTEGRITY_CONFLICT';
  const responseError = (error as { response?: { data?: { error?: unknown } } } | null)?.response?.data?.error;
  const nested = PartnerErrorSchema.safeParse(responseError);
  return nested.success && nested.data.code === 'INTEGRITY_CONFLICT';
}

export const shouldOfferPartnerDraftChoice = (
  recoverableDraftCount: number,
  params: Pick<URLSearchParams, 'get'>,
  startingFresh: boolean,
) => recoverableDraftCount > 0 && !startingFresh && !params.get('draftId') && !params.get('caseId');

export function partnerCreationPathAfterCustomerCreate(recoveryId: string | undefined, customerId: string): string {
  const params = new URLSearchParams({ customerId });
  if (recoveryId) params.set('draftId', recoveryId);
  return `/dashboard/sales/contracts/create?${params.toString()}`;
}

export function partnerProductEditPath(recoveryId: string, caseId?: string, productRowId?: string): string {
  const params = new URLSearchParams({ configure: '1', draftId: recoveryId });
  if (caseId) params.set('caseId', caseId);
  if (productRowId) params.set('focusProductRowId', productRowId);
  return `/dashboard/sales/contracts/create?${params.toString()}`;
}

export const partnerCasePendingStorageKey = (actorId: string, recoveryId: string) =>
  `partner-case-pending:${actorId}:${recoveryId}`;

export function rebasePartnerWizardSnapshot<T extends { serverRevision?: number }>(snapshot: T, serverRevision: number): T {
  return { ...snapshot, serverRevision };
}

export function preservePartnerDeliveriesAcrossProductEdit(
  previous: PartnerDraftIntent['deliveries'],
  currentProductRowIds: readonly string[],
  currentServiceRowIds: readonly string[] = [],
): PartnerDraftIntent['deliveries'] {
  // The editor retains the user's quantities and dates; validation catches removed identities.
  // These arguments describe the new graph but must never silently rewrite allocations.
  void currentProductRowIds;
  void currentServiceRowIds;
  return previous;

}

export function partnerDeliveryPlanIssue(
  deliveries: PartnerDraftIntent['deliveries'],
  rows: readonly { productRowId: string; quantity: string }[],
  services: readonly { serviceRowId: string; quantity: string }[] = [],
): string | null {
  if (!deliveries.length) return rows.length || services.length ? 'حداقل یک برنامه تحویل یا اجرا اضافه کنید.' : null;
  const deliverableIds = new Set(rows.map(row => row.productRowId));
  if (deliveries.some(delivery => delivery.items.some(item => !deliverableIds.has(item.productRowId)))) {
    return 'تحویل فقط برای محصولات قرارداد قابل ثبت است.';
  }
  const serviceIds = new Set(services.map(row => row.serviceRowId));
  if (deliveries.some(delivery => {
    const serviceItems = delivery.serviceItems ?? [];
    return new Set(serviceItems.map(item => item.serviceRowId)).size !== serviceItems.length ||
      serviceItems.some(item => !QuantitySchema.safeParse(item.quantity).success);
  })) return 'مقدار اجرای خدمت باید مثبت و هر خدمت در هر برنامه یکتا باشد.';
  if (deliveries.some(delivery => (delivery.serviceItems ?? []).some(item => !serviceIds.has(item.serviceRowId)))) {
    return 'خدمت برنامه اجرا در قرارداد موجود نیست.';
  }
  if (deliveries.some(item => (!item.items.length && !item.serviceItems?.length) || !item.date || !item.destination.trim() ||
      !item.projectManagerName?.trim() || !item.receiverName?.trim())) return 'برنامه تحویل را کامل کنید.';
  if (rows.some(row => remainingPartnerAmount(row.quantity, deliveries.flatMap(delivery => delivery.items
    .filter(item => item.productRowId === row.productRowId).map(item => item.quantity))) !== '0')) {
    return 'مقدار تحویل هر محصول باید دقیقاً با مقدار قرارداد برابر باشد.';
  }
  if (services.some(row => remainingPartnerAmount(row.quantity, deliveries.flatMap(delivery => (delivery.serviceItems ?? [])
    .filter(item => item.serviceRowId === row.serviceRowId).map(item => item.quantity))) !== '0')) {
    return 'مقدار اجرای هر خدمت باید دقیقاً با مقدار قرارداد برابر باشد.';
  }
  return null;
}

/** Preserve explicit allocations. Call partnerDeliveryPlanIssue before completion;
 * reducing a product must never silently reduce an agreed delivery quantity. */
export function reconcilePartnerDeliveriesToProducts(
  deliveries: PartnerDraftIntent['deliveries'],
  rows: readonly { productRowId: string; quantity: string }[],
  services: readonly { serviceRowId: string; quantity: string }[] = [],
): PartnerDraftIntent['deliveries'] {
  return preservePartnerDeliveriesAcrossProductEdit(deliveries,
    rows.map(row => row.productRowId), services.map(row => row.serviceRowId));
}

/** Quantity is supplied by the canonical graph's display projection; it is not
 * an inquiry fingerprint. No catalog-ID or array-position matching is allowed.
 */
export function enterPartnerWizard({ inquiry, inquiryRows, now, base, validated, mismatchedRowIds = [], retailUnitPrices, productPresentation, serviceRows = [] }: {
  serviceRows?: PartnerRetailServiceRow[];
  inquiry?: PartnerInquiryView;
  inquiryRows?: readonly PartnerInquiryRow[];
  now: number;
  base: Omit<PartnerDraftIntent, 'rows' | 'belowCostConfirmed' | 'graphHash'>;
  validated: PartnerTechnicalSavedView;
  mismatchedRowIds?: readonly string[];
  productPresentation?: ReadonlyMap<string, { title: string; parentProductRowId?: string }>;
  retailUnitPrices?: ReadonlyMap<string, { amount: string; currency: 'IRR' | 'IRT' }>;
}): PartnerWizardDraft | null {
  const saved = PartnerTechnicalSavedViewSchema.safeParse(validated);
  if (!saved.success || saved.data.recoveryId !== base.recoveryId ||
      saved.data.recoveryRevision !== base.recoveryRevision) return null;
  const savedServices = saved.data.serviceRows ?? [];
  const savedIds = [...saved.data.rows.map(row => row.configurationRef.productRowId), ...savedServices.map(row => row.serviceRowId)];
  if (new Set(savedIds).size !== savedIds.length) return null;
  if (savedServices.length !== serviceRows.length || new Set(serviceRows.map(row => row.serviceRowId)).size !== serviceRows.length ||
      savedServices.some(row => !serviceRows.some(service => service.serviceRowId === row.serviceRowId &&
        service.quantity === row.quantity && service.unit === row.unit))) return null;
  const availableRows = inquiryRows ?? inquiry?.rows ?? [];
  const approved = availableRows.filter(row => isUsableInquiryRow(row, now))
    .filter(row => !mismatchedRowIds.includes(row.rowId));
  const subjects = saved.data.pricingSubjects ?? saved.data.rows.map(row => ({ configurationRef: row.configurationRef,
    role: 'PRIMARY' as const }));
  const subjectRows: PartnerInquiryRow[] = subjects.map((subject, index) => {
    const matching = availableRows.filter(row => row.configurationRef.productRowId === subject.configurationRef.productRowId &&
      row.configurationRef.recoveryId === subject.configurationRef.recoveryId &&
      row.configurationRef.recoveryRevision === subject.configurationRef.recoveryRevision)
      .sort((left, right) => Number(Boolean(left.successor)) - Number(Boolean(right.successor)) || right.revision - left.revision);
    // A recovery revision changes for the whole graph. Keep each rejected leaf's
    // identity and reason while sending its corrected, current configuration.
    // Historical approvals must still pass the exact configuration match above.
    const historicalLeaf = availableRows.filter(row => ['REJECTED', 'PENDING'].includes(row.state) && !row.successor &&
      row.configurationRef.productRowId === subject.configurationRef.productRowId &&
      row.configurationRef.recoveryId === subject.configurationRef.recoveryId &&
      row.configurationRef.recoveryRevision < subject.configurationRef.recoveryRevision)
      .sort((left, right) => right.configurationRef.recoveryRevision - left.configurationRef.recoveryRevision ||
        right.revision - left.revision)[0];
    const selected = matching.find(row => approved.includes(row)) ?? matching[0] ?? (historicalLeaf?.state === 'REJECTED' ? {
      ...historicalLeaf, submissionState: 'UNSENT' as const, configurationRef: subject.configurationRef,
    } : historicalLeaf) ?? {
      rowId: `${subject.configurationRef.productRowId}-awaiting-inquiry`, revision: 1,
      submissionState: 'UNSENT',
      description: `محصول ${index + 1}`, state: 'PENDING', configuration: [], usedCaseNumbers: [],
      configurationRef: subject.configurationRef,
    };
    if (selected.state === 'APPROVED' && !approved.includes(selected)) {
      return { ...selected, approvedPrice: undefined, approvedRowBinding: undefined };
    }
    return selected;
  });
  const configured = [];
  for (const technical of saved.data.rows) {
    if (!subjectRows.some(item => item.configurationRef.productRowId === technical.configurationRef.productRowId) &&
        !productPresentation?.get(technical.configurationRef.productRowId)?.parentProductRowId) return null;
    const row = subjectRows.find(item => item.configurationRef.productRowId === technical.configurationRef.productRowId) ?? {
      rowId: `${technical.configurationRef.productRowId}-paid-remainder`, revision: 1,
      submissionState: 'UNSENT' as const, description: 'فرزند باقی‌مانده', state: 'PENDING' as const,
      configuration: [], usedCaseNumbers: [], configurationRef: technical.configurationRef,
    };
    configured.push({ productRowId: technical.configurationRef.productRowId,
      quantity: technical.quantity, unit: technical.unit, inquiryRow: productPresentation?.get(technical.configurationRef.productRowId)
        ? { ...row, description: productPresentation.get(technical.configurationRef.productRowId)!.title } : row,
      parentProductRowId: productPresentation?.get(technical.configurationRef.productRowId)?.parentProductRowId,
      retailUnitPrice: saved.data.rows.some(parent => parent.configurationRef.productRowId ===
        productPresentation?.get(technical.configurationRef.productRowId)?.parentProductRowId)
        ? { amount: '0', currency: 'IRT' as const } : retailUnitPrices?.get(technical.configurationRef.productRowId) });
  }
  if (configured.length !== saved.data.rows.length || new Set(configured.map(row => row.productRowId)).size !== configured.length) return null;
  const rows = defaultPartnerRetailRows(configured);
  const additionalMaterialApprovals = subjectRows.flatMap(row => subjects.some(subject => subject.role === 'ADDITIONAL_MATERIAL' &&
    subject.configurationRef.productRowId === row.configurationRef.productRowId) && row.approvedRowBinding
    ? [{ pricingSubjectId: row.configurationRef.productRowId, approvedRowBinding: row.approvedRowBinding }] : []);
  const intent = { ...base, preparationCompleted: base.preparationCompleted ?? false, graphHash: saved.data.graphHash, belowCostConfirmed: false, additionalMaterialApprovals,
    rows: partnerRetailIntentRows(rows),
    ...(serviceRows.length ? { serviceRows: serviceRows.map(row => ({ serviceRowId: row.serviceRowId })) } : {}),
  };
  const materialInquiryRows = subjectRows.flatMap(row => subjects.some(subject => subject.role === 'ADDITIONAL_MATERIAL' &&
    subject.configurationRef.productRowId === row.configurationRef.productRowId)
    ? [{ pricingSubjectId: row.configurationRef.productRowId, inquiryRow: row }] : []);
  return { intent, rows, serviceRows, materialInquiryRows, step: 'date' };
}

export function partnerSaleReturnStep(params: Pick<URLSearchParams, 'get'>): 'customer' | 'project' | 'pricing' | null {
  if (params.get('returnTo') !== 'contract') return null;
  if (params.get('step') === '5') return 'pricing';
  return params.get('step') === '3' ? 'project' : params.get('step') === '2' ? 'customer' : null;
}
