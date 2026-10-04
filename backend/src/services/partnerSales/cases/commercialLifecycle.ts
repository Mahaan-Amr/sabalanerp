import { readCasePricingResponse } from './pricingResponse';
import { appendPartnerCommercialEvent } from './commercialEvents';
import { randomUUID } from 'node:crypto';
import { Prisma, type SalesContract } from '@prisma/client';
import { partnerCommercialStatus, type PartnerCommercialState } from '@sabalanerp/partner-sales-contracts';
import { finishCommercialCorrection, readCommercialExpiryDays } from '../../ordinaryContractLifecycle';
import { currentPricingEvidenceIsValid, readCurrentPartnerCaseViews } from './lifecycle';
import { buildCaseCommitmentEvent } from './events';
import { caseComparableAmount } from '../reporting/comparable';

type Tx = Prisma.TransactionClient;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export const isPartnerCommercialFlow = (contract: Pick<SalesContract, 'partnerKind' | 'commercialFlowVersion'>) =>
  contract.partnerKind === 'PARTNER_CUSTOMER' && contract.commercialFlowVersion === 2;
export const partnerDeadlinePassed = (contract: Pick<SalesContract, 'firstFinancialRecordAt' | 'commercialExpiresAt'>, now = new Date()) =>
  !contract.firstFinancialRecordAt && !!contract.commercialExpiresAt && contract.commercialExpiresAt <= now;

export async function lockPartnerCommercialContract(tx: Tx, caseId: string) {
  await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${caseId} FOR UPDATE`;
  const root = await tx.partnerSaleCase.findUnique({ where: { id: caseId }, include: { customerContract: true, profile: { select: { userId: true } } } });
  if (!root?.customerContractId) throw new Error('قرارداد مشتری هنوز آماده نشده است.');
  await tx.$queryRaw`SELECT id FROM sales_contracts WHERE id = ${root.customerContractId} FOR UPDATE`;
  const contract = await tx.salesContract.findUniqueOrThrow({ where: { id: root.customerContractId } });
  return { root, contract };
}

export function assertPartnerCommercialAvailable(contract: SalesContract) {
  if (contract.isInactive || ['CANCELLED', 'EXPIRED'].includes(contract.status) || partnerDeadlinePassed(contract)) {
    throw new Error('قرارداد لغو، غیرفعال یا منقضی شده است.');
  }
}

async function audit(tx: Tx, contractId: string, actorId: string, action: string, before: unknown, after: unknown, note?: string) {
  await tx.accountingAuditLog.create({ data: { contractId, actorId, action, entityType: 'SalesContract', entityId: contractId,
    beforeState: json(before), afterState: json(after), note: note || null } });
}

async function partnerPreparationIsComplete(tx: Tx, root: { id: string; headRevision: number }) {
  const head = await tx.partnerCaseRevision.findUnique({ where: { caseId_revision: { caseId: root.id, revision: root.headRevision } },
    select: { retailEnvelope: true } });
  return !!head && (head.retailEnvelope as Prisma.JsonObject)?.preparationCompleted !== false;
}

async function assertPartnerPreparationComplete(tx: Tx, root: { id: string; headRevision: number }) {
  if (!await partnerPreparationIsComplete(tx, root)) throw new Error('برنامه تحویل و پرداخت را با محصولات فعلی تطبیق دهید و تکمیل قرارداد را دوباره ثبت کنید.');
}

/** All gates share the Case then Contract lock order. A quote is never a customer acceptance. */
export async function reconcilePartnerCommercialFinality(tx: Tx, caseId: string, actorId: string) {
  const { root, contract } = await lockPartnerCommercialContract(tx, caseId);
  if (!isPartnerCommercialFlow(contract)) return contract;
  if (contract.isInactive || ['CANCELLED', 'EXPIRED'].includes(contract.status)) return contract;
  const owner = { caseId, revision: root.headRevision, integrityHash: root.integrityHash };
  const alreadyFinal = contract.status === 'SIGNED' && contract.salesApprovalRevision === contract.commercialRevision
    && contract.customerAcceptanceRevision === contract.commercialRevision;
  const pricingAccepted = await partnerPreparationIsComplete(tx, root) && root.pricingState === 'READY_TO_FINALIZE'
    && (alreadyFinal || await currentPricingEvidenceIsValid(tx, owner));
  const now = new Date();
  let current = contract;
  if (pricingAccepted && !contract.commercialExpiresAt && !contract.firstFinancialRecordAt) {
    const days = await readCommercialExpiryDays(tx);
    current = await tx.salesContract.update({ where: { id: contract.id }, data: {
      commercialStartedAt: now, commercialExpiryDays: days, commercialExpiresAt: new Date(now.getTime() + days * 86_400_000),
    } });
  }
  const state = !partnerDeadlinePassed(current, now) && current.commercialRevision > 1 && current.salesApprovalRevision === null && current.customerAcceptanceRevision === null
    ? 'NOTE' : partnerCommercialStatus({ salesApproved: current.salesApprovalRevision === current.commercialRevision,
    customerAccepted: current.customerAcceptanceRevision === current.commercialRevision,
    pricingAccepted,
    expired: partnerDeadlinePassed(current, now) });
  const status = { NOTE: 'DRAFT', DRAFT: 'PENDING_APPROVAL', CUSTOMER_SIGNED: 'APPROVED', FINAL: 'SIGNED', QUOTED: 'PENDING_APPROVAL',
    EXPIRED: 'EXPIRED', CANCELLED: 'CANCELLED' }[state] as SalesContract['status'];
  if (state === 'FINAL' && root.state !== 'COMMITTED') {
    const views = await readCurrentPartnerCaseViews(tx, caseId);
    if (!views?.accounting || !root.internalRecordId) throw new Error('شواهد قیمت قرارداد کامل نیست.');
    const eventId = randomUUID(), commandId = randomUUID();
    const maximum = await tx.partnerCaseEvent.aggregate({ where: { caseId }, _max: { sequence: true } });
    const event = buildCaseCommitmentEvent({ eventId, commandId, correlationId: commandId, actorId,
      recordedAt: now.toISOString(), effectiveDate: now.toISOString().slice(0, 10), owner, trigger: 'FINALIZED',
      internalRecordId: root.internalRecordId, salesCreditOwnerId: current.responsibleSellerId!,
      sabalanNetAmount: { amount: caseComparableAmount(views.accounting.totals), currency: views.accounting.totals.currency } });
    await tx.partnerSaleCase.update({ where: { id: caseId }, data: { state: 'COMMITTED',
      stateRevision: { increment: 1 }, committedAt: now, commitmentTrigger: 'FINALIZED',
      committedRevision: root.headRevision, commitmentEventId: eventId } });
    await tx.partnerCaseEvent.create({ data: { id: eventId, caseId, caseRevision: root.headRevision,
      integrityHash: root.integrityHash, sequence: (maximum._max.sequence ?? 0) + 1,
      stateRevision: root.stateRevision + 1, type: 'CASE_COMMITTED', fromState: root.state, toState: 'COMMITTED',
      actorId, commandId, correlationId: commandId, effectiveDate: new Date(`${event.effectiveDate}T00:00:00.000Z`),
      evidence: json({ publicEvent: event, commercialRevision: current.commercialRevision }) } });
  }
  const updated = await tx.salesContract.update({ where: { id: current.id }, data: { status } });
  if (state === 'FINAL' && contract.status !== 'SIGNED') await finishCommercialCorrection(tx, contract.id, actorId);
  if (updated.status !== current.status) await audit(tx, current.id, actorId, 'PARTNER_COMMERCIAL_STATUS_CHANGED', current, updated);
  return updated;
}

export async function approvePartnerCommercialSales(tx: Tx, input: { caseId: string; actorId: string; revision: number }) {
  const { root, contract } = await lockPartnerCommercialContract(tx, input.caseId);
  if (!isPartnerCommercialFlow(contract)) throw new Error('این قرارداد در گردش جدید نیست.');
  assertPartnerCommercialAvailable(contract);
  await assertPartnerPreparationComplete(tx, root);
  if (contract.commercialRevision !== input.revision) throw new Error('قرارداد تغییر کرده است؛ صفحه را تازه‌سازی کنید.');
  if (contract.salesApprovalRevision !== input.revision) {
    const updated = await tx.salesContract.update({ where: { id: contract.id }, data: {
      salesApprovalRevision: input.revision, approvedBy: input.actorId,
    } });
    await audit(tx, contract.id, input.actorId, 'PARTNER_COMMERCIAL_SALES_APPROVED', contract, updated);
  }
  return reconcilePartnerCommercialFinality(tx, input.caseId, input.actorId);
}

export async function acceptPartnerCustomer(tx: Tx, input: { caseId: string; revision: number; actorId: string;
  method: 'DIGITAL' | 'PAPER'; sessionId?: string }) {
  const { root, contract } = await lockPartnerCommercialContract(tx, input.caseId);
  assertPartnerCommercialAvailable(contract);
  await assertPartnerPreparationComplete(tx, root);
  if (contract.commercialRevision !== input.revision) throw new Error('این نسخه قرارداد تغییر کرده است.');
  const updated = await tx.salesContract.update({ where: { id: contract.id }, data: {
    customerAcceptanceRevision: input.revision, customerAcceptanceMethod: input.method, signedAt: new Date(),
    ...(input.method === 'DIGITAL' ? { isSigned: true } : {}),
  } });
  await tx.partnerSaleCase.update({ where: { id: root.id }, data: { customerConfirmationState: 'APPROVED', stateRevision: { increment: 1 } } });
  await appendPartnerCommercialEvent(tx, root.id, input.actorId, 'PARTNER_CUSTOMER_ACCEPTED', { commercialRevision: input.revision, method: input.method, sessionId: input.sessionId });
  await audit(tx, contract.id, input.actorId, `PARTNER_CUSTOMER_${input.method}_ACCEPTED`, contract,
    { ...updated, sessionId: input.sessionId });
  return reconcilePartnerCommercialFinality(tx, root.id, input.actorId);
}

export async function rejectPartnerCustomer(tx: Tx, caseId: string, actorId: string) {
  const { root, contract } = await lockPartnerCommercialContract(tx, caseId);
  assertPartnerCommercialAvailable(contract);
  if (contract.customerAcceptanceRevision === contract.commercialRevision) throw new Error('این نسخه قبلاً توسط مشتری پذیرفته شده است.');
  await tx.salesContract.update({ where: { id: contract.id }, data: { customerAcceptanceRevision: null,
    customerAcceptanceMethod: null, signedAt: null, isSigned: false } });
  await tx.partnerSaleCase.update({ where: { id: root.id }, data: { customerConfirmationState: 'REJECTED', stateRevision: { increment: 1 } } });
  await appendPartnerCommercialEvent(tx, root.id, actorId, 'PARTNER_CUSTOMER_REJECTED', { commercialRevision: contract.commercialRevision });
  await audit(tx, contract.id, actorId, 'PARTNER_CUSTOMER_REJECTED', contract, { decision: 'REJECTED' });
  return reconcilePartnerCommercialFinality(tx, caseId, actorId);
}

export async function resetPartnerCommercialApprovals(tx: Tx, caseId: string, actorId: string, reason?: string) {
  const { root, contract } = await lockPartnerCommercialContract(tx, caseId);
  const updated = await tx.salesContract.update({ where: { id: contract.id }, data: {
    commercialFlowVersion: 2, commercialRevision: { increment: 1 }, status: 'DRAFT',
    salesApprovalRevision: null, customerAcceptanceRevision: null, customerAcceptanceMethod: null,
    approvedBy: null, signedBy: null, signedAt: null, isSigned: false,
    signedByPhoneNumber: null, verificationCodeId: null,
  } });
  await tx.partnerSaleCase.update({ where: { id: root.id }, data: { commercialFlowVersion: 1,
    customerConfirmationState: 'RECONFIRMATION_REQUIRED', stateRevision: { increment: 1 } } });
  await appendPartnerCommercialEvent(tx, root.id, actorId, 'PARTNER_COMMERCIAL_APPROVALS_RESET', { commercialRevision: updated.commercialRevision }, reason);
  await tx.contractPublicConfirmation.updateMany({ where: { contractId: contract.id, status: 'PENDING' },
    data: { status: 'CANCELLED', cancelledAt: new Date() } });
  await audit(tx, contract.id, actorId, 'PARTNER_COMMERCIAL_EDIT_RESET', contract, updated, reason);
  return updated;
}

export async function readPartnerCommercialState(tx: Tx, caseId: string,
  response?: 'READY' | 'PARTIAL' | 'WAITING' | 'REJECTED' | 'EXPIRED'): Promise<PartnerCommercialState | undefined> {
  const root = await tx.partnerSaleCase.findUnique({ where: { id: caseId }, include: { customerContract: true, profile: { select: { userId: true } } } });
  const contract = root?.customerContract;
  if (!root || !contract || !isPartnerCommercialFlow(contract)) return undefined;
  if (response === undefined) {
    const recovery = await tx.salesContractEditSession.findFirst({ where: { ownerUserId: root.profile.userId, purpose: 'PARTNER_TECHNICAL',
      OR: [{ contractId: contract.id }, { recovery: { path: ['partnerCaseId'], equals: caseId } }] }, select: { recovery: true } });
    if (recovery) response = await readCasePricingResponse(tx, { caseId, headRevision: root.headRevision,
      profileId: root.profileId, actorId: root.profile.userId, recovery: recovery.recovery });
  }
  const final = contract.status === 'SIGNED';
  const validPricing = root.pricingState === 'READY_TO_FINALIZE' && (final || await currentPricingEvidenceIsValid(tx,
    { caseId, revision: root.headRevision, integrityHash: root.integrityHash }));
  const salesApproved = contract.salesApprovalRevision === contract.commercialRevision;
  const customerAccepted = contract.customerAcceptanceRevision === contract.commercialRevision;
  const expired = contract.status === 'EXPIRED' || partnerDeadlinePassed(contract);
  const priceRejection = await tx.partnerCaseEvent.findFirst({ where: { caseId, caseRevision: root.headRevision, type: 'PARTNER_PRICING_REJECTED' }, select: { id: true } });
  const inquiry = validPricing ? 'ACCEPTED' : response === 'EXPIRED' || response === 'REJECTED'
    || root.pricingState === 'INCOMPLETE' || root.pricingState === 'EXPIRED' ? 'CORRECTION_REQUIRED' : priceRejection ? 'REJECTED' : 'WAITING';
  return { version: 1, revision: contract.commercialRevision,
    status: contract.commercialRevision > 1 && !salesApproved && !customerAccepted ? (expired ? 'EXPIRED' : ['CANCELLED', 'VOIDED'].includes(root.state) ? 'CANCELLED' : 'NOTE')
      : partnerCommercialStatus({ salesApproved, customerAccepted, pricingAccepted: validPricing, pricingReceived: response === 'READY',
      expired,
      cancelled: ['CANCELLED', 'VOIDED'].includes(root.state) }), salesApproved, customerAccepted, inquiry,
    expiresAt: contract.commercialExpiresAt?.toISOString() ?? null,
    firstFinancialRecordAt: contract.firstFinancialRecordAt?.toISOString() ?? null };
}

export async function assertPartnerFinancialFinality(tx: Tx, caseId: string) {
  const { contract } = await lockPartnerCommercialContract(tx, caseId);
  if (isPartnerCommercialFlow(contract) && (contract.status !== 'SIGNED' || partnerDeadlinePassed(contract)
    || contract.salesApprovalRevision !== contract.commercialRevision || contract.customerAcceptanceRevision !== contract.commercialRevision)) {
    throw new Error('ثبت مالی فقط پس از قطعی‌شدن نسخه جاری قرارداد همکار مجاز است.');
  }
  return contract;
}
