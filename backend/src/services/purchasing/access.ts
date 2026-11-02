import { Prisma, type PrismaClient } from '@prisma/client';
import { getEffectiveUserAccess } from '../effectiveAccessService';
import { PurchasingError, type Doc } from './domain';
export type Actor = { id: string; role: string };
export type Access = { actorId: string; manager: boolean; buyer: boolean; receiver: boolean; accountant: boolean; requester: boolean; prices: boolean; all: boolean };
export async function accessFor(db: PrismaClient | Prisma.TransactionClient, actor: Actor): Promise<Access> {
  const [effective, partner] = await Promise.all([getEffectiveUserAccess(db, { userId: actor.id, userRole: actor.role }), db.partnerProfile.findUnique({ where: { userId: actor.id }, select: { id: true } })]);
  if (partner) throw new PurchasingError('PARTNER_SELF_SERVICE_DENIED', 'درخواست خرید بیرونی باید توسط کاربر داخلی سبلان ثبت شود.', 403);
  const level = (workspace: string) => effective.workspaces.find(x => x.workspace === workspace)?.permission;
  const edit = (workspace: string) => ['edit', 'admin'].includes(level(workspace) || '');
  const manager = ['ADMIN', 'MANAGER'].includes(actor.role) || level('purchasing') === 'admin';
  // Financial source access follows accounting's explicit grant, including for ADMIN.
  const [directAccounting, roleAccounting] = await Promise.all([db.workspacePermission.findUnique({ where: { userId_workspace: { userId: actor.id, workspace: 'accounting' } } }), db.roleWorkspacePermission.findUnique({ where: { role_workspace: { role: actor.role, workspace: 'accounting' } } })]);
  const accountingGrant = directAccounting?.isActive && (!directAccounting.expiresAt || directAccounting.expiresAt > new Date()) ? directAccounting : roleAccounting?.isActive ? roleAccounting : null;
  const buyer = manager || edit('purchasing'), receiver = manager || edit('inventory'), accountant = ['edit', 'admin'].includes(accountingGrant?.permissionLevel || '');
  const requester = buyer || receiver || Boolean(level('sales'));
  if (!requester && !accountant && !level('purchasing') && !level('inventory')) throw new PurchasingError('PURCHASING_ACCESS_DENIED', 'دسترسی فضای خرید برای شما فعال نیست؛ با مدیر سامانه پیگیری کنید.', 403);
  return { actorId: actor.id, manager, buyer, receiver, accountant, requester, prices: buyer || accountant, all: buyer || receiver || accountant || manager };
}
export const assertCapability = (allowed: boolean, message = 'مجوز انجام این کار را ندارید؛ از مسئول خرید یا مدیریت پیگیری کنید.') => { if (!allowed) throw new PurchasingError('PURCHASING_PERMISSION_REQUIRED', message, 403); };
export function purchasingSections(access: Access) {
  return ['requests','inquiries','changes',...(access.all?['orders','receipts','exchanges','suppliers','inventory']:[]),...(access.prices?['finance']:[])];
}
export async function canReadDocument(db: Prisma.TransactionClient | PrismaClient, access: Access, doc: Doc) {
  if(['ADVANCE','ACCOUNTING_HANDOFF','SUPPLIER_IDENTITY_LINK'].includes(doc.kind)&&!access.prices)return false;
  if (access.all) return true;
  if (doc.contractId) {
    const contract = await db.salesContract.findUnique({ where: { id: doc.contractId }, select: { responsibleSellerId: true } });
    return contract?.responsibleSellerId === access.actorId;
  }
  if (['REQUEST','INQUIRY','INQUIRY_CASE','CHANGE'].includes(doc.kind) && (doc.creatorId === access.actorId || doc.ownerId === access.actorId)) return true;
  return false;
}
export function redact(doc: Doc, access: Access): Doc {
  if (access.prices) return doc;
  const data = { ...doc.data };
  if(data.lastAttachment?.visibility==='COMMERCIAL')delete data.lastAttachment;
  for (const key of ['price', 'costs', 'paymentTerms', 'invoiceNumber', 'historicalEvidence', 'supplierContact', 'advanceAmount', 'notesFinancial', 'priceHistory','replanHistory']) delete data[key];
  // Request comments are business-visible; commercial agreements stay within purchasing/accounting.
  if (!['REQUEST','CHANGE'].includes(doc.kind)) delete data.notes;
  if (doc.kind === 'CHANGE') delete data.resolution;
  if (data.offers) data.offers = data.offers.map(({ price, freight, terms, confirmations, ...safe }: Record<string, unknown>) => safe);
  if (data.inquirySelection) data.inquirySelection = data.inquirySelection.map(({ price, offerSnapshot,specReview, ...safe }: Record<string, unknown>) => safe);
  if(data.selection)data.selection=data.selection.map(({specReview,...safe}:Record<string,unknown>)=>safe);
  if(data.converted)data.converted=data.converted.map((row:any)=>({...row,splits:(row.splits||[]).map(({specReview,...safe}:Record<string,unknown>)=>safe)}));
  if (Array.isArray(data.quoteHistory)) data.quoteHistory = data.quoteHistory.map(({ price: _price, ...rest }: Record<string, unknown>) => rest);
  if(Array.isArray(data.quoteTerms))data.quoteTerms=data.quoteTerms.map(({freight,paymentTerms,...safe}:Record<string,unknown>)=>safe);
  return { ...doc, data };
}
