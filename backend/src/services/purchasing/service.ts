import { createPurchasingInquiryDuty, closePurchasingInquiryDuty, reassignPurchasingInquiryDuty } from '../crossWorkspaceDutyAdapters/purchasingInquiryDutyAdapter';
import { inquiryCommand, bindInquiryOrder, validateOfferPriceRanges, contractPurchaseSource, offerValid } from './contractEntry';
import { startInquiryCase } from './inquiryCase';
import { acceptedPurchaseShares, recordAcceptedCustody, returnedPurchaseShares, mergeAcceptedShares } from './custody';
import { purchasingAccountingCommand } from './accounting';
import { transferSurplus } from './surplus';
import { attachmentCommand } from './attachments';
import { historicalPurchase } from './historical';
import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { publishNotificationEvent } from '../notificationService';
import { accessFor, assertCapability, canReadDocument, redact, type Actor, type Access } from './access';
import { Decimal, PurchasingError, add, sub, gt, min, max, quantity, optionalQuantity, proportionalQuantity, money, text, required, date, label, receiptProgress, exchangeProgress, orderProgress, type Doc, type JsonObject } from './domain';
import { asDoc, document, graph, createDocument, updateDocument, hash, json, type Tx } from './repository';

import { contractSource } from './source';

const terminal = (s: string) => ['CANCELLED', 'EXPIRED', 'VOID'].includes(s);
const ensureOpen = (doc: Doc) => { if (terminal(doc.status)) throw new PurchasingError('DOCUMENT_CLOSED', 'این سند بسته یا لغو شده است؛ سابقه آن را بررسی کنید.'); };
const sum = (docs: Doc[], field: string) => add(...docs.map(d => d.data[field] || '0'));
const available = (value: string, limit: string, field = 'quantity') => { if (gt(value, limit)) throw new PurchasingError('QUANTITY_EXCEEDED', `مقدار از مانده ${limit} بیشتر است؛ مقدار یا سوابق قبلی را بررسی کنید.`, 409, field); };
const internalBuyer = async (tx: Tx, id: string) => { const user = await tx.user.findUnique({ where: { id }, select: { id: true, role: true, isActive: true } }); if (!user?.isActive || !(await accessFor(tx, user)).buyer) throw new PurchasingError('INVALID_BUYER', 'مسئول پیگیری باید کاربر فعالِ دارای اختیار خرید باشد.', 400, 'ownerId'); return id; };
export async function contactsFor(tx: Tx | typeof prisma, customerId: string) {
  const customer = await tx.crmCustomer.findUnique({ where: { id: customerId }, include: { contacts: { where: { isActive: true } }, phoneNumbers: { where: { isActive: true } } } });
  if (!customer || !customer.isActive || customer.cardDeletedAt) return [];
  const result = customer.customerType === 'Individual' ? [{ id: `customer:${customer.id}`, name: `${customer.firstName} ${customer.lastName}`.trim(), role: 'مشتری', phone: customer.phoneNumbers[0]?.number || null }] : [];
  result.push(...customer.contacts.map(c => ({ id: `contact:${c.id}`, name: `${c.firstName} ${c.lastName}`.trim(), role: c.position || 'نماینده مشتری', phone: c.mobile || c.phone })));
  if (customer.projectManagerName) result.push({ id: `project-manager:${customer.id}`, name: customer.projectManagerName, role: 'مدیر پروژه', phone: customer.projectManagerNumber });
  return result;
}
async function visibleRequest(tx: Tx, a: Access, id: string) { const doc = await document(tx, id, 'REQUEST'); assertCapability(await canReadDocument(tx, a, doc)); return doc; }
async function notify(tx: Tx, doc: Doc, actor: Actor) {
  const recipients = new Set([doc.ownerId, doc.creatorId]);
  if (doc.parentId) { const parent = await tx.purchasingDocument.findUnique({ where: { id: doc.parentId } }); if (parent) { recipients.add(parent.ownerId); recipients.add(parent.creatorId); } }
  const allocations = doc.kind === 'ORDER' ? doc.data.allocations || [] : doc.kind === 'RECEIPT' && doc.parentId ? (await document(tx, doc.parentId)).data.allocations || [] : [];
  for (const allocation of allocations) { const request = await tx.purchasingDocument.findUnique({ where: { id: allocation.requestId } }); if (request) { recipients.add(request.ownerId); recipients.add(request.creatorId); await publishNotificationEvent(tx, { type: 'PURCHASING_UPDATED', deduplicationKey: `purchasing:${doc.id}:${doc.version}:request:${request.id}`, recipientIds: [...new Set([request.creatorId, request.ownerId])], actorId: actor.id, workspace: 'purchasing', resourceType: 'PURCHASING_DOCUMENT', resourceId: request.id, actionUrl: `/dashboard/purchasing?document=${request.id}`, payload: {} }); } }
  const active = await tx.user.findMany({ where: { id: { in: [...recipients] }, isActive: true }, select: { id: true } });
  const destination = ['INQUIRY', 'INQUIRY_CASE'].includes(doc.kind) ? '/dashboard/purchasing/inquiries' : '/dashboard/purchasing';
  await publishNotificationEvent(tx, { type: 'PURCHASING_UPDATED', deduplicationKey: `purchasing:${doc.id}:${doc.version}`, recipientIds: active.map(u => u.id), actorId: actor.id, workspace: 'purchasing', resourceType: 'PURCHASING_DOCUMENT', resourceId: doc.id, actionUrl: `${destination}?document=${encodeURIComponent(doc.id)}`, payload: {} });
}
async function requestCommand(tx: Tx, actor: Actor, a: Access, input: JsonObject) {
  assertCapability(a.requester);
  if (!input.documentId) throw new PurchasingError('INQUIRY_REQUIRED', 'درخواست تازه باید از پیشنهادهای منتخب استعلام ثبت شود؛ از «استعلام جدید» ادامه دهید.', 409);
  const reason = input.reason === 'stock' ? 'stock' : 'contract';
  let contractId: string | null = null, customerId: string | null = null;
  let stone = text(input.stone), unit = text(input.unit);
  let sourceQuantity: string | null = null, sourceVersion: number | null = null;
  if (reason === 'contract') {
    contractId = required(input.contractId, 'contractId', 'قرارداد');
    const { contract, item, sourceVersion: version } = await contractSource(tx, a, contractId, required(input.itemId, 'itemId', 'ردیف قرارداد'));
    customerId = contract.customerId; sourceQuantity = item.quantity.toFixed(); sourceVersion = version; unit = item.unit;
    stone = item.description || item.product.namePersian || item.product.name;
  }
  if (reason === 'stock') { stone = required(stone, 'stone', 'مشخصات اولیه سنگ'); unit = required(unit, 'unit', 'واحد'); }
  const q = optionalQuantity(input.quantity);
  if (q && sourceQuantity) available(q, sourceQuantity);
  const ownerId = await internalBuyer(tx, text(input.ownerId) || (a.buyer ? actor.id : ''));
  const data = { reason, stone, unit, quantity: q, itemId: reason === 'contract' ? text(input.itemId) : null, sourceQuantity, sourceVersion, dimensions: text(input.dimensions), notes: text(input.notes), date: date(input.date), raw: input.raw === true };
  if (!input.documentId) return createDocument(tx, actor.id, 'REQUEST', data, { ownerId, contractId, customerId });
  const doc = await visibleRequest(tx, a, input.documentId); ensureOpen(doc);
  assertCapability(a.manager || doc.creatorId === actor.id);
  const links = await tx.purchasingLink.count({ where: { targetId: doc.id, purpose: 'ALLOCATION' } });
  if (links) throw new PurchasingError('CHANGE_REQUEST_REQUIRED', 'برای این درخواست سفارش ثبت شده است؛ درخواست تغییر یا لغو ثبت کنید.');
  if (doc.contractId !== contractId) throw new PurchasingError('SOURCE_IMMUTABLE', 'برای تغییر قرارداد مبدأ، درخواست تازه ایجاد کنید.');
  if (doc.data.inquirySelection) {
    if(data.stone!==doc.data.stone||data.unit!==doc.data.unit||data.raw!==Boolean(doc.data.raw)||data.dimensions!==text(doc.data.dimensions))throw new PurchasingError('INQUIRY_RESELECTION_REQUIRED','مشخصات قلم دارای پیشنهاد منتخب از این فرم تغییر نمی‌کند؛ استعلام منطبق را بررسی کنید.');
    if (doc.data.itemId !== data.itemId || doc.data.sourceVersion !== data.sourceVersion || !q || gt(q, doc.data.quantity)) throw new PurchasingError('INQUIRY_RESELECTION_REQUIRED', 'برای تغییر ردیف یا افزایش مقدار، سهم تازه را از استعلام معتبر به درخواست تبدیل کنید.');
    const purchaseQuantity=doc.data.purchaseQuantity?quantity(proportionalQuantity(q,doc.data.quantity,doc.data.purchaseQuantity)):q;
    let remaining = purchaseQuantity;
    Object.assign(data,{specKey:doc.data.specKey,...(doc.data.purchaseQuantity?{purchaseQuantity,purchaseUnit:doc.data.purchaseUnit,purchaseStone:doc.data.purchaseStone,conversionBase:doc.data.conversionBase,sourceSpecKey:doc.data.sourceSpecKey}:{}),inquirySelection:doc.data.inquirySelection.map((split:JsonObject)=>{const take=min(remaining,split.quantity);remaining=sub(remaining,take);return {...split,quantity:take};}).filter((s:JsonObject)=>gt(s.quantity,'0'))});
  }
  return updateDocument(tx, actor.id, doc, 'REQUEST_EDITED', {...doc.data,...data}, input.expectedVersion, { ownerId });
}
async function orderCommand(tx: Tx, actor: Actor, a: Access, input: JsonObject) {
  assertCapability(a.buyer);
  const occurredAt = input.historical === true ? date(required(input.occurredAt, 'occurredAt', 'تاریخ واقعی خرید'))! : new Date().toISOString();
  if (input.historical === true && new Date(`${occurredAt}T00:00:00+03:30`).getTime() > Date.now()) throw new PurchasingError('FUTURE_HISTORICAL_DATE', 'تاریخ خرید انجام‌شده نمی‌تواند در آینده باشد.', 400, 'occurredAt');
  const q = quantity(input.quantity), unit = required(input.unit, 'unit', 'واحد خرید'), stone = required(input.stone, 'stone', 'قلم خرید');
  const supplier = await tx.purchasingSupplier.findUnique({ where: { id: required(input.supplierId, 'supplierId', 'تأمین‌کننده') } });
  if (!supplier?.isActive) throw new PurchasingError('INVALID_SUPPLIER', 'تأمین‌کننده فعال را انتخاب کنید.', 400, 'supplierId');
  const rawAllocations = Array.isArray(input.allocations) ? input.allocations : [{ requestId: input.requestId, quantity: input.demandQuantity || q, purchaseQuantity: q, conversionConfirmed: input.conversionConfirmed }];
  if (!rawAllocations.length || rawAllocations.length > 100) throw new PurchasingError('ALLOCATION_REQUIRED', 'سهم نیازهای این خرید را مشخص کنید.', 400, 'allocations');
  const allocations: JsonObject[] = [], seen = new Set<string>();
  let customerId: string | null = null, ownerId = actor.id, historicalException = false;
  let specKey:string|null=null,technical:JsonObject|null=null;
  for (const raw of rawAllocations) {
    const requestId = required(raw.requestId, 'requestId', 'درخواست خرید');
    if (seen.has(requestId)) throw new PurchasingError('DUPLICATE_ALLOCATION', 'سهم یک درخواست را فقط یک بار در سفارش وارد کنید.'); seen.add(requestId);
    const request = await visibleRequest(tx, a, requestId); ensureOpen(request); if (!allocations.length) ownerId = request.ownerId;
    let currentSourceQuantity: string | null = null;
    const demand = quantity(raw.quantity, 'demandQuantity'), purchase = quantity(raw.purchaseQuantity || raw.quantity, 'purchaseQuantity');
    if ((request.data.unit !== unit || demand !== purchase) && !raw.conversionConfirmed) throw new PurchasingError('CONVERSION_REQUIRED', 'واحد خرید با نیاز متفاوت است؛ مقدار هر دو واحد و رابطه تبدیل را صریح تأیید کنید.', 400, 'conversionConfirmed');
    if (request.contractId) {
      try { const source = await contractSource(tx, a, request.contractId, request.data.itemId, true, input.historical === true ? new Date(`${occurredAt}T23:59:59.999+03:30`) : undefined); currentSourceQuantity = source.item.quantity.toFixed(); available(demand, currentSourceQuantity, 'demandQuantity'); }
      catch (error) { if (input.historical === true && error instanceof PurchasingError && error.code === 'FINANCIAL_RECORD_REQUIRED') { historicalException = true; currentSourceQuantity = (await contractSource(tx, a, request.contractId, request.data.itemId, false)).item.quantity.toFixed(); } else throw error; }
      customerId = customerId && customerId !== request.customerId ? null : request.customerId;
    }
    const related = request.contractId ? await tx.purchasingDocument.findMany({ where: { kind: 'REQUEST', contractId: request.contractId } }) : [request];
    const ids = related.filter(r => !request.contractId || docDataCompatible(r, request)).map(r => r.id);
    const links = await tx.purchasingLink.findMany({ where: { targetId: { in: ids }, purpose: 'ALLOCATION', source: { status: { not: 'VOID' } } } });
    const committed = add(...links.map(l => l.quantity?.toFixed()), ...allocations.filter(x => ids.includes(x.requestId)).map(x => x.quantity));
    const ownCommitted = add(...links.filter(l => l.targetId === request.id).map(l => l.quantity?.toFixed()));
    if (request.data.quantity) available(demand, max('0', sub(request.data.quantity, ownCommitted)), 'demandQuantity');
    if (request.contractId && currentSourceQuantity) available(demand, max('0', sub(currentSourceQuantity, committed)), 'demandQuantity');
    if (request.data.quantity == null) await updateDocument(tx, actor.id, request, 'REQUEST_QUANTITY_FIXED', { ...request.data, quantity: demand }, request.version);
    if (request.data.inquirySelection && request.contractId && (await contractPurchaseSource(tx,a,request.contractId,request.data.itemId)).specKey !== (request.data.sourceSpecKey || request.data.specKey)) throw new PurchasingError('OFFER_SPEC_CHANGED','مشخصات جاری ردیف قرارداد با پیشنهاد منتخب تغییر کرده است؛ انطباق آن را از مسئول خرید پیگیری کنید.');
    if (request.data.inquirySelection && stone !== (request.data.purchaseStone || request.data.stone)) throw new PurchasingError('OFFER_SPEC_CHANGED', 'قلم خرید با پیشنهاد منتخب متفاوت است؛ ابتدا پیشنهاد منطبق را تعیین تکلیف کنید.');
    if(request.data.inquirySelection) {
      if(specKey&&specKey!==request.data.specKey)throw new PurchasingError('ORDER_SPEC_MISMATCH','نیازهایی با مشخصات خرید متفاوت را در یک قلم سفارش تجمیع نکنید؛ برای هر مشخصات سفارش جدا ثبت کنید.',400,'allocations');
      specKey=request.data.specKey;
      technical=request.data.purchaseTechnical||(!request.data.raw?request.data.technical:null)||(await document(tx,request.data.inquirySelection[0].inquiryId,'INQUIRY')).data.technical;
    }
    if (request.data.purchaseQuantity) {
      const usedPurchase=add(...links.filter(l=>l.targetId===request.id).map(l=>(l.data as JsonObject).purchaseQuantity));
      const remainingPurchase=max('0',sub(request.data.purchaseQuantity,usedPurchase));
      const expected=purchase===remainingPurchase?max('0',sub(request.data.quantity,ownCommitted)):proportionalQuantity(purchase,request.data.purchaseQuantity,request.data.quantity);
      if(demand!==expected)throw new PurchasingError('CONVERSION_MISMATCH',`این مقدار خرید برابر با ${expected} ${request.data.unit} از نیاز ثبت‌شده است؛ مقدار تأمین نیاز را اصلاح کنید.`,400,'demandQuantity');
    } else if(request.data.inquirySelection && purchase!==demand) throw new PurchasingError('OFFER_SPEC_CHANGED','مقدار خرید با سهم پیشنهاد منتخب متفاوت است.');
    const quoteBindings = await bindInquiryOrder(tx, request, supplier.id, purchase, unit, money(input.price), allocations.flatMap(x => x.quoteBindings || []));
    allocations.push({ quoteBindings, requestId, quantity: demand, purchaseQuantity: purchase, unit: request.data.unit, contractId: request.contractId, customerId: request.customerId, itemId: request.data.itemId, conversionConfirmed: raw.conversionConfirmed === true });
  }
  if (add(...allocations.map(x => x.purchaseQuantity)) !== q) throw new PurchasingError('ALLOCATION_SUM_MISMATCH', 'جمع مقدار خریدِ سهم‌ها باید دقیقاً برابر مقدار سفارش باشد.', 400, 'allocations');
  await validateOfferPriceRanges(tx,allocations.flatMap(a=>a.quoteBindings || []));
  const allocationCustomers = [...new Set(allocations.map(x => x.customerId).filter(Boolean))] as string[];
  if(input.route==='direct'&&allocations.some(x=>!x.contractId||!x.customerId))throw new PurchasingError('DIRECT_CONTRACT_REQUIRED','ارسال مستقیم به مشتری باید از سهم قرارداد واقعی همان مشتری باشد؛ نیاز انبار را به مسیر انبار ثبت کنید.',400,'route');
  customerId = allocationCustomers.length === 1 ? allocationCustomers[0] : null;
  const destinations = input.route === 'direct' && allocationCustomers.length ? await tx.crmCustomer.findMany({ where: { id: { in: allocationCustomers } }, select: { id: true, firstName: true, lastName: true, companyName: true, address: true, workAddress: true, phoneNumbers: { where: { isActive: true }, select: { number: true }, take: 1 } } }).then(rows => rows.map(c => ({ customerId: c.id, name: `${c.firstName} ${c.lastName}`.trim() || c.companyName, address: c.workAddress || c.address, phone: c.phoneNumbers[0]?.number || null }))) : [];
  const costs = (Array.isArray(input.costs) ? input.costs : []).map((c: JsonObject) => ({ title: required(c.title, 'costs', 'عنوان هزینه'), recipientId: required(c.recipientId, 'costs', 'دریافت‌کننده هزینه'), amount: quantity(c.amount, 'costs', true) }));
  for (const cost of costs) if (!await tx.purchasingSupplier.findUnique({ where: { id: cost.recipientId } })) throw new PurchasingError('COST_RECIPIENT_REQUIRED', 'دریافت‌کننده هزینه جانبی را از طرف‌های موجود انتخاب کنید.');
  const quoteTerms:JsonObject[]=[];
  for(const binding of allocations.flatMap(x=>x.quoteBindings||[])) {
    const inquiry=await document(tx,binding.inquiryId,'INQUIRY'),offer=(inquiry.data.offers||[]).find((o:JsonObject)=>o.id===binding.offerId);
    quoteTerms.push({...binding,variant:offer.variant,paymentTerms:offer.terms,freight:offer.freight,readyDate:offer.readyDate,arrivalDate:offer.arrivalDate,readyLeadDays:offer.readyLeadDays??null,arrivalLeadDays:offer.arrivalLeadDays??null,offerDate:offer.offerDate||null,leadBasis:offer.leadBasis||'ORDER_CONFIRMATION',dayKind:offer.dayKind||'unspecified'});
  }
  const promisedDates=[...new Set(quoteTerms.map(t=>t.arrivalDate).filter(Boolean))];
  const promisedDate=date(input.date)|| (promisedDates.length===1?promisedDates[0]:null);
  if(input.date&&promisedDates.some(d=>d!==input.date))throw new PurchasingError('OFFER_DELIVERY_CHANGED','موعد واردشده با پیشنهاد منتخب متفاوت است؛ ابتدا تأیید موعد تازه را در پیشنهاد تأمین‌کننده ثبت کنید.',400,'date');
  const paymentTerms=quoteTerms.some(t=>t.paymentTerms)?quoteTerms.map(t=>`${t.quantity} ${unit}${t.variant?` (${t.variant})`:''}: ${t.paymentTerms||'شرایط پرداخت تعیین نشده'}`).join('؛ '):text(input.paymentTerms);
  const doc = await createDocument(tx, actor.id, 'ORDER', { stone, specKey, technical, quantity: q, unit, price: money(input.price), supplierId: supplier.id, supplierName: supplier.name, allocations, costs, destinations,quoteTerms, route: input.route === 'direct' ? 'direct' : 'warehouse', date: promisedDate, notes: text(input.notes), paymentTerms, historical: input.historical === true, occurredAt, exception: historicalException ? 'FINANCIAL_RECORD_MISSING_AT_CAPTURE' : null }, { ownerId, customerId });
  for (const allocation of allocations) await tx.purchasingLink.create({ data: { sourceId: doc.id, targetId: allocation.requestId, purpose: 'ALLOCATION', quantity: allocation.quantity, unit: allocation.unit, data: json({ purchaseQuantity: allocation.purchaseQuantity, purchaseUnit: unit, quoteBindings: allocation.quoteBindings }) } });
  const quoteTotals = new Map<string, {inquiryId:string;offerId:string;quantity:string}>();
  for (const b of allocations.flatMap(x => x.quoteBindings || [])) {const key = `${b.inquiryId}:${b.offerId}`, prior = quoteTotals.get(key); quoteTotals.set(key,{...b,quantity:add(prior?.quantity,b.quantity)});}
  for (const b of quoteTotals.values()) await tx.purchasingLink.create({data:{sourceId:doc.id,targetId:b.inquiryId,purpose:`QUOTE:${b.offerId}`,quantity:b.quantity,unit,data:json({})}});
  return doc;
}
function docDataCompatible(row: { data: unknown }, request: Doc) { return (row.data as JsonObject).itemId === request.data.itemId; }
async function receiptCommand(tx: Tx, actor: Actor, a: Access, input: JsonObject) {
  const order = await document(tx, required(input.orderId, 'orderId', 'سفارش خرید'), 'ORDER'); ensureOpen(order);
  assertCapability(order.data.route === 'direct' ? a.buyer : a.receiver, order.data.route === 'direct' ? 'تأیید تحویل مستقیم را مسئول خرید ثبت می‌کند.' : 'ثبت دریافت انبار در اختیار انباردار یا مدیریت است.');
  const docs = await graph(tx, order.id), q = quantity(input.quantity);
  let exchange: Doc | null = null;
  if (input.exchangeId) { exchange = await document(tx, input.exchangeId, 'EXCHANGE'); if (exchange.data.orderId !== order.id) throw new PurchasingError('EXCHANGE_ORDER_MISMATCH', 'پرونده تعویض مربوط به این سفارش نیست.'); }
  const remaining = exchange ? exchangeProgress(exchange, docs).remaining : orderProgress(order, docs).remaining;
  available(q, remaining);
  const accepted = input.existingOnly === true ? '0' : input.quality === 'all' ? q : input.quality === 'partial' ? quantity(input.accepted, 'accepted', true) : '0'; available(accepted, q, 'accepted');
  let recipient: JsonObject | null = null, customerId: string | null = order.customerId;
  if (order.data.route === 'direct') {
    const customerIds = [...new Set([...(order.data.allocations || []).map((x: JsonObject) => x.customerId),...(order.data.captureOnly&&order.customerId?[order.customerId]:[])].filter(Boolean))] as string[];
    customerId = required(input.customerId || (customerIds.length === 1 ? customerIds[0] : ''), 'customerId', 'مشتری مقصد');
    if (customerIds.length && !customerIds.includes(customerId)) throw new PurchasingError('DESTINATION_MISMATCH', 'مشتری مقصد باید متعلق به سهم‌های همین سفارش باشد.', 400, 'customerId');
    if (exchange && exchange.customerId !== customerId) throw new PurchasingError('EXCHANGE_DESTINATION_MISMATCH', 'بار جایگزین باید برای همان مشتریِ رسید اصلی ثبت شود.', 400, 'customerId');
    if (!exchange && customerIds.length) {
      const assigned = add(...(order.data.allocations || []).filter((x: JsonObject) => x.customerId === customerId).map((x: JsonObject) => x.purchaseQuantity));
      const already = add(...docs.filter(x => x.kind === 'RECEIPT' && !x.data.exchangeId && x.customerId === customerId).map(x => x.data.quantity));
      available(q, max('0', sub(assigned, already)));
    }
    recipient = (await contactsFor(tx, customerId)).find(x => x.id === input.recipientId) || null;
    if (!recipient) throw new PurchasingError('RECIPIENT_REQUIRED', 'تأییدکننده را از اطلاعات ثبت‌شده همین مشتری انتخاب کنید.', 400, 'recipientId');
  }
  const acceptedShares=await acceptedPurchaseShares(tx,order,accepted,customerId);
  const receipt=await createDocument(tx, actor.id, 'RECEIPT', { quantity: q, accepted, acceptedShares, existingOnly: input.existingOnly === true, rejected: '0', returned: '0', acceptedReturned: '0', exchangeId: exchange?.id || null, recipient, unit: order.data.unit, stone: order.data.stone, route: order.data.route, occurredAt: new Date().toISOString(), notes: text(input.notes), location: text(input.location) || (order.data.route === 'direct' ? 'مقصد مشتری' : 'انبار سبلان') }, { parentId: order.id, ownerId: order.ownerId, customerId });
  const inventory=await recordAcceptedCustody(tx,actor.id,receipt,accepted,acceptedShares);
  return inventory?updateDocument(tx,actor.id,receipt,'CUSTODY_LINKED',{...receipt.data,inventory},receipt.version):receipt;
}
async function dispositionCommand(tx: Tx, actor: Actor, a: Access, type: string, input: JsonObject) {
  const receipt = await document(tx, required(input.receiptId, 'receiptId', 'رسید بار'), 'RECEIPT'), order = await document(tx, receipt.parentId!, 'ORDER');
  assertCapability(type === 'ACCEPT' ? (a.receiver && receipt.data.route === 'warehouse') || a.buyer && receipt.data.route === 'direct' || a.manager : a.buyer || type === 'REJECT' && a.receiver);
  if (receipt.data.existingOnly && type === 'ACCEPT') throw new PurchasingError('HISTORICAL_ACCEPTANCE_LINK_REQUIRED', 'این دریافت قبلاً ثبت شده است؛ پذیرش آن را با اتصال سابقه معتبر انبار مشخص کنید، نه با پذیرش تازه.');
  const docs = await graph(tx, order.id), p = receiptProgress(receipt, docs), q = quantity(input.quantity);
  const limit = type === 'ACCEPT' || type === 'REJECT' ? p.pending : type === 'RETURN' ? p.toReturn : type === 'EXCHANGE' ? p.toExchange : max('0', sub(sub(receipt.data.accepted, receipt.data.acceptedReturned || '0'),receipt.data.movedToWarehouse||'0'));
  if (!gt(limit, '0')) throw new PurchasingError('NO_REMAINING_QUANTITY', type === 'RETURN' ? 'مقدار ردشدهٔ برگشت‌نخورده‌ای باقی نمانده است؛ برگشت را دوباره ثبت نکنید.' : type === 'EXCHANGE' ? 'برای مقدار ردشده قبلاً تعویض ثبت شده است؛ پرونده موجود را پیگیری کنید.' : 'مقداری برای این اقدام باقی نمانده است؛ سوابق کیفیت و برگشت را بررسی کنید.');
  available(q, limit);
  if (input.expectedVersion !== receipt.version) throw new PurchasingError('VERSION_CONFLICT', 'وضعیت رسید تغییر کرده است؛ اطلاعات تازه را بررسی کنید.');
  if (type === 'EXCHANGE') { const exchange = await createDocument(tx, actor.id, 'EXCHANGE', { quantity: q, orderId: order.id, unit: receipt.data.unit, stone: receipt.data.stone, supplierId: order.data.supplierId, supplierName: order.data.supplierName, notes: text(input.notes), date: date(input.date) }, { parentId: receipt.id, ownerId: order.ownerId, customerId: receipt.customerId });
    await updateDocument(tx, actor.id, receipt, 'EXCHANGE_AGREED', { ...receipt.data, exchangeIds: [...(receipt.data.exchangeIds || []), exchange.id] }, input.expectedVersion);
    return exchange; }
  const data = { ...receipt.data }, field = ({ ACCEPT: 'accepted', REJECT: 'rejected', RETURN: 'returned', RETURN_ACCEPTED: 'acceptedReturned' } as Record<string, string>)[type];
  if (!field) throw new PurchasingError('INVALID_ACTION', 'عملیات انتخاب‌شده معتبر نیست.', 400);
  if (type === 'REJECT' || type === 'RETURN_ACCEPTED') data.lastReason = required(input.reason, 'reason', 'علت');
  if ((type === 'RETURN' || type === 'RETURN_ACCEPTED') && input.physicalConfirmed !== true) throw new PurchasingError('PHYSICAL_RETURN_REQUIRED', 'برگشت را فقط پس از خروج واقعی کالا تأیید کنید.', 400, 'physicalConfirmed');
  if (type === 'RETURN_ACCEPTED') {
    // Consumption is never inferred. Operators must clear existing custody/reservation effects first.
    const linked = await tx.purchasingExistingEvidence.count({ where: { documentId: receipt.id } });
    if (linked) throw new PurchasingError('EXISTING_EFFECT_REVIEW_REQUIRED', 'این رسید به اثر قبلی انبار یا حسابداری متصل است؛ ابتدا برگشت همان اثر را از مسیر مالک آن ثبت کنید.');
    const returned=await returnedPurchaseShares(tx,actor.id,receipt,q,input);
    if(returned){data.acceptedShares=returned.shares;data.lastInventoryReturn=returned.effect;}
  }
  if(type==='ACCEPT') {
    const shares=await acceptedPurchaseShares(tx,order,q,receipt.customerId);
    data.acceptedShares=mergeAcceptedShares([...(data.acceptedShares||[]),...shares]);
    const inventory=await recordAcceptedCustody(tx,actor.id,{...receipt,version:receipt.version+1,data},q,shares);
    if(inventory)data.inventory=inventory;
  }
  data[field] = add(data[field] || '0', q);
  if (type === 'RETURN_ACCEPTED') { data.rejected = add(data.rejected || '0', q); data.returned = add(data.returned || '0', q); }
  if (input.notes) data.lastNotes = text(input.notes);
  return updateDocument(tx, actor.id, receipt, type, data, input.expectedVersion);
}
async function supplierCommand(tx: Tx, actor: Actor, a: Access, input: JsonObject) {
  assertCapability(a.buyer);
  let customerId: string | null = text(input.customerId) || null, accountingPartyId: string | null = text(input.accountingPartyId) || null;
  let name = text(input.name), contact = text(input.contact);
  if (customerId) { const c = await tx.crmCustomer.findUnique({ where: { id: customerId }, include: { phoneNumbers: { where: { isActive: true } } } }); if (!c || !c.isActive || c.cardDeletedAt) throw new PurchasingError('CUSTOMER_NOT_FOUND', 'طرف‌حساب انتخاب‌شده فعال نیست.'); name = `${c.firstName} ${c.lastName}`.trim() || c.companyName || ''; contact ||= c.phoneNumbers[0]?.number || ''; }
  if (accountingPartyId) { const p = await tx.accountingParty.findUnique({ where: { id: accountingPartyId } }); if (!p || p.activeTo && p.activeTo < new Date()) throw new PurchasingError('PARTY_NOT_FOUND', 'طرف‌حساب حسابداری فعال نیست.'); name = p.displayName; if (p.sourceKind === 'CUSTOMER') customerId = p.sourceId; }
  required(name, 'name', 'نام تأمین‌کننده'); required(contact, 'contact', 'راه ارتباطی');
  if (!customerId && !accountingPartyId) {
    const existing = await tx.phoneNumber.findFirst({ where: { number: contact, isActive: true } });
    if (existing) customerId = existing.customerId;
  }
  if (customerId && !accountingPartyId) {
    const parties = await tx.accountingParty.findMany({ where: { sourceKind: 'CUSTOMER', sourceId: customerId, OR: [{ activeTo: null }, { activeTo: { gt: new Date() } }] }, select: { id: true }, take: 2 });
    if (parties.length === 1) accountingPartyId = parties[0].id;
  }
  const identityKey = customerId ? `CRM:${customerId}` : accountingPartyId ? `ACCOUNTING:${accountingPartyId}` : `CONTACT:${contact.replace(/\s/g, '')}:${name}`;
  const prior = await tx.purchasingSupplier.findUnique({ where: { identityKey } }) || (accountingPartyId ? await tx.purchasingSupplier.findFirst({where:{accountingPartyId}}) : null);
  if (prior?.accountingPartyId && accountingPartyId && prior.accountingPartyId !== accountingPartyId) throw new PurchasingError('SUPPLIER_PARTY_CONFLICT', 'این تأمین‌کننده قبلاً به طرف‌حساب دفتر دیگری متصل شده است؛ تطبیق هویت را از حسابداری پیگیری کنید.');
  return tx.purchasingSupplier.upsert({ where: { identityKey:prior?.identityKey||identityKey }, update: accountingPartyId && !prior?.accountingPartyId ? { accountingPartyId } : {}, create: { identityKey, customerId, accountingPartyId, name, contact, createdBy: actor.id } });
}
async function existingCommand(tx: Tx, actor: Actor, a: Access, input: JsonObject) {
  assertCapability(a.manager || a.accountant);
  const doc = await document(tx, required(input.documentId, 'documentId', 'سند خرید'));
  const sourceType = required(input.sourceType, 'sourceType', 'نوع سابقه'), sourceId = required(input.sourceId, 'sourceId', 'سابقه موجود');
  assertCapability(sourceType === 'INVENTORY_EVENT' ? a.receiver : a.accountant, 'اتصال سوابق مالی به مجوز صریح حسابداری و اتصال موجودی به مجوز انبار نیاز دارد.');
  const source = sourceType === 'SUPPLIER_INVOICE' ? await tx.accountingSupplierInvoice.findUnique({ where: { id: sourceId } }) : sourceType === 'PAYMENT' ? await tx.accountingSupplierSettlementTransaction.findUnique({ where: { id: sourceId } }) : sourceType === 'INVENTORY_EVENT' ? await tx.accountingInventoryEvent.findUnique({ where: { id: sourceId } }) : null;
  if (!source) throw new PurchasingError('SOURCE_NOT_FOUND', 'سابقه معتبر موجود پیدا نشد؛ شناسه را از انبار یا حسابداری دریافت کنید.', 404, 'sourceId');
  const order = doc.kind === 'ORDER' ? doc : doc.parentId ? await document(tx, doc.parentId, 'ORDER') : null;
  if (!order?.data.historical && !['RECEIPT', 'ADVANCE'].includes(doc.kind)) throw new PurchasingError('HISTORICAL_LINK_REQUIRED', 'اتصال سابقه از پرونده خرید انجام‌شده یا رسید مشخص انجام می‌شود.');
  const supplier = order?.data.supplierId ? await tx.purchasingSupplier.findUnique({ where: { id: order.data.supplierId } }) : null;
  if ('supplierPartyId' in source && (!supplier?.accountingPartyId || supplier.accountingPartyId !== source.supplierPartyId)) throw new PurchasingError('SUPPLIER_IDENTITY_MISMATCH', 'طرف‌حساب سابقه با تأمین‌کننده خرید منطبق نیست؛ ابتدا هویت تأمین‌کننده را تطبیق دهید.');
  const existing = await tx.purchasingExistingEvidence.findUnique({ where: { sourceType_sourceId: { sourceType, sourceId } } });
  if (existing) throw new PurchasingError('EVIDENCE_ALREADY_LINKED', 'این سابقه قبلاً به پرونده خرید متصل شده است؛ اثر یا اتصال تکراری ایجاد نشد.');
  if (sourceType === 'INVENTORY_EVENT') {
    if (doc.kind !== 'RECEIPT') throw new PurchasingError('RECEIPT_REQUIRED', 'سابقه انبار باید به یک رسید مشخص متصل شود.');
    if ('eventType' in source && !['RECEIPT', 'OPENING'].includes(String(source.eventType))) throw new PurchasingError('INVENTORY_SOURCE_MISMATCH', 'فقط سابقه ورود یا موجودی ابتدای دوره می‌تواند مرجع دریافت قبلی باشد.');
    if ('quantity' in source && (new Decimal(String(source.quantity)).toFixed() !== doc.data.quantity || 'unit' in source && source.unit !== doc.data.unit)) throw new PurchasingError('INVENTORY_SOURCE_MISMATCH', 'مقدار یا واحد رسید با سابقه انبار برابر نیست؛ تطبیق را بررسی کنید.');
    if (gt(doc.data.accepted || '0', '0') && !doc.data.existingOnly) throw new PurchasingError('EXISTING_RECEIPT_REQUIRED', 'برای جلوگیری از اثر تکراری، رسیدِ دارای پذیرش تازه را به دریافت قدیمی متصل نکنید؛ ابتدا رسید تاریخی بدون اثر تازه ثبت کنید.');
  }
  await tx.purchasingExistingEvidence.create({ data: { documentId: doc.id, sourceType, sourceId, sourceHash: hash(source), snapshot: json(source), createdBy: actor.id } });
  return updateDocument(tx, actor.id, doc, 'EXISTING_EVIDENCE_LINKED', { ...doc.data, ...(sourceType === 'INVENTORY_EVENT' && 'statusAfter' in source && ['AVAILABLE', 'RESERVED'].includes(String(source.statusAfter)) ? { accepted: doc.data.quantity } : {}), ...(doc.kind === 'ADVANCE' && sourceType === 'PAYMENT' ? { paymentStatus: 'EXISTING_PAYMENT_LINKED' } : {}), linkedEvidence: [...(doc.data.linkedEvidence || []), { sourceType, sourceId }] }, input.expectedVersion);
}
async function closeOrderRemainder(tx: Tx, actor: Actor, doc: Doc, input: JsonObject) {
  const p = orderProgress(doc, await graph(tx, doc.id)); let closed = p.remaining;
  if (!gt(closed, '0')) throw new PurchasingError('NO_REMAINING_QUANTITY', 'باقی سفارش قبلاً بسته یا دریافت شده است؛ اقدام دوباره لازم نیست.');
  const effective: JsonObject[] = [...(doc.data.effectiveAllocations || doc.data.allocations || [])].map((x: JsonObject) => ({ ...x, quoteBindings: (x.quoteBindings || []).map((b:JsonObject)=>({...b})) }));
  for (const allocation of [...effective].reverse()) {
    if (!gt(allocation.purchaseQuantity, '0')) continue;
    const cut = min(closed, allocation.purchaseQuantity); closed = sub(closed, cut);
    const remainingPurchase = sub(allocation.purchaseQuantity, cut);
    let quoteCut = cut;
    for (const binding of [...(allocation.quoteBindings || [])].reverse()) {const release = min(quoteCut,binding.quantity);quoteCut=sub(quoteCut,release);binding.quantity=sub(binding.quantity,release);const link=await tx.purchasingLink.findUnique({where:{sourceId_targetId_purpose:{sourceId:doc.id,targetId:binding.inquiryId,purpose:`QUOTE:${binding.offerId}`}}});if(link?.quantity) await tx.purchasingLink.update({where:{id:link.id},data:{quantity:max('0',sub(link.quantity.toFixed(),release))}});if(quoteCut==='0')break;}
    allocation.quantity = proportionalQuantity(remainingPurchase,allocation.purchaseQuantity,allocation.quantity,'ceil');
    allocation.purchaseQuantity = remainingPurchase;
    await tx.purchasingLink.updateMany({ where: { sourceId: doc.id, targetId: allocation.requestId, purpose: 'ALLOCATION' }, data: { quantity: allocation.quantity, data: json({ purchaseQuantity: remainingPurchase, purchaseUnit: doc.data.unit, quoteBindings: allocation.quoteBindings || [] }) } });
    if (closed === '0') break;
  }
  return updateDocument(tx, actor.id, doc, 'CLOSE_REMAINDER', { ...doc.data, effectiveAllocations: effective, closedQuantity: add(doc.data.closedQuantity || '0', p.remaining), closeNotes: text(input.notes) }, input.expectedVersion);
}
async function miscellaneous(tx: Tx, actor: Actor, a: Access, type: string, input: JsonObject) {
  const doc = await document(tx, required(input.documentId, 'documentId', 'پرونده'));
  assertCapability(await canReadDocument(tx, a, doc));
  if (type === 'CHANGE') {
    assertCapability(a.requester); return createDocument(tx, actor.id, 'CHANGE', { requestedAction: input.requestedAction === 'CANCEL' ? 'CANCEL' : 'EDIT', notes: required(input.notes, 'notes', 'شرح تغییر'), resolution: null }, { parentId: doc.id, contractId: doc.contractId, customerId: doc.customerId, ownerId: doc.ownerId });
  }
  if (type === 'ASSIGN') {
    assertCapability(a.manager);
    const ownerId = await internalBuyer(tx, required(input.ownerId, 'ownerId', 'مسئول جدید'));
    if (doc.kind === 'INQUIRY_CASE') {
      const lines = (await tx.purchasingDocument.findMany({ where: { parentId: doc.id, kind: 'INQUIRY', status: 'OPEN' } })).map(asDoc);
      for (const line of lines) {
        await updateDocument(tx, actor.id, line, type, { ...line.data, priorOwnerId: line.ownerId }, line.version, { ownerId });
        await reassignPurchasingInquiryDuty(tx, line.id, actor.id, ownerId);
      }
    }
    return updateDocument(tx, actor.id, doc, type, { ...doc.data, priorOwnerId: doc.ownerId }, input.expectedVersion, { ownerId });
  }
  if (type === 'QUOTE') {
    assertCapability(a.buyer); ensureOpen(doc);
    return updateDocument(tx, actor.id, doc, type, { ...doc.data, quoteHistory: [...(doc.data.quoteHistory || []), { price: money(input.price), quantity: optionalQuantity(input.quantity), readyDate: date(input.readyDate), arrivalDate: date(input.date), result: text(input.result), replacement: text(input.replacement), createdAt: new Date().toISOString(), actorId: actor.id }] }, input.expectedVersion);
  }
  if (type === 'PRICE') {
    assertCapability(a.buyer);ensureOpen(doc);if(doc.kind!=='ORDER')throw new PurchasingError('ORDER_REQUIRED','قیمت توافقی باید برای سفارش خرید ثبت شود.');
    const costs=Array.isArray(input.costs)?input.costs.map((c:JsonObject)=>({title:required(c.title,'costs','عنوان هزینه'),recipientId:required(c.recipientId,'costs','دریافت‌کننده هزینه'),amount:quantity(c.amount,'costs',true)})):doc.data.costs||[];
    for(const cost of costs)if(!await tx.purchasingSupplier.findUnique({where:{id:cost.recipientId}}))throw new PurchasingError('COST_RECIPIENT_REQUIRED','دریافت‌کننده واقعی هر هزینه جانبی را انتخاب کنید.');
    return updateDocument(tx,actor.id,doc,type,{...doc.data,price:money(input.price),costs,priceHistory:[...(doc.data.priceHistory||[]),{price:doc.data.price,costs:doc.data.costs||[],changedAt:new Date().toISOString(),actorId:actor.id}]},input.expectedVersion);
  }
  if (type === 'CANCEL') {
    assertCapability(a.manager || doc.kind === 'REQUEST' && doc.creatorId === actor.id);
    ensureOpen(doc);
    const reason=required(input.reason,'reason','علت لغو');
    if(doc.kind==='ORDER') {
      assertCapability(a.manager);
      return closeOrderRemainder(tx,actor,doc,{...input,notes:reason});
    }
    if(doc.kind==='INQUIRY_CASE' || doc.kind==='INQUIRY') {
      assertCapability(a.manager);
      if(doc.kind==='INQUIRY_CASE') {
        const children=(await tx.purchasingDocument.findMany({where:{kind:'INQUIRY',parentId:doc.id,status:'OPEN'}})).map(asDoc);
        for(const child of children)await updateDocument(tx,actor.id,child,'CANCEL',{...child.data,cancelReason:reason},child.version,{status:'CANCELLED'});
      }
      return updateDocument(tx,actor.id,doc,type,{...doc.data,cancelReason:reason},input.expectedVersion,{status:'CANCELLED'});
    }
    const linked = await tx.purchasingLink.count({ where: { targetId: doc.id, purpose: 'ALLOCATION' } });
    if (doc.kind !== 'REQUEST' || linked) throw new PurchasingError('CHANGE_REQUIRED', 'برای تعهد ایجادشده، درخواست تغییر یا لغو و نتیجه واقعی تأمین‌کننده را ثبت کنید؛ سابقه حذف نمی‌شود.');
    return updateDocument(tx, actor.id, doc, type, {...doc.data,cancelReason:reason}, input.expectedVersion, { status: 'CANCELLED' });
  }
  if (type === 'CLOSE_REMAINDER') { assertCapability(a.buyer); if (doc.kind !== 'ORDER') throw new PurchasingError('ORDER_REQUIRED', 'سفارش خرید را انتخاب کنید.'); return closeOrderRemainder(tx, actor, doc, input); }
  if (type === 'RESOLVE_CHANGE') { assertCapability(a.buyer); if (doc.kind !== 'CHANGE') throw new PurchasingError('CHANGE_REQUIRED', 'درخواست تغییر را انتخاب کنید.'); return updateDocument(tx, actor.id, doc, type, { ...doc.data, resolution: required(input.notes, 'notes', 'نتیجه واقعی'), resolvedAt: new Date().toISOString() }, input.expectedVersion, { status: 'RESOLVED' }); }
  if (type === 'ADVANCE') { assertCapability(a.buyer); if (doc.kind !== 'ORDER') throw new PurchasingError('ORDER_REQUIRED', 'سفارش خرید را انتخاب کنید.'); return createDocument(tx, actor.id, 'ADVANCE', { amount: quantity(input.amount, 'amount'), currency: 'تومان', supplierId: doc.data.supplierId, notes: text(input.notes), paymentStatus: 'REQUESTED' }, { parentId: doc.id, ownerId: doc.ownerId }); }
  throw new PurchasingError('INVALID_ACTION', 'عملیات انتخاب‌شده معتبر نیست.', 400);
}
export async function executePurchasingInTransaction(tx: Tx, actor: Actor, key: string, type: string, input: JsonObject) {
  if (!/^[A-Za-z0-9:_-]{16,100}$/.test(key)) throw new PurchasingError('COMMAND_KEY_REQUIRED', 'شناسه ثبت معتبر نیست؛ فرم را باز نگه دارید و دوباره تلاش کنید.', 400);
  const commandHash = hash({ type, input:type==='ATTACHMENT_UPLOAD'?{...input,bytes:undefined}:input });

    // One bounded operational graph lock also protects cross-request allocations.
    // No locks or transactions escape this module; unrelated ERP workflows remain independent.
    await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('sabalan-purchasing-v1'))`;
    const prior = await tx.purchasingCommand.findUnique({ where: { actorId_key: { actorId: actor.id, key } } });
    const a = await accessFor(tx, actor);
    if (!prior && (['ACCEPT', 'REJECT', 'RETURN', 'RETURN_ACCEPTED', 'EXCHANGE', 'ASSIGN', 'QUOTE', 'PRICE', 'CANCEL', 'CLOSE_REMAINDER', 'RESOLVE_CHANGE', 'LINK_EXISTING'].includes(type) || type === 'REQUEST' && input.documentId) && (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1)) throw new PurchasingError('VERSION_REQUIRED', 'نسخه پرونده مشخص نیست؛ اطلاعات تازه را دریافت و دوباره ثبت کنید.', 409);
    if (prior) {
      if (prior.hash !== commandHash) throw new PurchasingError('IDEMPOTENCY_CONFLICT', 'این شناسه قبلاً برای اطلاعات دیگری استفاده شده است؛ نتیجه ثبت قبلی را بررسی کنید.');
      const result=prior.result as JsonObject;
      if(result.supplier)assertCapability(a.buyer);
      if(result.id)assertCapability(await canReadDocument(tx,a,await document(tx,result.id)));
      return prior.result;
    }
    let result: unknown;
    if (type === 'SUPPLIER') result = { supplier: await supplierCommand(tx, actor, a, input) };
    else {
      const doc = type==='ATTACHMENT_UPLOAD' ? await attachmentCommand(tx,actor,a,input) : type==='STOCK_SURPLUS' ? await transferSurplus(tx,actor,a,input) : type==='HISTORICAL_PURCHASE' ? await historicalPurchase(tx,actor,a,input) : type.startsWith('ACCOUNTING_') ? await purchasingAccountingCommand(tx,actor,a,type,input) : type === 'INQUIRY_START' ? await startInquiryCase(tx, actor, a, input) : type.startsWith('INQUIRY_') ? await inquiryCommand(tx, actor, a, type, input) : type === 'REQUEST' ? await requestCommand(tx, actor, a, input) : type === 'ORDER' ? await orderCommand(tx, actor, a, input) : type === 'RECEIPT' ? await receiptCommand(tx, actor, a, input) : ['ACCEPT', 'REJECT', 'RETURN', 'EXCHANGE', 'RETURN_ACCEPTED'].includes(type) ? await dispositionCommand(tx, actor, a, type, input) : type === 'LINK_EXISTING' ? await existingCommand(tx, actor, a, input) : await miscellaneous(tx, actor, a, type, input);
      if (type === 'INQUIRY_CREATE') await createPurchasingInquiryDuty(tx, doc, actor.id);
      if (type === 'INQUIRY_START') {
        const lines = await tx.purchasingDocument.findMany({ where: { parentId: doc.id, kind: 'INQUIRY' } });
        for (const line of lines) await createPurchasingInquiryDuty(tx, line, actor.id);
      }
      if (type === 'INQUIRY_OFFER' && (doc.data.offers || []).some(offerValid)) await closePurchasingInquiryDuty(tx, doc.id, actor.id, 'COMPLETED');
      if (type === 'ASSIGN' && doc.kind === 'INQUIRY') await reassignPurchasingInquiryDuty(tx, doc.id, actor.id, doc.ownerId);
      if (type === 'CANCEL' && doc.kind === 'INQUIRY') await closePurchasingInquiryDuty(tx, doc.id, actor.id, 'CANCELLED');
      if (type === 'CANCEL' && doc.kind === 'INQUIRY_CASE') {
        const lines = await tx.purchasingDocument.findMany({ where: { parentId: doc.id, kind: 'INQUIRY' }, select: { id: true } });
        for (const line of lines) await closePurchasingInquiryDuty(tx, line.id, actor.id, 'CANCELLED');
      }
      await notify(tx, doc, actor);
      result = { id: doc.id, number: label(doc), version: doc.version, kind: doc.kind, ...(['PRICE_MISMATCH','COST_MISMATCH'].includes(doc.data.paymentStatus)?{messageType:'warning'}:{}), message: ['PRICE_MISMATCH','COST_MISMATCH'].includes(doc.data.paymentStatus)?'مغایرت فاکتور ثبت شد؛ بدهی یا سند مالی ایجاد نشد. مسئول خرید باید قیمت و هزینه توافقی را بررسی کند.':`${label(doc)} ثبت شد؛ اطلاعات پرونده به‌روز شد.` };
    }
    const serialized = json(result);
    await tx.purchasingCommand.create({ data: { actorId: actor.id, key, hash: commandHash, result: serialized } });
    return serialized;

}

export async function executePurchasing(actor: Actor, key: string, type: string, input: JsonObject) {
  return prisma.$transaction(tx => executePurchasingInTransaction(tx, actor, key, type, input), { timeout: 15000, maxWait: 5000 });
}
