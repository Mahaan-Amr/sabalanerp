import express from 'express';
import { prisma } from '../lib/prisma';
import { protect } from '../middleware/auth';
import { Prisma } from '@prisma/client';
import { activeCreditForContract, activeManagerApproval, auditDispatchCredit, canEditCredit, canManageDispatch, createDispatchRequest,
  creditBalance, decideDispatchRequest, dispatchCreditAccess, setSellerCreditLimit } from '../services/contractDispatchCredit';
import { getEffectiveUserAccess } from '../services/effectiveAccessService';
import { createContractDispatchDuty, closeContractDispatchDuty } from '../services/crossWorkspaceDutyAdapters/contractDispatchDutyAdapter';
import { ordinaryContractDispatchEligible } from '../services/ordinaryContractDispatchEligibility';
import { isCommerciallyFinal } from '../services/ordinaryContractLifecycle';

const router = express.Router();
router.use(protect);
const handle = (work: (req: any) => Promise<unknown>) => async (req: any, res: any) => {
  try { res.json({ success: true, data: await work(req) }); }
  catch (error) { res.status(409).json({ success: false, error: error instanceof Error && /[\u0600-\u06ff]/.test(error.message)
    ? error.message : 'عملیات ثبت نشد؛ اطلاعات را تازه‌سازی و دوباره تلاش کنید.' }); }
};
const accessibleContract = async (db: Prisma.TransactionClient | typeof prisma, id: string, actorId: string) => {
  const contract = await db.salesContract.findUniqueOrThrow({ where: { id } });
  const access = await dispatchCreditAccess(db, contract, actorId);
  if (!access.read) throw new Error('دسترسی به این قرارداد ندارید.');
  if (contract.partnerKind || contract.partnerCaseId) throw new Error('این قابلیت مخصوص فروش عادی است.');
  return { contract, access };
};
const refreshExemption = async (db: Prisma.TransactionClient, id: string) => {
  const contract = await db.salesContract.findUniqueOrThrow({ where: { id } });
  const exempt = await ordinaryContractDispatchEligible(db, contract);
  const expired = !exempt && !contract.firstFinancialRecordAt && contract.commercialFlowVersion === 1
    && !!contract.commercialExpiresAt && contract.commercialExpiresAt <= new Date() && !contract.isInactive
    && !['CANCELLED','EXPIRED'].includes(contract.status);
  await db.salesContract.update({ where: { id }, data: { dispatchExpiryExempt: exempt, ...(expired ? { status: 'EXPIRED' } : {}) } });
  if (expired) await auditDispatchCredit(db, id, 'system:dispatch-expiry', 'DISPATCH_EXEMPTION_EXPIRED', id, contract, { status: 'EXPIRED' });
};
router.get('/sellers', handle(async req => {
  if (!await canEditCredit(prisma, req.user.id)) throw new Error('تنظیم اعتبار فقط برای مدیر یا ادمین فروش مجاز است.');
  const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, firstName: true, lastName: true, username: true, role: true } });
  const rows: Array<Record<string, unknown>> = [];
  for (const user of users) {
    const access = await getEffectiveUserAccess(prisma, { userId: user.id, userRole: user.role });
    if (!access.workspaces.some(item => item.workspace === 'sales' && item.permission !== 'view')) continue;
    rows.push({ ...user, ...await creditBalance(prisma, user.id) });
  }
  return rows;
}));
router.put('/sellers/:id', handle(req => prisma.$transaction(tx => setSellerCreditLimit(tx, req.user.id, req.params.id, req.body.limitRials))));
router.get('/balance', handle(async req => {
  let sellerId = req.user.id;
  let contractReservedRials = '0';
  if (!req.query.contractId && req.query.potentialProjectId) {
    const project = await prisma.crmPotentialProject.findUniqueOrThrow({ where: { id: String(req.query.potentialProjectId) }, select: { responsibleSellerId: true } });
    if (project.responsibleSellerId !== req.user.id && !await canEditCredit(prisma, req.user.id)) throw new Error('مصرف اعتبار این پروژه فقط برای فروشنده مسئول یا مدیر فروش مجاز است.');
    sellerId = project.responsibleSellerId;
  }
  if (req.query.contractId) {
    const { contract } = await accessibleContract(prisma, String(req.query.contractId), req.user.id);
    sellerId = contract.responsibleSellerId;
    const credit = await prisma.contractDispatchAuthority.findFirst({ where: { contractId: contract.id, kind: 'CREDIT', status: 'APPROVED', sellerId } });
    if (credit) contractReservedRials = (await activeCreditForContract(prisma, contract)).toString();
  }
  return { ...await creditBalance(prisma, sellerId), contractReservedRials };
}));
router.get('/contracts/:id', handle(async req => {
  const { contract, access } = await accessibleContract(prisma, req.params.id, req.user.id);
  const authorities = await prisma.contractDispatchAuthority.findMany({ where: { contractId: contract.id }, orderBy: { createdAt: 'desc' } });
  const sellers = await prisma.user.findMany({ where: { id: { in: [...new Set([contract.responsibleSellerId, ...authorities.map(row => row.sellerId).filter((id): id is string => !!id)])] } },
    select: { id: true, firstName: true, lastName: true, username: true } });
  const names = new Map(sellers.map(user => [user.id, `${user.firstName} ${user.lastName}`.trim() || user.username]));
  return { authorities: authorities.map(row => ({ ...row, sellerName: row.sellerId ? names.get(row.sellerId) : undefined })),
    actorId: req.user.id, canRequestManager: isCommerciallyFinal(contract) && !['CANCELLED','EXPIRED'].includes(contract.status) && !contract.isInactive,
    responsibleSeller: { id: contract.responsibleSellerId, displayName: names.get(contract.responsibleSellerId) ?? 'فروشنده مسئول' },
    access, eligible: await ordinaryContractDispatchEligible(prisma, contract), balance: await creditBalance(prisma, contract.responsibleSellerId),
    activeManagerId: (await activeManagerApproval(prisma, contract))?.id ?? null };
}));
router.post('/contracts/:id/requests', handle(req => prisma.$transaction(async tx => {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "sales_contracts" WHERE "id"=${req.params.id} FOR UPDATE`);
  const { contract, access } = await accessibleContract(tx, req.params.id, req.user.id);
  const kind = req.body.kind;
  if (!['MANAGER','DATE','TRANSFER'].includes(kind) || !(access.manage || (kind === 'MANAGER' ? access.request : kind === 'DATE' && (access.request || access.seller)))) throw new Error('مجوز ثبت این درخواست ندارید.');
  const request = await createDispatchRequest(tx, contract, req.user.id, req.body);
  await createContractDispatchDuty(tx, request.id);
  if (kind !== 'TRANSFER' && await canManageDispatch(tx, req.user.id)) {
    await decideDispatchRequest(tx, request.id, req.user.id, 'APPROVE', req.body.reason);
    await closeContractDispatchDuty(tx, request.id, req.user.id, 'APPROVE', req.body.reason);
  }
  await refreshExemption(tx, contract.id);
  return request;
})));
router.post('/authorities/:id/actions', handle(req => prisma.$transaction(async tx => {
  const candidate = await tx.contractDispatchAuthority.findUniqueOrThrow({ where: { id: req.params.id } });
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "sales_contracts" WHERE "id"=${candidate.contractId} FOR UPDATE`);
  const { contract, access } = await accessibleContract(tx, candidate.contractId, req.user.id);
  const current = await tx.contractDispatchAuthority.findUniqueOrThrow({ where: { id: candidate.id } });
  const { action, reason } = req.body;
  if (['APPROVE','DECLINE'].includes(action)) {
    await decideDispatchRequest(tx, current.id, req.user.id, action, reason);
    await closeContractDispatchDuty(tx, current.id, req.user.id, action, reason);
  } else {
    const withdraw = action === 'WITHDRAW' && current.status === 'PENDING' && (current.requestedBy === req.user.id || access.manage);
    const revoke = action === 'REVOKE' && current.kind === 'MANAGER' && current.status === 'APPROVED' && access.manage;
    if (!withdraw && !revoke) throw new Error('این اقدام برای درخواست مجاز نیست.');
    if (revoke && !String(reason ?? '').trim()) throw new Error('دلیل لغو مجوز الزامی است.');
    const updated = await tx.contractDispatchAuthority.update({ where: { id: current.id }, data: {
      status: withdraw ? 'WITHDRAWN' : 'REVOKED', decidedBy: req.user.id, reason: reason ?? current.reason } });
    await auditDispatchCredit(tx, contract.id, req.user.id, `DISPATCH_${action}`, current.id, current, updated, reason);
    await closeContractDispatchDuty(tx, current.id, req.user.id, action, reason);
  }
  await refreshExemption(tx, contract.id);
  return { id: current.id };
})));
export default router;
