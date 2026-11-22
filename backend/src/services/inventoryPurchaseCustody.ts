import { Prisma, type PrismaClient } from '@prisma/client';
import { publishInventoryPurchaseOperationalEvidence,publishPurchaseReservationRelease } from './accountingOperationalEvidence';
import { SupplyChainAccountingError } from './accountingSupplyChain';

type Database = Prisma.TransactionClient | PrismaClient;
const D = Prisma.Decimal.clone({ precision: 100 });
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export type PurchaseCustodyShare = { purposeId: string; quantity: string };

/** Inventory owns the event/reservation writes. Caller must be in the authenticated
 * Purchasing transaction, after warehouse-quality authorization and version check.
 * This creates no layer, debt, payment or journal voucher. */
export async function receiveAcceptedPurchase(tx: Prisma.TransactionClient, input: {
  receiptId: string; version: number; actorId: string; quantity: string; unit: string;
  location: string; shares: PurchaseCustodyShare[]; source: unknown;
}) {
  const q = new D(input.quantity);
  if (!q.isPositive() || q.decimalPlaces() > 30 || q.gte('1e35')) throw new SupplyChainAccountingError('INVALID_CUSTODY_QUANTITY', 'مقدار پذیرش انبار معتبر نیست.', 400);
  const identityId = `purchase-receipt:${input.receiptId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${identityId}))`;
  const evidence = await publishInventoryPurchaseOperationalEvidence(tx, {sourceId:input.receiptId, sourceVersion:input.version, sourcePayload:input.source, occurredAt:new Date()});
  const prior = await tx.accountingInventoryEvent.findFirst({where:{sourceType:evidence.type,sourceId:evidence.id,sourceVersion:evidence.version,eventType:'RECEIPT',identityId}});
  if (prior) return {identityId,eventId:prior.id};
  const identity = await tx.accountingInventoryIdentity.upsert({where:{id:identityId},update:{},create:{id:identityId,kind:'PIECE',originId:input.receiptId,valuationMethod:'SPECIFIC_IDENTIFICATION',governedUnit:input.unit}});
  if (identity.governedUnit !== input.unit) throw new SupplyChainAccountingError('INCOMPATIBLE_INVENTORY_UNIT','واحد رسید با هویت موجودی متفاوت است.');
  if (input.shares.reduce((n,s)=>n.plus(s.quantity),new D(0)).gt(q)) throw new SupplyChainAccountingError('RESERVATION_EXCEEDS_RECEIPT','جمع سهم‌های محفوظ از پذیرش بار بیشتر است.');
  const event = await tx.accountingInventoryEvent.create({data:{identityId,eventType:'RECEIPT',warehouseId:'sabalan-warehouse',locationId:input.location||'انبار سبلان',unit:input.unit,quantity:q.toFixed(),sourceType:evidence.type,sourceId:evidence.id,sourceVersion:evidence.version,sourceHash:evidence.hash,sourcePayload:json(evidence.payload),occurredAt:new Date(),statusAfter:input.shares.length?'RESERVED':'AVAILABLE'}});
  for(const [i,share] of input.shares.entries()) {
    if (!new D(share.quantity).isPositive()) continue;
    await tx.accountingInventoryReservation.create({data:{identityId,unit:input.unit,quantity:share.quantity,purposeId:share.purposeId,idempotencyKey:`purchase:${input.receiptId}:${input.version}:${i}`,status:'ACTIVE',evidenceType:evidence.type,evidenceId:evidence.id,evidenceVersion:evidence.version,evidenceHash:evidence.hash,evidencePayload:json(evidence.payload)}});
  }
  return {identityId,eventId:event.id};
}

export async function purchaseCustodyProjection(db: Database, receiptId: string) {
  const identityId=`purchase-receipt:${receiptId}`;
  const [events,reservations,layers]=await Promise.all([
    db.accountingInventoryEvent.findMany({where:{identityId},orderBy:{occurredAt:'asc'}}),
    db.accountingInventoryReservation.findMany({where:{identityId,status:'ACTIVE'}}),
    db.accountingInventoryValuationLayer.count({where:{identityId}}),
  ]);
  if(!events.length)return null;
  const quantity=events.reduce((total,e)=>['RECEIPT','OPENING','TRANSFORMATION_OUTPUT'].includes(e.eventType)?total.plus(e.quantity):['RETURN','SALE_RELIEF','TRANSFORMATION_INPUT'].includes(e.eventType)?total.minus(e.quantity):total,new D(0));
  const reserved=reservations.reduce((total,r)=>total.plus(r.quantity),new D(0));
  return {identityId,quantity:quantity.toFixed(),reserved:reserved.toFixed(),free:D.max(0,quantity.minus(reserved)).toFixed(),unit:events[0].unit,valued:layers>0,reservations:reservations.map(r=>({id:r.id,purposeId:r.purposeId,quantity:r.quantity.toFixed()}))};
}

/** Return requires the exact affected purpose shares; active protection is never
 * borrowed from another contract. Valued/consumed stock is reversed by Accounting. */
export async function returnAcceptedPurchase(tx: Prisma.TransactionClient,input:{receiptId:string;version:number;actorId:string;quantity:string;shares:PurchaseCustodyShare[];source:unknown}) {
  const identityId=`purchase-receipt:${input.receiptId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${identityId}))`;
  const projection=await purchaseCustodyProjection(tx,input.receiptId);
  if(!projection)return null; // Legacy receipt has no inferred inventory backfill.
  const consumed=await tx.accountingInventoryLayerConsumption.count({where:{identityId}});
  if(projection.valued||consumed)throw new SupplyChainAccountingError('ACCOUNTING_RETURN_REQUIRED','این بار دارای ارزش‌گذاری یا مصرف ثبت‌شده است؛ برگشت را با حسابداری و انبار تعیین تکلیف کنید.');
  if(await tx.accountingInventoryEvent.count({where:{identityId,eventType:'MOVEMENT'}}))throw new SupplyChainAccountingError('INVENTORY_MOVED_RETURN_REQUIRED','محل این بار در انبار تغییر کرده است؛ برگشت را از محل فعلی و مسیر انبار ثبت کنید.');
  if(new D(input.quantity).gt(projection.quantity))throw new SupplyChainAccountingError('INSUFFICIENT_CUSTODY','مقدار برگشت از موجودی همین رسید بیشتر است.');
  const evidence=await publishInventoryPurchaseOperationalEvidence(tx,{sourceId:input.receiptId,sourceVersion:input.version,sourcePayload:input.source,occurredAt:new Date()});
  for(const share of input.shares) {
    let remaining=new D(share.quantity);
    const candidates=await tx.accountingInventoryReservation.findMany({where:{identityId,purposeId:share.purposeId,status:'ACTIVE'},orderBy:{createdAt:'asc'}});
    if(candidates.reduce((n,r)=>n.plus(r.quantity),new D(0)).lt(remaining))throw new SupplyChainAccountingError('RESERVATION_CHANGED','سهم محفوظ این قرارداد تغییر کرده است؛ رزرو و مصرف انبار را بررسی کنید.');
    for(const reservation of candidates) {
      if(!remaining.isPositive())break;
      const take=D.min(remaining,reservation.quantity),rest=new D(reservation.quantity).minus(take);remaining=remaining.minus(take);
      await tx.accountingInventoryReservation.update({where:{id:reservation.id},data:{status:'RELEASED',releasedAt:new Date(),releasedBy:input.actorId,releaseEvidenceType:evidence.type,releaseEvidenceId:evidence.id,releaseEvidenceVersion:evidence.version,releaseEvidenceHash:evidence.hash,releaseEvidencePayload:json(evidence.payload)}});
      if(rest.isPositive())await tx.accountingInventoryReservation.create({data:{identityId,unit:reservation.unit,quantity:rest.toFixed(),purposeId:reservation.purposeId,idempotencyKey:`purchase-return:${input.receiptId}:${input.version}:${reservation.id}`,status:'ACTIVE',evidenceType:evidence.type,evidenceId:evidence.id,evidenceVersion:evidence.version,evidenceHash:evidence.hash,evidencePayload:json(evidence.payload)}});
    }
  }
  const released=input.shares.reduce((n,s)=>n.plus(s.quantity),new D(0));
  if(new D(input.quantity).minus(released).gt(projection.free))throw new SupplyChainAccountingError('PROTECTED_STOCK','این مقدار برای قرارداد دیگری محفوظ است؛ سهم برگشت را مشخص کنید.');
  const first=await tx.accountingInventoryEvent.findFirstOrThrow({where:{identityId,eventType:'RECEIPT'},orderBy:{occurredAt:'asc'}});
  const event=await tx.accountingInventoryEvent.create({data:{identityId,eventType:'RETURN',warehouseId:first.warehouseId,locationId:first.locationId,unit:first.unit,quantity:input.quantity,sourceType:evidence.type,sourceId:evidence.id,sourceVersion:evidence.version,sourceHash:evidence.hash,sourcePayload:json(evidence.payload),occurredAt:new Date(),statusAfter:new D(projection.quantity).eq(input.quantity)?'CONSUMED':'AVAILABLE'}});
  return {eventId:event.id,identityId};
}

export async function releasePurchaseProtection(tx:Prisma.TransactionClient,input:{receiptId:string;requestId:string;version:number;actorId:string;purposeId:string;quantity:string;source:unknown}) {
  const identityId=`purchase-receipt:${input.receiptId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${identityId}))`;
  const evidence=await publishPurchaseReservationRelease(tx,{sourceId:`purchase:${input.requestId}:${input.receiptId}`,sourceVersion:input.version,sourcePayload:input.source,occurredAt:new Date()});
  const reservations=await tx.accountingInventoryReservation.findMany({where:{identityId,purposeId:input.purposeId,status:'ACTIVE'},orderBy:{createdAt:'asc'}});
  let remaining=new D(input.quantity);
  if(reservations.reduce((n,r)=>n.plus(r.quantity),new D(0)).lt(remaining))throw new SupplyChainAccountingError('RESERVATION_CHANGED','سهم محفوظ این رسید تغییر کرده است؛ رزرو و مصرف انبار را بررسی کنید.');
  for(const reservation of reservations) {
    if(!remaining.isPositive())break;
    const take=D.min(remaining,reservation.quantity),rest=new D(reservation.quantity).minus(take);remaining=remaining.minus(take);
    await tx.accountingInventoryReservation.update({where:{id:reservation.id},data:{status:'RELEASED',releasedAt:new Date(),releasedBy:input.actorId,releaseEvidenceType:evidence.type,releaseEvidenceId:evidence.id,releaseEvidenceVersion:evidence.version,releaseEvidenceHash:evidence.hash,releaseEvidencePayload:json(evidence.payload)}});
    if(rest.isPositive())await tx.accountingInventoryReservation.create({data:{identityId,unit:reservation.unit,quantity:rest.toFixed(),purposeId:reservation.purposeId,idempotencyKey:`purchase-release:${input.requestId}:${input.version}:${reservation.id}`,status:'ACTIVE',evidenceType:evidence.type,evidenceId:evidence.id,evidenceVersion:evidence.version,evidenceHash:evidence.hash,evidencePayload:json(evidence.payload)}});
  }
  return {identityId,quantity:input.quantity};
}
