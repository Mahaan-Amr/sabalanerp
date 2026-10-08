import { ContractStatus, Prisma, type PrismaClient } from '@prisma/client';
import { completeSalesContractCorrectionEdit } from './salesContractCorrectionDuty';
import { closePartnerCommercialEditPermission } from './crossWorkspaceDutyAdapters/salesContractCorrectionDutyAdapter';
import { withRecoveryBackgroundWrite } from './recoveryRuntime';
import { assertContractQuantityEvidenceReadyForFinalization } from './contractQuantityEvidenceGuard';
import { getEffectiveUserAccess } from './effectiveAccessService';
import { ordinaryContractDispatchEligible } from './ordinaryContractDispatchEligibility';
import { processContractCreditReminders } from './contractCreditReminders';
import { authorizeSpecialCustomerCredit } from './specialCustomerCredit';
import { hasSpecialCustomerCreditAuthorization } from './specialCustomerCreditPolicy';

type Database = PrismaClient | Prisma.TransactionClient;
export type CommercialContract = {
  id?: string; partnerKind?: string | null; partnerCaseId?: string | null;
  commercialFlowVersion?: number; commercialRevision?: number;
  salesApprovalRevision?: number | null; customerAcceptanceRevision?: number | null;
  status: string; isInactive?: boolean; firstFinancialRecordAt?: Date | null;
  commercialExpiresAt?: Date | null;
  dispatchExpiryExempt?: boolean;
};
export const isOrdinaryCommercialFlow = (contract: CommercialContract) =>
  contract.commercialFlowVersion === 1 && !contract.partnerKind && !contract.partnerCaseId;
export const commercialApprovalStatus = (revision: number, sales?: number | null, customer?: number | null): ContractStatus =>
  sales === revision ? customer === revision ? 'SIGNED' : 'PENDING_APPROVAL'
    : customer === revision ? 'APPROVED' : 'DRAFT';
export const isCommerciallyFinal = (contract: CommercialContract) => isOrdinaryCommercialFlow(contract)
  ? !contract.isInactive && contract.status === 'SIGNED'
    && contract.salesApprovalRevision === contract.commercialRevision
    && contract.customerAcceptanceRevision === contract.commercialRevision
  : !contract.isInactive && ['APPROVED', 'SIGNED', 'PRINTED'].includes(contract.status);
export const commercialDeadlinePassed = (contract: CommercialContract, now = new Date()) =>
  isOrdinaryCommercialFlow(contract) && !contract.firstFinancialRecordAt && !contract.dispatchExpiryExempt && !!contract.commercialExpiresAt
  && contract.commercialExpiresAt <= now;
export const assertCommercialActionAvailable = (contract: CommercialContract, now = new Date()) => {
  if (contract.isInactive || ['CANCELLED', 'EXPIRED'].includes(contract.status) || commercialDeadlinePassed(contract, now)) {
    throw new Error('Contract cannot be modified in current status');
  }
};
export const refreshDispatchExpiryExemption = async (db: Database, contract: CommercialContract) => {
  if (isOrdinaryCommercialFlow(contract) && !contract.firstFinancialRecordAt && contract.commercialExpiresAt
    && contract.commercialExpiresAt <= new Date()) contract.dispatchExpiryExempt = await ordinaryContractDispatchEligible(db, contract);
};
export const lockOrdinaryContract = async (tx: Database, contractId: string) => {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "sales_contracts" WHERE "id" = ${contractId} FOR UPDATE`);
  const contract = await tx.salesContract.findUnique({ where: { id: contractId } });
  if (!contract) throw new Error('Contract not found');
  await refreshDispatchExpiryExemption(tx, contract);
  return contract;
};
/** Compatibility endpoints cannot mutate the coupled commercial snapshot of a
 * versioned Contract. Its full editor owns rows, delivery and payment together. */
export const mutateLegacyCommercialContract = async <T>(database: PrismaClient, contractId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> => database.$transaction(async tx => {
  const contract = await lockOrdinaryContract(tx, contractId);
  if (isOrdinaryCommercialFlow(contract)) throw new Error('تغییر اقلام، پرداخت یا تحویل این قرارداد باید از ویرایش کامل قرارداد انجام شود.');
  if (contract.isInactive) throw new Error('Contract is inactive');
  return work(tx);
});
export const readCommercialExpiryDays = async (tx: Database) =>
  (await tx.salesCommercialSetting.findUnique({ where: { id: 'ordinary-contracts' } }))?.expiryDays ?? 10;
export const canManageCommercialSettings = async (tx: Database, user: { id: string; role: string }) => {
  const actor = await tx.user.findUnique({ where: { id: user.id }, select: { role: true } });
  if (!actor) return false;
  if (actor.role === 'ADMIN') return true;
  const access = await getEffectiveUserAccess(tx, { userId: user.id, userRole: actor.role });
  return access.workspaces.some(item => item.workspace === 'sales' && item.permission === 'admin');
};
export const commercialStartFields = async (tx: Database, now = new Date()) => {
  const days = await readCommercialExpiryDays(tx);
  return { commercialFlowVersion: 1, commercialRevision: 1, commercialStartedAt: now,
    commercialExpiryDays: days, commercialExpiresAt: new Date(now.getTime() + days * 86_400_000) };
};
export const invalidateCommercialApprovals = async (tx: Database, contractId: string) => {
  await tx.contractPublicConfirmation.updateMany({ where: { contractId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
};
const audit = (tx: Database, contractId: string, actorId: string, action: string, before: unknown, after: unknown, note?: string) =>
  tx.accountingAuditLog.create({ data: { contractId, actorId, action, entityType: 'SalesContract', entityId: contractId,
    beforeState: JSON.parse(JSON.stringify(before)), afterState: JSON.parse(JSON.stringify(after)), note: note || null } });

export const finishCommercialCorrection = async (tx: Database, contractId: string, actorId: string, specialCredit = false) => {
  const correction = await tx.accountingCorrectionRequest.findFirst({ where: { contractId, status: 'APPROVED_FOR_SALES_EDIT' } });
  if (!correction) return;
  const contract = await tx.salesContract.findUnique({ where: { id: contractId } });
  if (contract?.partnerKind === 'PARTNER_CUSTOMER' && contract.partnerCaseId) {
    // Partner corrections finish with renewed commercial finality (or an
    // unchanged final return), without a second Accounting review round.
    if (contract.status !== 'SIGNED' || contract.salesApprovalRevision !== contract.commercialRevision ||
        contract.customerAcceptanceRevision !== contract.commercialRevision) return;
    const duty = await tx.crossWorkspaceDuty.findFirst({ where: { sourceId: correction.id,
      sourceType: 'SALES_CONTRACT_CORRECTION', sourceActionCode: 'SALES_EDIT_CONTRACT_CORRECTION', status: 'OPEN' } });
    if (duty) await closePartnerCommercialEditPermission(tx as Prisma.TransactionClient, { dutyId: duty.id,
      actorUserId: actorId, reason: 'اصلاح همکار با حفظ یا تکمیل تأییدهای نسخه جاری پایان یافت.', now: new Date(),
      outcome: 'PARTNER_CORRECTION_FINALIZED' });
    return;
  }
  await completeSalesContractCorrectionEdit(tx, { contractId, actorUserId: actorId,
    note: specialCredit ? 'قرارداد اعتباری اصلاح‌شده مجدداً تأیید فروش شد.' : 'قرارداد اصلاح‌شده مجدداً قطعی شد.', policyVersion: 2, commercialFinality: true });
};
export const approveOrdinarySales = async (tx: Database, contractId: string, actorId: string, note?: string, expectedRevision?: number) => {
  const contract = await lockOrdinaryContract(tx, contractId);
  if (!isOrdinaryCommercialFlow(contract)) throw new Error('Ordinary commercial flow required');
  assertCommercialActionAvailable(contract);
  const revision = contract.commercialRevision;
  if (expectedRevision !== revision) throw new Error('Contract changed concurrently; reload before saving');
  if (contract.salesApprovalRevision === revision) return contract;
  const status = commercialApprovalStatus(revision, revision, contract.customerAcceptanceRevision);
  if (status === 'SIGNED') await assertContractQuantityEvidenceReadyForFinalization(tx as Prisma.TransactionClient, contractId);
  let updated = await tx.salesContract.update({ where: { id: contractId }, data: {
    salesApprovalRevision: revision, approvedBy: actorId, status,
    signatures: { ...((contract.signatures as any) || {}), approve: { by: actorId, at: new Date().toISOString(), revision, note: note || null } },
  } });
  updated = await authorizeSpecialCustomerCredit(tx, updated, actorId);
  await audit(tx, contractId, actorId, 'COMMERCIAL_SALES_APPROVED', contract, updated, note);
  if (status === 'SIGNED' || hasSpecialCustomerCreditAuthorization(updated)) {
    await finishCommercialCorrection(tx, contractId, actorId, status !== 'SIGNED');
    updated.dispatchExpiryExempt = await ordinaryContractDispatchEligible(tx, updated);
    await tx.salesContract.update({ where: { id: contractId }, data: { dispatchExpiryExempt: updated.dispatchExpiryExempt } });
  }
  return updated;
};
export const markCustomerAcceptance = async (tx: Database, input: {
  contractId: string; revision: number; actorId: string; method: 'DIGITAL' | 'PAPER'; note?: string; sessionId?: string;
}) => {
  const contract = await lockOrdinaryContract(tx, input.contractId);
  if (!isOrdinaryCommercialFlow(contract)) throw new Error('Ordinary commercial flow required');
  assertCommercialActionAvailable(contract);
  if (contract.commercialRevision !== input.revision) throw new Error('Contract changed concurrently; reload before saving');
  if (contract.customerAcceptanceRevision === input.revision) return contract;
  const status = commercialApprovalStatus(input.revision, contract.salesApprovalRevision, input.revision);
  if (status === 'SIGNED') await assertContractQuantityEvidenceReadyForFinalization(tx as Prisma.TransactionClient, contract.id);
  const updated = await tx.salesContract.update({ where: { id: contract.id }, data: {
    customerAcceptanceRevision: input.revision, customerAcceptanceMethod: input.method, status,
    signedAt: new Date(),
    signatures: { ...((contract.signatures as any) || {}), customerAcceptance: {
      method: input.method, by: input.method === 'DIGITAL' ? `customer-confirmation:${input.sessionId}` : input.actorId, revision: input.revision, at: new Date().toISOString(),
      sessionId: input.sessionId || null, note: input.note || null,
    } },
  } });
  await audit(tx, contract.id, input.actorId, `COMMERCIAL_CUSTOMER_${input.method}_ACCEPTED`, contract, updated, input.note);
  if (input.method === 'PAPER') await invalidateCommercialApprovals(tx, contract.id);
  if (status === 'SIGNED') {
    await finishCommercialCorrection(tx, contract.id, input.actorId);
    updated.dispatchExpiryExempt = await ordinaryContractDispatchEligible(tx, updated);
    await tx.salesContract.update({ where: { id: contract.id }, data: { dispatchExpiryExempt: updated.dispatchExpiryExempt } });
  }
  return updated;
};
export const renewOrdinaryContract = async (tx: Database, contractId: string, actorId: string, reason: string) => {
  if (!reason.trim()) throw new Error('دلیل تمدید قرارداد الزامی است.');
  const contract = await lockOrdinaryContract(tx, contractId);
  if (!isOrdinaryCommercialFlow(contract) || contract.firstFinancialRecordAt || contract.isInactive
    || !(contract.status === 'EXPIRED' || commercialDeadlinePassed(contract))) throw new Error('قرارداد قابل تمدید نیست.');
  const duration = contract.commercialExpiryDays || 10;
  const updated = await tx.salesContract.update({ where: { id: contractId }, data: { status: 'DRAFT',
    commercialRevision: { increment: 1 }, salesApprovalRevision: null, customerAcceptanceRevision: null,
    customerAcceptanceMethod: null, approvedBy: null, signedBy: null, signedAt: null,
    isSigned: false, signedByPhoneNumber: null, verificationCodeId: null,
    signatures: { ...((contract.signatures as any) || {}), approve: null, sign: null, customerAcceptance: null, digitalConfirmation: null },
    commercialExpiresAt: new Date(Date.now() + duration * 86_400_000),
  } });
  await invalidateCommercialApprovals(tx, contractId);
  await audit(tx, contractId, actorId, 'COMMERCIAL_EXPIRY_RENEWED', contract, updated, reason.trim());
  return updated;
};
export const expireOrdinaryContracts = async (database: PrismaClient, now = new Date()) => {
  const due = await database.salesContract.findMany({ where: { commercialFlowVersion: 1, partnerKind: null, partnerCaseId: null,
    firstFinancialRecordAt: null, commercialExpiresAt: { lte: now }, status: { notIn: ['CANCELLED', 'EXPIRED'] }, isInactive: false }, select: { id: true } });
  for (const row of due) await database.$transaction(async tx => {
    const contract = await lockOrdinaryContract(tx, row.id);
    const exempt = await ordinaryContractDispatchEligible(tx, contract);
    if (contract.dispatchExpiryExempt !== exempt) await tx.salesContract.update({ where: { id: row.id }, data: { dispatchExpiryExempt: exempt } });
    contract.dispatchExpiryExempt = exempt;
    if (!commercialDeadlinePassed(contract, now) || contract.isInactive || ['CANCELLED', 'EXPIRED'].includes(contract.status)) return;
    const updated = await tx.salesContract.update({ where: { id: row.id }, data: { status: 'EXPIRED' } });
    await invalidateCommercialApprovals(tx, row.id);
    await audit(tx, row.id, 'system:commercial-deadline-expiry', 'COMMERCIAL_DEADLINE_EXPIRED', contract, updated, 'انقضای خودکار مهلت ثبت مالی');
  });
  return due.length;
};
export const startOrdinaryContractExpiry = (database: PrismaClient) => {
  let running = false;
  const run = async () => { if (running) return; running = true;
    try { await withRecoveryBackgroundWrite(async () => { await expireOrdinaryContracts(database); await expireCommercialCorrectionPeriods(database); await processContractCreditReminders(database); }); } catch (error) { console.error('Contract expiry failed:', error); }
    finally { running = false; } };
  void run(); const timer = setInterval(() => void run(), 60_000); timer.unref?.();
  return () => clearInterval(timer);
};

export const expireCommercialCorrectionPeriods = async (database: PrismaClient, now = new Date()) => {
  const due = await database.crossWorkspaceDuty.findMany({ where: { status: 'OPEN', sourceType: 'SALES_CONTRACT_CORRECTION',
    sourceActionCode: 'SALES_EDIT_CONTRACT_CORRECTION', dueAt: { lte: now } }, select: { sourceId: true } });
  for (const duty of due) await database.$transaction(async tx => {
    const correction = await tx.accountingCorrectionRequest.findUnique({ where: { id: duty.sourceId } });
    if (!correction?.contractId || correction.status !== 'APPROVED_FOR_SALES_EDIT') return;
    const identity = await tx.salesContract.findUnique({ where: { id: correction.contractId }, select: { partnerCaseId: true } });
    if (identity?.partnerCaseId) await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${identity.partnerCaseId} FOR UPDATE`;
    const contract = await lockOrdinaryContract(tx, correction.contractId);
    // The contract lock serializes expiry with editor saves. Recheck after
    // waiting: another worker or save may have already advanced this chain.
    const current = await tx.accountingCorrectionRequest.findUnique({ where: { id: correction.id } });
    if (current?.status !== 'APPROVED_FOR_SALES_EDIT') return;
    await completeSalesContractCorrectionEdit(tx, { contractId: contract.id, actorUserId: 'system:commercial-correction-expiry',
      note: 'مهلت ویرایش پایان یافت؛ تغییرات ذخیره‌شده برای بررسی حسابداری حفظ شد. ویرایش بعدی نیاز به تصمیم تازه مدیر دارد.',
      policyVersion: 2, periodExpired: true, now });
  });
};
