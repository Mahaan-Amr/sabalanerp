import {catalogInquirySource,quoteMatch,validSpecReview} from './catalog';
import { randomUUID } from 'node:crypto';
import {ordinaryPurchaseDemands} from './ordinaryDemand';
import { prisma } from '../../lib/prisma';
import { accessFor, assertCapability, canReadDocument, canManagePersonalInquiry, redact, type Actor, type Access } from './access';
import { contractSource } from './source';
import { asDoc, createDocument, document, hash, json, updateDocument, type Tx } from './repository';
import { add, sub, max, min, gt, quantity, optionalQuantity, proportionalQuantity, optionalLeadDays,money, text, required, date, label, PurchasingError, type Doc, type JsonObject } from './domain';

// Contract entry uses stable row identity; repeated catalog products are never matched by position/name.
export async function contractPurchaseSource(tx: Tx, access: Access, contractId: string, rowId: string) {
  const identity = await tx.salesContract.findUnique({ where: { id: contractId }, select: { partnerCaseId: true } });
  const matches = identity?.partnerCaseId ? [] : await tx.contractItem.findMany({ where: { contractId, retiredAt: null, OR: [{ id: rowId }, { productRowId: rowId }] }, select: { id: true } });
  if (!identity?.partnerCaseId && matches.length !== 1) throw new PurchasingError('PURCHASE_ROW_IDENTITY_REQUIRED', 'ارتباط این ردیف با قلم قرارداد قابل تأیید نیست؛ از مسئول فروش برای بررسی شناسه ردیف پیگیری کنید.', 409);
  const source = await contractSource(tx, access, contractId, identity?.partnerCaseId ? rowId : matches[0].id);
  const rows = ((source.contract.contractData as JsonObject | null)?.products || []) as JsonObject[];
  const row = rows.find(r => r.rowId === rowId || r.rowId === ('productRowId' in source.item ? source.item.productRowId : null));
  const demand=identity?.partnerCaseId?null:ordinaryPurchaseDemands(source.contract).get(source.item.id);
  const technical = demand?.technical||Object.fromEntries(['productType', 'preparedKind', 'length', 'lengthUnit', 'width', 'widthUnit', 'diameterOrWidth', 'thicknessValue', 'stairPartType'].map(key => [key, row?.[key] ?? null]));
  const stone = demand?.description||source.item.description || source.item.product.namePersian || source.item.product.name;
  return { productId:'productId' in source.item?source.item.productId:null,productCode:'code' in source.item.product?source.item.product.code:null,contractId, itemId: source.item.id, sourceRowId: rowId, customerId: source.contract.customerId, contractNumber: source.contract.contractNumber, stone, unit: source.item.unit, quantity: source.item.quantity.toFixed(), sourceVersion: source.sourceVersion, technical,
    specKey: hash({ productId: 'productId' in source.item ? source.item.productId : null, stone, unit: source.item.unit, technical }) };
}
export const offerValid = (offer: JsonObject) => offer.status === 'VALID' && (!offer.validUntil || new Date(`${offer.validUntil}T23:59:59.999+03:30`).getTime() >= Date.now());
function currentOffer(doc: Doc, id: string) {
  if(doc.status!=='OPEN')throw new PurchasingError('INQUIRY_CLOSED','این استعلام لغو یا بسته شده است؛ پیشنهاد دیگری انتخاب کنید.');
  const offer = (doc.data.offers || []).find((o: JsonObject) => o.id === id);
  if (!offer || !offerValid(offer)) throw new PurchasingError('OFFER_NO_LONGER_VALID', 'این پیشنهاد دیگر معتبر نیست؛ مسئول خرید باید پیشنهاد معتبر را دوباره انتخاب کند.');
  return offer;
}
export async function contractPurchaseEntry(actor: Actor, contractId: string, rowId: string) {
  return prisma.$transaction(async tx => {
    const access = await accessFor(tx, actor); assertCapability(access.requester);
    const source = await contractPurchaseSource(tx, access, contractId, rowId);
    const rows = (await tx.purchasingDocument.findMany({ where: { contractId, kind: { in: ['REQUEST', 'INQUIRY'] }, data: { path: ['itemId'], equals: source.itemId! } }, orderBy: { createdAt: 'desc' }, take: 100 })).map(asDoc);
    const requested = add(...rows.filter(r => r.kind === 'REQUEST' && r.status !== 'CANCELLED').map(r => r.data.quantity));
    return json({ source, remaining: max('0', sub(source.quantity, requested)), access, documents: rows.map(r => ({ ...redact(r, access), number: label(r) })) });
  }, { timeout: 10000 });
}
async function limitedCommitted(tx: Tx, inquiryId: string, offerId: string) {
  const links = await tx.purchasingLink.findMany({where:{targetId:inquiryId,purpose:`QUOTE:${offerId}`,source:{kind:'ORDER',status:{not:'VOID'}}},select:{quantity:true}});
  return add(...links.map(l => l.quantity?.toFixed()));
}
function independentInquirySource(input: JsonObject, reason: 'stock' | 'prospect' | 'market', q: string | null) {
  const stone = required(input.stone, 'stone', 'مشخصات اولیه سنگ');
  const unit = required(input.unit, 'unit', 'واحد مقدار');
  const technical = input.technical && typeof input.technical === 'object' ? input.technical : { dimensions: text(input.dimensions) };
  const productId = text(input.productId) || null;
  return { contractId: null, customerId: null, itemId: null, sourceRowId: null, sourceVersion: null,
    stone, unit, quantity: q, technical, productId, needName: text(input.needName), reason,
    specKey: hash({ productId, stone, unit, technical }) };
}
export async function inquiryCommand(tx: Tx, actor: Actor, access: Access, type: string, input: JsonObject): Promise<Doc> {
  if (type === 'INQUIRY_CREATE') {
    assertCapability(access.requester);
    const reason = input.reason === 'stock' ? 'stock' : input.reason === 'prospect' ? 'prospect' : input.reason==='market'?'market':'contract';
    const q = optionalQuantity(input.quantity);
    let source:JsonObject = reason === 'contract'
      ? await contractPurchaseSource(tx, access, required(input.contractId, 'contractId', 'قرارداد'), required(input.rowId, 'rowId', 'ردیف قرارداد'))
      : input.productId?await catalogInquirySource(tx,input,reason,q):reason==='market'?(()=>{throw new PurchasingError('CATALOG_PRODUCT_REQUIRED','برای استعلام مستقل، کالا را از کاتالوگ انتخاب کنید.',400,'productId');})():independentInquirySource(input, reason, q);
    if (input.copyFromInquiryId && reason !== 'contract') {
      const prior = await document(tx, input.copyFromInquiryId, 'INQUIRY');
      assertCapability(await canReadDocument(tx, access, prior));
      if(source.productId&&source.productId!==prior.data.productId)throw new PurchasingError('CATALOG_SOURCE_MISMATCH','استعلام قبلی باید متعلق به همین کالای انتخاب‌شده باشد.');
      source = { ...source,productId:prior.data.productId||null,quoteScope:prior.data.quoteScope||'specific', stone: prior.data.stone, unit: prior.data.unit, technical: prior.data.technical,
        specKey: prior.data.specKey };
    }
    if (q && source.quantity && gt(q, source.quantity)) throw new PurchasingError('QUANTITY_EXCEEDED', 'مقدار استعلام از مقدار همین ردیف قرارداد بیشتر است.', 400, 'quantity');
    const owner = await tx.user.findUnique({ where: { id: required(input.ownerId, 'ownerId', 'مسئول خرید') }, select: { id: true, role: true, isActive: true } });
    assertCapability(Boolean(owner?.isActive && ((await accessFor(tx, owner)).buyer || owner.id===actor.id && access.seller)), 'مسئول پیگیری باید خود فروشنده یا کاربر فعال دارای اختیار خرید باشد.');
    if (input.groupId) {
      const group = await document(tx, input.groupId, 'INQUIRY_CASE');
      assertCapability(await canReadDocument(tx, access, group));
      if (group.ownerId !== owner!.id || group.contractId !== source.contractId) throw new PurchasingError('INQUIRY_GROUP_MISMATCH', 'اقلام استعلام باید مربوط به یک مبدأ و مسئول پیگیری باشند.');
    }
    let purchase: JsonObject = {};
    if (reason === 'contract' && input.raw === true) {
      const stone=required(input.purchaseStone,'purchaseStone','قلم خرید خام'),unit=required(input.purchaseUnit,'purchaseUnit','واحد قلم خرید');
      const technical={dimensions:text(input.purchaseDimensions),raw:true};
      purchase={finalSource:source,sourceSpecKey:source.specKey,stone,unit,technical,specKey:hash({productId:null,stone,unit,technical}),quantity:optionalQuantity(input.purchaseQuantity),needQuantity:q};
    }
    return createDocument(tx, actor.id, 'INQUIRY', { ...source, reason, quantity: q, ...purchase, raw:input.raw===true, offers: [], selection: [], converted: [], notes: text(input.notes) }, { parentId: input.groupId || null, contractId: source.contractId, customerId: source.customerId, ownerId: owner!.id });
  }
  const inquiry = await document(tx, required(input.documentId, 'documentId', 'استعلام'), 'INQUIRY');
  assertCapability(await canReadDocument(tx, access, inquiry));
  if(inquiry.status!=='OPEN')throw new PurchasingError('INQUIRY_CLOSED','این استعلام لغو یا بسته شده است؛ سابقه آن همچنان قابل مشاهده است.');
  if (input.expectedVersion !== inquiry.version) throw new PurchasingError('VERSION_CONFLICT', 'استعلام تغییر کرده است؛ پاسخ‌های تازه را بررسی و دوباره ثبت کنید.');
  const data = { ...inquiry.data };
  if(type==='INQUIRY_CONTINUE') {
    assertCapability(access.buyer);
    if(data.reason==='market')throw new PurchasingError('ACTUAL_NEED_REQUIRED','این استعلام مستقل است؛ برای سفارش ابتدا نیاز انبار یا قرارداد واقعی را مشخص کنید.');
    const selected=await inquiryCommand(tx,actor,access,'INQUIRY_SELECT',{...input,expectedVersion:inquiry.version});
    if(input.existingRequestId&&await tx.purchasingLink.count({where:{targetId:input.existingRequestId,purpose:'ALLOCATION',source:{status:{not:'VOID'}}}}))return inquiryCommand(tx,actor,access,'INQUIRY_REPLAN',{...input,requestId:input.existingRequestId,expectedVersion:selected.version});
    return inquiryCommand(tx,actor,access,'INQUIRY_CONVERT',{...input,expectedVersion:selected.version});
  }
  if (type === 'INQUIRY_BIND') {
    assertCapability(access.buyer);
    if (inquiry.contractId || data.reason !== 'prospect' || data.converted?.length) throw new PurchasingError('INQUIRY_BIND_UNAVAILABLE', 'فقط استعلام پیش از قرارداد و تبدیل‌نشده به درخواست، قابل اتصال است.');
    const source = await contractPurchaseSource(tx, access, required(input.contractId, 'contractId', 'قرارداد'), required(input.rowId, 'rowId', 'ردیف قرارداد'));
    if (input.raw === true) {
      if(input.technicalReviewed!==true || input.conversionConfirmed!==true)throw new PurchasingError('TECHNICAL_REVIEW_REQUIRED','مشخصات قلم خام، محصول نهایی و رابطه تبدیل را بررسی و تأیید کنید.');
      const purchaseQuantity=quantity(input.purchaseQuantity || data.quantity,'purchaseQuantity'),demandQuantity=quantity(input.demandQuantity,'demandQuantity');
      if(gt(demandQuantity,source.quantity))throw new PurchasingError('QUANTITY_EXCEEDED','مقدار محصول نهایی از نیاز ردیف قرارداد بیشتر است.');
      if(gt(add(...(data.selection || []).map((s:JsonObject)=>s.quantity)),purchaseQuantity))throw new PurchasingError('SELECTION_EXCEEDS_BOUND_NEED','جمع انتخاب‌ها از مقدار خرید این نیاز بیشتر است؛ ابتدا سهم پیشنهادها را اصلاح کنید.');
      return updateDocument(tx,actor.id,inquiry,type,{...data,contractId:source.contractId,itemId:source.itemId,sourceRowId:source.sourceRowId,sourceVersion:source.sourceVersion,contractNumber:source.contractNumber,reason:'contract',raw:true,quantity:purchaseQuantity,needQuantity:demandQuantity,finalSource:source,sourceSpecKey:source.specKey,conversionBase:{purchaseQuantity,demandQuantity,confirmed:true,actorId:actor.id},boundAt:new Date().toISOString()},inquiry.version,{contractId:source.contractId,customerId:source.customerId});
    }
    if (input.technicalReviewed !== true || source.unit !== data.unit) throw new PurchasingError('TECHNICAL_REVIEW_REQUIRED', 'واحد و مشخصات سنگ استعلام را با ردیف قرارداد بررسی و تطابق را تأیید کنید.');
    return updateDocument(tx, actor.id, inquiry, type, { ...data, ...source, quantity: data.quantity, reason: 'contract', priorNeed: { stone: data.stone, technical: data.technical, specKey: data.specKey }, boundAt: new Date().toISOString() }, inquiry.version, { contractId: source.contractId, customerId: source.customerId });
  }
  if (type === 'INQUIRY_OFFER') {
    assertCapability(access.buyer || canManagePersonalInquiry(access,inquiry));
    const supplier = await tx.purchasingSupplier.findUnique({ where: { id: required(input.supplierId, 'supplierId', 'تأمین‌کننده') } });
    if (!supplier?.isActive) throw new PurchasingError('INVALID_SUPPLIER', 'تأمین‌کننده فعال را انتخاب کنید.', 400, 'supplierId');
    if ((data.offers || []).length >= 100) throw new PurchasingError('OFFER_LIMIT', 'این استعلام به سقف پیشنهادها رسیده است؛ پرونده تازه ایجاد کنید.');
    const q = optionalQuantity(input.quantity);
    if (input.capacity === 'limited' && !q) throw new PurchasingError('LIMITED_QUANTITY_REQUIRED', 'برای پیشنهاد با مقدار محدود، مقدار قابل تأمین را مشخص کنید.', 400, 'quantity');
    if(input.readyDate&&input.readyLeadDays!==''&&input.readyLeadDays!=null||input.arrivalDate&&input.arrivalLeadDays!==''&&input.arrivalLeadDays!=null)throw new PurchasingError('DELIVERY_BASIS_CONFLICT','برای هر موعد، تاریخ معین یا مدت تأمین را وارد کنید؛ هر دو را هم‌زمان ثبت نکنید.',400);
    if(input.leadBasis==='OFFER_DATE'&&(input.readyLeadDays!==''&&input.readyLeadDays!=null||input.arrivalLeadDays!==''&&input.arrivalLeadDays!=null)&&!input.offerDate)throw new PurchasingError('OFFER_DATE_REQUIRED','وقتی مدت از تاریخ پیشنهاد محاسبه می‌شود، تاریخ واقعی پیشنهاد را مشخص کنید.',400,'offerDate');
    if (input.replacesId && !(data.offers || []).some((o: JsonObject) => o.id === input.replacesId && o.supplierId === supplier.id)) throw new PurchasingError('OFFER_REFERENCE_INVALID', 'پیشنهاد قبلی باید مربوط به همین تأمین‌کننده باشد.');
    data.offers = [...(data.offers || []).map((o: JsonObject) => input.replacesId === o.id ? { ...o, status: 'SUPERSEDED' } : o), { id: randomUUID(), supplierId: supplier.id, supplierName: supplier.name, price: money(input.price), minimumQuantity:optionalQuantity(input.minimumQuantity),maximumQuantity:optionalQuantity(input.maximumQuantity), quantity: q, capacity: input.capacity === 'limited' ? 'limited' : 'estimate', freight: money(input.freight, 'freight'), readyLeadDays:optionalLeadDays(input.readyLeadDays,'readyLeadDays'),arrivalLeadDays:optionalLeadDays(input.arrivalLeadDays,'arrivalLeadDays'),offerDate:date(input.offerDate),leadBasis:input.leadBasis==='OFFER_DATE'?'OFFER_DATE':'ORDER_CONFIRMATION',dayKind:['calendar','working'].includes(input.dayKind)?input.dayKind:'unspecified',readyDate: date(input.readyDate), arrivalDate: date(input.arrivalDate), validUntil: date(input.validUntil), terms: text(input.terms), variant: text(input.variant), status: input.valid === false ? 'INVALID' : 'VALID', replacesId: text(input.replacesId) || null, recordedAt: new Date().toISOString(), actorId: actor.id }];
    return updateDocument(tx, actor.id, inquiry, type, data, inquiry.version);
  }
  if (type === 'INQUIRY_CONFIRM') {
    assertCapability(access.buyer);
    const offer=(data.offers || []).find((o:JsonObject)=>o.id===input.offerId);
    if(!offer) throw new PurchasingError('OFFER_REFERENCE_INVALID','پیشنهاد موردنظر پیدا نشد.');
    const confirmation=required(input.confirmation,'confirmation','شرح تأیید تأمین‌کننده برای اجرای شرایط قبلی');
    const validUntil=date(input.validUntil);
    if(validUntil && new Date(`${validUntil}T23:59:59.999+03:30`).getTime()<Date.now()) throw new PurchasingError('OFFER_EXPIRED','مهلت تازه نمی‌تواند گذشته باشد.');
    data.offers=data.offers.map((o:JsonObject)=>o.id===offer.id?{...o,status:'VALID',validUntil,confirmations:[...(o.confirmations || []),{confirmation,actorId:actor.id,at:new Date().toISOString()}]}:o);
    return updateDocument(tx,actor.id,inquiry,type,data,inquiry.version);
  }
  if (type === 'INQUIRY_SELECT') {
    assertCapability(access.buyer);
    if (!Array.isArray(input.selection) || input.selection.length > 100) throw new PurchasingError('SELECTION_REQUIRED', 'فهرست پیشنهادهای منتخب معتبر نیست؛ سهم هر پیشنهاد را بررسی کنید.');
    const seen = new Set<string>();
    data.selection = [];
    for (const selected of input.selection) {
      if (seen.has(selected.offerId)) throw new PurchasingError('DUPLICATE_OFFER', 'هر پیشنهاد را یک بار در انتخاب وارد کنید.'); seen.add(selected.offerId);
      const source = selected.inquiryId && selected.inquiryId !== inquiry.id ? await document(tx, selected.inquiryId, 'INQUIRY') : inquiry;
      if(source.id!==inquiry.id && input.destinationReviewed!==true) throw new PurchasingError('DESTINATION_REVIEW_REQUIRED','برای استفاده از استعلام قبلی، هزینه حمل و موعد رسیدن به مقصد این قرارداد را بررسی و تأیید کنید.');
      const match=quoteMatch(source.data,inquiry.data);
      if(!match) throw new PurchasingError('OFFER_SPEC_MISMATCH', 'مشخصات یا واحد استعلام قبلی با این نیاز منطبق نیست؛ پیشنهاد را برای این قلم دریافت کنید.');
      const offer = currentOffer(source, selected.offerId), q = quantity(selected.quantity);
      if(match==='general'&&(input.technicalConfirmed!==true||!text(input.technicalConfirmation)))throw new PurchasingError('GENERAL_QUOTE_REVIEW_REQUIRED','اجرای قیمت عمومی برای مشخصات این نیاز را از تأمین‌کننده تأیید و شرح آن را ثبت کنید.',400,'technicalConfirmation');
      const specReview=match==='general'?{targetSpecKey:inquiry.data.specKey,sourceSpecKey:source.data.specKey,confirmation:text(input.technicalConfirmation),actorId:actor.id,at:new Date().toISOString()}:null;
      if (offer.minimumQuantity && gt(offer.minimumQuantity,q) || offer.maximumQuantity && gt(q,offer.maximumQuantity)) throw new PurchasingError('OFFER_PRICE_RANGE','مقدار انتخابی خارج از محدوده مقدارِ مشمول این قیمت است؛ پیشنهاد منطبق را تأیید کنید.');
      const priorCommitments=offer.capacity==='limited'?await tx.purchasingLink.findMany({where:{purpose:'ALLOCATION',target:{kind:'REQUEST',parentId:inquiry.id},source:{kind:'ORDER',status:{not:'VOID'}}},select:{data:true}}):[];
      const alreadyCommitted=add(...priorCommitments.flatMap(l=>((l.data as JsonObject).quoteBindings || []).filter((b:JsonObject)=>b.inquiryId===source.id && b.offerId===offer.id).map((b:JsonObject)=>b.quantity)));
      if (offer.capacity === 'limited' && gt(max('0',sub(q,alreadyCommitted)), max('0', sub(offer.quantity, await limitedCommitted(tx, source.id, offer.id))))) throw new PurchasingError('OFFER_CAPACITY_EXCEEDED', 'سهم انتخابی از مانده مقدار محدود این پیشنهاد بیشتر است.');
      data.selection.push({specReview, inquiryId: source.id, offerId: offer.id, quantity: q, destinationReviewed:input.destinationReviewed===true });
    }
    const total = add(...data.selection.map((s: JsonObject) => s.quantity));
    if (data.quantity && gt(total, data.quantity)) throw new PurchasingError('QUANTITY_EXCEEDED', 'جمع سهم‌ها از مقدار موردنیاز این استعلام بیشتر است.');
    return updateDocument(tx, actor.id, inquiry, type, data, inquiry.version);
  }
  if(type==='INQUIRY_REPLAN') {
    assertCapability(access.buyer);
    const request=await document(tx,required(input.requestId,'requestId','درخواست خرید'),'REQUEST');
    if(request.parentId!==inquiry.id||request.status!=='OPEN'||request.data.specKey!==data.specKey)throw new PurchasingError('REQUEST_SOURCE_MISMATCH','بازانتخاب باید برای همین قلم و همین درخواست انجام شود.');
    if(request.version!==input.expectedRequestVersion)throw new PurchasingError('VERSION_CONFLICT','درخواست تغییر کرده است؛ مانده تازه را بررسی کنید.');
    const links=await tx.purchasingLink.findMany({where:{targetId:request.id,purpose:'ALLOCATION',source:{status:{not:'VOID'}}},select:{quantity:true,data:true}});
    const committed=add(...links.map(l=>(l.data as JsonObject).purchaseQuantity||l.quantity?.toFixed()));
    const remaining=max('0',sub(request.data.purchaseQuantity||request.data.quantity,committed));
    if(!gt(remaining,'0'))throw new PurchasingError('NO_REMAINING_QUANTITY','تمام این درخواست سفارش داده شده است؛ برای تعهد قبلی از مسیر تغییر یا لغو اقدام کنید.');
    if(quantity(input.quantity)!==remaining)throw new PurchasingError('REQUEST_QUANTITY_CHANGED','مانده سفارش تغییر کرده است؛ مقدار تازه را بررسی کنید.');
    const preserved:JsonObject[]=[];
    for(const binding of links.flatMap(l=>(l.data as JsonObject).quoteBindings||[])) {
      const original=(request.data.inquirySelection||[]).find((s:JsonObject)=>s.inquiryId===binding.inquiryId&&s.offerId===binding.offerId);
      if(!original)throw new PurchasingError('COMMITTED_QUOTE_UNVERIFIED','مرجع پیشنهاد سفارش قبلی قابل تطبیق نیست؛ سابقه تعهد را بررسی کنید.');
      const prior=preserved.find(s=>s.inquiryId===binding.inquiryId&&s.offerId===binding.offerId);
      if(prior)prior.quantity=add(prior.quantity,binding.quantity);else preserved.push({...original,quantity:binding.quantity});
    }
    const others=(await tx.purchasingDocument.findMany({where:{kind:'REQUEST',parentId:inquiry.id,id:{not:request.id},status:{not:'CANCELLED'}},select:{data:true}})).flatMap(r=>(r.data as JsonObject).inquirySelection||[]);
    let left=remaining;const fresh:JsonObject[]=[];
    for(const selected of data.selection||[]) {
      const source=selected.inquiryId===inquiry.id?inquiry:await document(tx,selected.inquiryId,'INQUIRY');
      const offer=currentOffer(source,selected.offerId);
      if(!validSpecReview(source.data,request.data,selected.specReview))throw new PurchasingError('OFFER_SPEC_MISMATCH','مشخصات پیشنهاد تازه با قلم این درخواست برابر نیست.');
      const already=add(...[...others,...preserved].filter(s=>s.inquiryId===source.id&&s.offerId===offer.id).map(s=>s.quantity));
      const take=min(left,max('0',sub(selected.quantity,already)));
      if(gt(take,'0'))fresh.push({specReview:selected.specReview||null,inquiryId:source.id,offerId:offer.id,quantity:take,supplierId:offer.supplierId,supplierName:offer.supplierName,price:offer.price,offerSnapshot:offer});
      left=sub(left,take);if(!gt(left,'0'))break;
    }
    if(gt(left,'0'))throw new PurchasingError('NO_SELECTED_REMAINING','پیشنهادهای منتخب برای باقی سفارش کافی نیستند؛ سهم انتخاب‌ها را اصلاح کنید.');
    const combined=new Map<string,JsonObject>();
    for(const split of [...preserved,...fresh]){const key=`${split.inquiryId}:${split.offerId}`,prior=combined.get(key);combined.set(key,{...split,quantity:add(prior?.quantity,split.quantity)});}
    const splits=[...combined.values()];
    const updated=await updateDocument(tx,actor.id,request,'INQUIRY_REPLAN_REMAINDER',{...request.data,inquirySelection:splits,replanHistory:[...(request.data.replanHistory||[]),{createdAt:new Date().toISOString(),actorId:actor.id,committed,remaining,priorSelection:request.data.inquirySelection}]},request.version);
    await updateDocument(tx,actor.id,inquiry,'INQUIRY_REPLAN_REMAINDER',{...data,converted:[...(data.converted||[]).filter((r:JsonObject)=>r.requestId!==request.id),{requestId:request.id,quantity:request.data.quantity,splits:splits.map(({offerSnapshot,price,...safe})=>safe)}]},inquiry.version);
    return updated;
  }
  if (type === 'INQUIRY_CONVERT') {
    if(data.reason==='market')throw new PurchasingError('ACTUAL_NEED_REQUIRED','استعلام مستقل نیاز خرید نیست؛ ابتدا نیاز انبار یا قرارداد واقعی را مشخص کنید.');
    assertCapability(access.requester);
    if (data.reason === 'prospect' && !inquiry.contractId) throw new PurchasingError('ACTUAL_CONTRACT_REQUIRED', 'برای ثبت درخواست مشتری، ابتدا استعلام را به قرارداد و ردیف واقعی مشتری متصل کنید.');
    const source = inquiry.contractId ? await contractPurchaseSource(tx, access, inquiry.contractId, data.sourceRowId || data.itemId) : {...independentInquirySource(data, 'stock', data.quantity),specKey:data.specKey};
    const raw=Boolean(data.raw && data.finalSource);
    if (source.specKey !== (raw?data.sourceSpecKey:data.specKey)) throw new PurchasingError('INQUIRY_SOURCE_CHANGED', 'ردیف قرارداد پس از استعلام تغییر کرده است؛ مسئول خرید باید انطباق پیشنهاد را دوباره بررسی کند.');
    const purchaseQuantity=quantity(input.quantity);
    let demandQuantity=purchaseQuantity;
    if(raw){
      const basePurchase=quantity(input.basePurchaseQuantity || data.conversionBase?.purchaseQuantity || data.quantity,'basePurchaseQuantity');
      const baseDemand=quantity(input.baseDemandQuantity || data.conversionBase?.demandQuantity || data.needQuantity,'baseDemandQuantity');
      if(data.conversionBase?.confirmed && (basePurchase!==data.conversionBase.purchaseQuantity || baseDemand!==data.conversionBase.demandQuantity))throw new PurchasingError('CONVERSION_SOURCE_CHANGED','رابطه تبدیل این استعلام قبلاً مبنای درخواست بوده است؛ برای رابطه تازه، استعلام تازه ثبت کنید.');
      if(input.conversionConfirmed!==true && data.conversionBase?.confirmed!==true)throw new PurchasingError('CONVERSION_REQUIRED','مقدار قلم خرید و مقدار محصول نهایی و رابطه تبدیل آن‌ها را صریح تأیید کنید.');
      demandQuantity=quantity(proportionalQuantity(purchaseQuantity,basePurchase,baseDemand),'demandQuantity');
      data.conversionBase={purchaseQuantity:basePurchase,demandQuantity:baseDemand,confirmed:true,actorId:actor.id};
    }
    const existingRequest=input.existingRequestId?await document(tx,input.existingRequestId,'REQUEST'):null;
    if(existingRequest){assertCapability(access.buyer);if(existingRequest.parentId!==inquiry.id || existingRequest.status!=='OPEN') throw new PurchasingError('REQUEST_SOURCE_MISMATCH','درخواست قابل بازانتخاب متعلق به همین استعلام نیست.');if(existingRequest.version!==input.expectedRequestVersion)throw new PurchasingError('VERSION_CONFLICT','درخواست تغییر کرده است؛ اطلاعات تازه را دریافت کنید.');if(await tx.purchasingLink.count({where:{targetId:existingRequest.id,purpose:'ALLOCATION'}}))throw new PurchasingError('COMMITTED_REQUEST_CHANGE_REQUIRED','برای این درخواست سفارش قطعی ثبت شده است؛ از مسیر درخواست تغییر یا لغو پیگیری کنید.');if((!raw && demandQuantity!==existingRequest.data.quantity) || purchaseQuantity!==(existingRequest.data.purchaseQuantity||existingRequest.data.quantity))throw new PurchasingError('REQUEST_QUANTITY_CHANGED','بازانتخاب پیشنهاد، مقدار درخواست را تغییر نمی‌دهد.');}
    const convertedRows = await tx.purchasingDocument.findMany({where:{id:{in:(data.converted || []).map((r:JsonObject)=>r.requestId)},kind:'REQUEST',status:{not:'CANCELLED'},...(existingRequest?{id:{in:(data.converted || []).map((r:JsonObject)=>r.requestId),not:existingRequest.id}}:{})},select:{data:true}});
    if(raw){
      const priorPurchase=add(...convertedRows.map(r=>(r.data as JsonObject).purchaseQuantity));
      const priorDemand=add(...convertedRows.map(r=>(r.data as JsonObject).quantity));
      demandQuantity=existingRequest?existingRequest.data.quantity:quantity(sub(proportionalQuantity(add(priorPurchase,purchaseQuantity),data.conversionBase.purchaseQuantity,data.conversionBase.demandQuantity),priorDemand),'demandQuantity');
    }
    const converted = convertedRows.map(r => ({splits:(r.data as JsonObject).inquirySelection || []}));
    let remaining = quantity(input.quantity), selectedRemaining = '0';
    const splits: JsonObject[] = [];
    for (const selected of data.selection || []) {
      const offerSource = selected.inquiryId === inquiry.id ? inquiry : await document(tx, selected.inquiryId, 'INQUIRY');
      const offer = currentOffer(offerSource, selected.offerId);
      const used = add(...converted.flatMap((r: JsonObject) => (r.splits || []).filter((s: JsonObject) => s.offerId === offer.id && s.inquiryId === offerSource.id).map((s: JsonObject) => s.quantity)));
      const available = max('0', sub(selected.quantity, used)); selectedRemaining = add(selectedRemaining, available);
      const take = min(remaining, available); remaining = sub(remaining, take);
      if (gt(take, '0')) splits.push({specReview:selected.specReview||null, inquiryId: offerSource.id, offerId: offer.id, quantity: take, supplierId: offer.supplierId, supplierName: offer.supplierName, price: offer.price, offerSnapshot: offer });
    }
    if (gt(remaining, '0') || !splits.length) throw new PurchasingError('NO_SELECTED_REMAINING', `فقط ${selectedRemaining} ${data.unit} از پیشنهادهای منتخب آماده ثبت درخواست است؛ استعلام را از مسئول خرید پیگیری کنید.`);
    const already = (await tx.purchasingDocument.findMany({ where: { kind: 'REQUEST', ...(existingRequest?{id:{not:existingRequest.id}}:{}), ...(inquiry.contractId ? { contractId: source.contractId, data: { path: ['itemId'], equals: source.itemId! } } : { parentId: inquiry.id }), status: { not: 'CANCELLED' } }, select: { data: true } })).map(r => (r.data as JsonObject).quantity);
    const q = demandQuantity; if (source.quantity && gt(add(...already, q), source.quantity)) throw new PurchasingError('QUANTITY_EXCEEDED', 'برای این نیاز قبلاً درخواست ثبت شده است؛ مقدار باقی‌مانده و سوابق را بررسی کنید.');
    const rawData=raw?{sourceSpecKey:source.specKey,specKey:data.specKey,purchaseStone:data.stone,purchaseUnit:data.unit,purchaseTechnical:data.technical,purchaseQuantity,conversionBase:data.conversionBase}:{};
    const request = existingRequest ? await updateDocument(tx,actor.id,existingRequest,'INQUIRY_RESELECT',{...existingRequest.data,...source,...rawData,quantity:existingRequest.data.quantity,inquirySelection:splits},existingRequest.version) : await createDocument(tx, actor.id, 'REQUEST', { ...source,...rawData,reason: inquiry.contractId ? 'contract' : 'stock', quantity: q, raw: data.raw === true, inquirySelection: splits, notes: text(input.notes) }, { parentId: inquiry.id, ownerId: inquiry.ownerId, contractId: source.contractId, customerId: source.customerId });
    await updateDocument(tx, actor.id, inquiry, type, { ...data, converted: [...(data.converted || []).filter((r:JsonObject)=>r.requestId!==request.id), { requestId: request.id, quantity: q, splits: splits.map(({ offerSnapshot, price, ...safe }) => safe) }] }, inquiry.version);
    return request;
  }
  throw new PurchasingError('INVALID_ACTION', 'عملیات استعلام معتبر نیست.', 400);
}

// Revalidate selected sources at the commitment boundary; recording an inquiry never reserves supplier stock.
export async function bindInquiryOrder(tx: Tx, request: Doc, supplierId: string, demand: string, unit: string, price: string | null, pending: JsonObject[] = []) {
  if (!request.data.inquirySelection) return [];
  if (unit !== (request.data.purchaseUnit || request.data.unit)) throw new PurchasingError('OFFER_UNIT_CHANGED', 'واحد خرید با پیشنهاد منتخب متفاوت است؛ ابتدا پیشنهاد منطبق دریافت کنید.');
  const priorOrders = await tx.purchasingLink.findMany({ where: { targetId: request.id, purpose: 'ALLOCATION', source: { status: { not: 'VOID' } } }, select: { data: true } });
  let remaining = demand;
  const bindings: JsonObject[] = [];
  for (const split of request.data.inquirySelection.filter((s: JsonObject) => s.supplierId === supplierId && s.price === price)) {
    if (remaining === '0') break;
    const used = add(...priorOrders.flatMap(o => ((o.data as JsonObject)?.quoteBindings || []).filter((b: JsonObject) => b.inquiryId === split.inquiryId && b.offerId === split.offerId).map((b: JsonObject) => b.quantity)));
    const take = min(remaining, max('0', sub(split.quantity, used)));
    if(!gt(take,'0'))continue;
    const source = await document(tx, split.inquiryId, 'INQUIRY'), offer = currentOffer(source, split.offerId);
    if (!validSpecReview(source.data,request.data,split.specReview)) throw new PurchasingError('OFFER_SPEC_MISMATCH', 'مشخصات پیشنهاد با درخواست منطبق نیست.');
    if (offer.price !== split.price || offer.price !== price) throw new PurchasingError('OFFER_PRICE_CHANGED', 'قیمت سفارش با پیشنهاد منتخب برابر نیست؛ مسئول خرید باید انتخاب را دوباره تعیین تکلیف کند.');
    if (offer.capacity === 'limited' && gt(take, max('0', sub(offer.quantity, add(await limitedCommitted(tx, source.id, offer.id), ...pending.filter(p => p.inquiryId === source.id && p.offerId === offer.id).map(p => p.quantity)))))) throw new PurchasingError('OFFER_CAPACITY_EXCEEDED', 'مانده پیشنهاد محدود کافی نیست؛ سفارش دیگری از این پیشنهاد ثبت شده است.');
    if (gt(take, '0')) bindings.push({ inquiryId: source.id, offerId: offer.id, quantity: take });
    remaining = sub(remaining, take);
  }
  if (gt(remaining, '0')) throw new PurchasingError('SUPPLIER_NOT_SELECTED', 'این مقدار برای تأمین‌کننده انتخاب‌شده در درخواست موجود نیست؛ سهم پیشنهادهای منتخب را بررسی کنید.');
  return bindings;
}

export async function validateOfferPriceRanges(tx:Tx, bindings:JsonObject[]) {
  const groups=new Map<string,JsonObject>();
  for(const b of bindings){const key=`${b.inquiryId}:${b.offerId}`,previous=groups.get(key);groups.set(key,{...b,quantity:add(previous?.quantity,b.quantity)});}
  for(const b of groups.values()){const offer=currentOffer(await document(tx,b.inquiryId,'INQUIRY'),b.offerId);if(offer.minimumQuantity && gt(offer.minimumQuantity,b.quantity) || offer.maximumQuantity && gt(b.quantity,offer.maximumQuantity)) throw new PurchasingError('OFFER_PRICE_RANGE','مقدار سفارش خارج از محدوده قیمت معتبر است؛ تأیید قیمت متناسب با این مقدار را از تأمین‌کننده بگیرید.');}
}

export async function compatibleContractInquiries(actor:Actor,id:string) {
  const access=await accessFor(prisma,actor);assertCapability(access.buyer);
  const target=await document(prisma,id,'INQUIRY');
  const matches=await prisma.purchasingDocument.findMany({where:{kind:'INQUIRY',id:{not:id},status:'OPEN',OR:[{data:{path:['specKey'],equals:target.data.specKey}},...(target.data.productId?[{AND:[{data:{path:['productId'],equals:target.data.productId}},{data:{path:['quoteScope'],equals:'general'}}]}]:[])]},orderBy:{updatedAt:'desc'},take:100});
  return json((await withOfferAvailability(prisma,matches.map(asDoc).filter(d=>quoteMatch(d.data,target.data)&&(d.data.offers || []).some(offerValid)))).map(d=>({...redact(d,access),number:label(d)})));
}

export async function withOfferAvailability(db: Tx | typeof prisma, inquiries: Doc[]): Promise<Doc[]> {
  if (!inquiries.length) return [];
  const links = await db.purchasingLink.findMany({where:{targetId:{in:inquiries.map(d=>d.id)},purpose:{startsWith:'QUOTE:'},source:{kind:'ORDER',status:{not:'VOID'}}},select:{targetId:true,purpose:true,quantity:true}});
  const committed = new Map<string,string>();
  for (const link of links) {const key=`${link.targetId}:${link.purpose.slice(6)}`;committed.set(key,add(committed.get(key),link.quantity?.toFixed()));}
  return inquiries.map(doc=>({...doc,data:{...doc.data,offers:(doc.data.offers || []).map((offer:JsonObject)=>({...offer,availableQuantity:offer.capacity==='limited'?max('0',sub(offer.quantity,committed.get(`${doc.id}:${offer.id}`)||'0')):offer.quantity}))}}));
}
