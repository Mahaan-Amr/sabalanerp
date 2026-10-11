import { Prisma, type PrismaClient, type SalesContract } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { RequestEvidenceMeta } from '../utils/requestEvidence';
import { getEffectiveUserAccess } from './effectiveAccessService';
import { validateContractAccess } from './contractService';
import { commercialStartFields, invalidateCommercialApprovals, lockOrdinaryContract } from './ordinaryContractLifecycle';
import { synchronizeSellerCredit } from './contractDispatchCredit';
import { closeContractDispatchDuty } from './crossWorkspaceDutyAdapters/contractDispatchDutyAdapter';

type Database = PrismaClient | Prisma.TransactionClient;
export class OrdinaryContractReactivationError extends Error {}
export const readOrdinaryFinancialRegistration = async (tx: Database, contract: Pick<SalesContract, 'id' | 'firstFinancialRecordAt'>) => {
  if (contract.firstFinancialRecordAt) return contract.firstFinancialRecordAt;
  const record = await tx.accountingFinancialRecord.findFirst({ where: { contractId: contract.id }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
  const historical = await tx.accountingAuditLog.findFirst({ where: { contractId: contract.id,
    action: { in: ['CREATE_INVOICE', 'CREATE_RECEIVABLE', 'APPROVE_FINANCIAL_INVOICE', 'DELETE_DRAFT_ACCOUNTING_RECORD'] } },
    orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
  const dates = [historical?.createdAt, record?.createdAt].filter((date): date is Date => !!date);
  return dates.length ? new Date(Math.min(...dates.map(date => date.getTime()))) : null;
};

export const readOrdinaryCancellationTime = async (tx: Database, contract: Pick<SalesContract, 'id' | 'signatures' | 'updatedAt'>) => {
  const at = (contract.signatures as any)?.cancellation?.at;
  if (typeof at === 'string' && Number.isFinite(Date.parse(at))) return new Date(at);
  return (await tx.contractConfirmationAuditLog.findFirst({ where: { contractId: contract.id, eventType: 'CONTRACT_CANCELLED' },
    orderBy: { createdAt: 'desc' }, select: { createdAt: true } }))?.createdAt || contract.updatedAt;
};

export const readOrdinaryReactivationActions = async (tx: Database, contract: Omit<SalesContract, 'contractData'>, actorId: string, now = new Date()) => {
  const unavailable = { canReactivate: false, canCreateReplacement: false, requiresAccountingAuthorization: false,
    expectedRevision: contract.commercialRevision, reason: '', correctionId: null as string | null, correctionDutyId: null as string | null };
  if (contract.partnerKind || contract.partnerCaseId || contract.status !== 'CANCELLED' || contract.isInactive) return unavailable;
  const actor = await tx.user.findUnique({ where: { id: actorId } });
  if (!actor || !actor.isActive || !validateContractAccess(contract, actor)) return unavailable;
  const access = await getEffectiveUserAccess(tx, { userId: actor.id, userRole: actor.role, at: now });
  const workspace = actor.role === 'ADMIN' || access.workspaces.some(item => item.workspace === 'sales' && ['edit', 'admin'].includes(item.permission));
  const permitted = (feature: string) => actor.role === 'ADMIN' || access.features.some(item => item.feature === feature && ['edit', 'admin'].includes(item.permission));
  const financialAt = await readOrdinaryFinancialRegistration(tx, contract);
  const expired = !financialAt && !!contract.commercialExpiresAt && contract.commercialExpiresAt <= now;
  if (expired) return { ...unavailable, canCreateReplacement: workspace && permitted('sales_contracts_create'),
    reason: 'مهلت قرارداد لغوشده گذشته است؛ از این اطلاعات قرارداد جدید بسازید.' };
  if (!workspace || !permitted('sales_contracts_edit')) return { ...unavailable, reason: 'فعال‌سازی به مجوز ویرایش قرارداد در فروش نیاز دارد.' };
  let opportunity: { id: string; sourceId: string } | null = null;
  if (financialAt) {
    const cancelledAt = await readOrdinaryCancellationTime(tx, contract);
    const corrections = await tx.accountingCorrectionRequest.findMany({ where: { contractId: contract.id, status: 'APPROVED_FOR_SALES_EDIT' }, select: { id: true } });
    opportunity = await tx.crossWorkspaceDuty.findFirst({ where: { sourceType: 'SALES_CONTRACT_CORRECTION',
      sourceId: { in: corrections.map(item => item.id) }, sourceActionCode: 'SALES_EDIT_CONTRACT_CORRECTION', status: 'OPEN',
      createdAt: { gt: cancelledAt }, dueAt: { gt: now },
      ...(actor.role === 'ADMIN' ? {} : { currentAssigneeUserId: actor.id }) }, select: { id: true, sourceId: true } });
  }
  return { ...unavailable, canReactivate: !financialAt || !!opportunity, requiresAccountingAuthorization: !!financialAt,
    reason: financialAt && !opportunity ? 'برای فعال‌سازی، مجوز تازه اصلاح را از پرونده حسابداری دریافت کنید.' : '',
    correctionId: opportunity?.sourceId || null, correctionDutyId: opportunity?.id || null };
};

export const reactivateOrdinaryContract = (database: Database, input: {
  contractId: string; actorId: string; reason: string; expectedRevision: number; meta?: RequestEvidenceMeta;
}) => {
  const work = async (tx: Prisma.TransactionClient) => {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 1000) throw new OrdinaryContractReactivationError('دلیل فعال‌سازی باید بین ۳ تا ۱۰۰۰ نویسه باشد.');
  const contract = await lockOrdinaryContract(tx, input.contractId);
  if (contract.commercialRevision !== input.expectedRevision || contract.status !== 'CANCELLED') throw new OrdinaryContractReactivationError('وضعیت قرارداد تغییر کرده است؛ صفحه را تازه کنید.');
  const now = new Date();
  const actions = await readOrdinaryReactivationActions(tx, contract, input.actorId, now);
  if (!actions.canReactivate) throw new OrdinaryContractReactivationError(actions.reason || 'فعال‌سازی این قرارداد مجاز نیست.');
  const financialAt = await readOrdinaryFinancialRegistration(tx, contract);
  const signatures = (contract.signatures as any) || {};
  const revision = contract.commercialRevision + 1;
  const before = JSON.parse(JSON.stringify(contract));
  const updated = await tx.salesContract.update({ where: { id: contract.id }, data: {
    ...(!contract.commercialExpiresAt && !financialAt ? await commercialStartFields(tx, now) : {}),
    ...(contract.commercialExpiresAt ? { commercialExpiresAt: contract.commercialExpiresAt,
      commercialExpiryDays: contract.commercialExpiryDays } : {}),
    firstFinancialRecordAt: financialAt, commercialFlowVersion: 1, commercialRevision: revision,
    status: 'DRAFT', salesApprovalRevision: null, customerAcceptanceRevision: null, customerAcceptanceMethod: null,
    approvedBy: null, signedBy: null, signedAt: null, isSigned: false, signedByPhoneNumber: null, verificationCodeId: null,
    customerCreditRevision: null, dispatchExpiryExempt: false, lostAt: null,
    signatures: { ...signatures, approve: null, sign: null, customerAcceptance: null, digitalConfirmation: null,
      approvalHistory: [...(Array.isArray(signatures.approvalHistory) ? signatures.approvalHistory : []),
        { at: now.toISOString(), revision: contract.commercialRevision, approve: signatures.approve || null,
          sign: signatures.sign || null, customerAcceptance: signatures.customerAcceptance || null,
          digitalConfirmation: signatures.digitalConfirmation || null }],
      reactivationHistory: [...(Array.isArray(signatures.reactivationHistory) ? signatures.reactivationHistory : []),
        { by: input.actorId, at: now.toISOString(), reason, cancellation: signatures.cancellation || null,
          correctionDutyId: actions.correctionDutyId || null, revision }],
      reactivation: { by: input.actorId, at: now.toISOString(), reason, revision, reportingSuspended: true,
        correctionDutyId: actions.correctionDutyId || null } },
  } });
  await invalidateCommercialApprovals(tx, contract.id);
  const authorities = await tx.contractDispatchAuthority.findMany({ where: { contractId: contract.id,
    revision: { not: revision }, OR: [{ kind: 'MANAGER', status: { in: ['PENDING', 'APPROVED'] } },
      { kind: { in: ['DATE', 'TRANSFER', 'CUSTOMER_DATE'] }, status: 'PENDING' }] } });
  for (const authority of authorities) {
    await tx.contractDispatchAuthority.update({ where: { id: authority.id }, data: { status: 'SUPERSEDED' } });
    await closeContractDispatchDuty(tx, authority.id, input.actorId, 'SUPERSEDED', 'قرارداد پس از لغو به یادداشت برگشت.');
    await tx.accountingAuditLog.create({ data: { contractId: contract.id, actorId: input.actorId,
      action: 'DISPATCH_AUTHORITY_SUPERSEDED', entityType: 'ContractDispatchAuthority', entityId: authority.id,
      beforeState: JSON.parse(JSON.stringify(authority)), afterState: { status: 'SUPERSEDED' }, note: reason } });
  }
  await synchronizeSellerCredit(tx, updated, input.actorId);
  await tx.accountingAuditLog.create({ data: { contractId: contract.id, actorId: input.actorId,
    action: 'COMMERCIAL_CONTRACT_REACTIVATED', entityType: 'SalesContract', entityId: contract.id,
    beforeState: before, afterState: JSON.parse(JSON.stringify(updated)), note: reason } });
  const evidence = { by: input.actorId, at: now.toISOString(), reason, revision, restoredStatus: 'DRAFT',
    correctionDutyId: actions.correctionDutyId, cancellationAt: (signatures.cancellation as any)?.at || null };
  await tx.contractConfirmationAuditLog.create({ data: { contractId: contract.id,
    eventType: 'CONTRACT_REACTIVATED', eventPayloadJson: evidence, ...input.meta,
    eventHash: createHash('sha256').update(JSON.stringify(evidence)).digest('hex') } });
  return { contractId: updated.id, status: updated.status, commercialRevision: revision };
  };
  return '$transaction' in database ? database.$transaction(work) : work(database);
};
