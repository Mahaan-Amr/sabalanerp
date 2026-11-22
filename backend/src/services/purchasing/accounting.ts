import { createAccountingSupplyChainApplication,type PurchaseLine } from '../accountingSupplyChain';
import { createAccountingSupplyChainPrismaRepository } from '../accountingSupplyChainPrismaRepository';
import { createSupplyChainLedgerPosting } from '../accountingSupplyChainPosting';
import { publishPurchasingMatchOperationalEvidence, publishSupplierInvoiceOperationalEvidence, resolveAccountingOperationalEvidence } from '../accountingOperationalEvidence';
import { assertCapability, canReadDocument, type Access, type Actor } from './access';
import { Decimal, add, sub, min, max, gt, proportionalQuantity,quantity, money, required, date, PurchasingError, type JsonObject,type Doc } from './domain';
import { document, createDocument, updateDocument, asDoc, json, type Tx } from './repository';

const rials=(toman:string,field:string)=>{const amount=new Decimal(toman).mul(10);if(!amount.isInteger()||amount.gte('1e20'))throw new PurchasingError('RIAL_PRECISION_REQUIRED','مبلغ باید قابل ثبت به ریال صحیح باشد؛ مبلغ تومان را بررسی کنید.',400,field);return BigInt(amount.toFixed());};
type ReceiptSlice={receiptId:string;quantity:string};
const slices=(doc:Doc):ReceiptSlice[]=>doc.data.receiptSlices||[{receiptId:doc.data.receiptId||doc.parentId!,quantity:doc.data.quantity}];
const accepted=(receipt:Doc)=>max('0',sub(sub(receipt.data.accepted||'0',receipt.data.acceptedReturned||'0'),receipt.data.movedToWarehouse||'0'));
export async function purchasingAccountingCommand(tx:Tx,actor:Actor,access:Access,type:string,input:JsonObject) {
  if(type==='ACCOUNTING_SUPPLIER_LINK') {
    assertCapability(access.accountant);
    const supplier=await tx.purchasingSupplier.findUnique({where:{id:required(input.supplierId,'supplierId','تأمین‌کننده')}});
    const party=await tx.accountingParty.findUnique({where:{id:required(input.accountingPartyId,'accountingPartyId','طرف‌حساب حسابداری')}});
    if(!supplier||!party||party.activeTo&&party.activeTo<new Date())throw new PurchasingError('PARTY_NOT_FOUND','تأمین‌کننده و طرف‌حساب فعال را انتخاب کنید.');
    if(supplier.accountingPartyId&&supplier.accountingPartyId!==party.id)throw new PurchasingError('SUPPLIER_PARTY_CONFLICT','هویت قبلی این تأمین‌کننده قابل جایگزینی نیست؛ تطبیق حساب‌ها را از مسیر حسابداری پیگیری کنید.');
    if(await tx.purchasingSupplier.findFirst({where:{accountingPartyId:party.id,id:{not:supplier.id}}}))throw new PurchasingError('SUPPLIER_ALREADY_LINKED','این طرف‌حساب به تأمین‌کننده دیگری متصل است؛ همان هویت را استفاده کنید.');
    await tx.purchasingSupplier.update({where:{id:supplier.id},data:{accountingPartyId:party.id}});
    return createDocument(tx,actor.id,'SUPPLIER_IDENTITY_LINK',{supplierId:supplier.id,accountingPartyId:party.id,supplierName:supplier.name,partyName:party.displayName},{ownerId:actor.id});
  }
  if(type==='ACCOUNTING_HANDOFF') {
    assertCapability(access.buyer);
    const receipt=input.receiptId?await document(tx,input.receiptId):null;
    if(receipt&&!['RECEIPT','WAREHOUSE_TRANSFER'].includes(receipt.kind))throw new PurchasingError('RECEIPT_REQUIRED','رسید یا انتقال واقعی انبار را انتخاب کنید.');
    const order=await document(tx,receipt?(receipt.data.orderId||receipt.parentId!):required(input.orderId,'orderId','سفارش خرید'),'ORDER');
    const q=quantity(input.quantity);
    if(await tx.purchasingExistingEvidence.count({where:{documentId:order.id,sourceType:'SUPPLIER_INVOICE'}}))throw new PurchasingError('EXISTING_INVOICE_REQUIRED','برای این خرید فاکتور قبلی متصل شده است؛ برای جلوگیری از بدهی تکراری، سوابق حسابداری را تطبیق دهید.');
    const receipts=receipt?[receipt]:(await tx.purchasingDocument.findMany({where:{OR:[{kind:'RECEIPT',parentId:order.id},{kind:'WAREHOUSE_TRANSFER',data:{path:['orderId'],equals:order.id}}]},orderBy:{createdAt:'asc'}})).map(asDoc);
    const drafts=(await tx.purchasingDocument.findMany({where:{kind:'ACCOUNTING_HANDOFF',data:{path:['orderId'],equals:order.id},status:{not:'CANCELLED'}}})).map(asDoc);
    let left=q,available='0';const receiptSlices:ReceiptSlice[]=[];
    for(const row of receipts) {
      if(row.data.existingOnly||await tx.purchasingExistingEvidence.count({where:{documentId:row.id,sourceType:'SUPPLIER_INVOICE'}}))continue;
      const claimed=add(...drafts.flatMap(slices).filter(s=>s.receiptId===row.id).map(s=>s.quantity));
      const remaining=max('0',sub(accepted(row),claimed));available=add(available,remaining);
      const take=min(left,remaining);if(gt(take,'0'))receiptSlices.push({receiptId:row.id,quantity:take});left=sub(left,take);
    }
    if(gt(left,'0'))throw new PurchasingError('HANDOFF_QUANTITY_EXCEEDED',`فقط ${available} ${order.data.unit} از پذیرش بار برای ارسال تازه به حسابداری باقی مانده است؛ سوابق قبلی را بررسی کنید.`,409,'quantity');
    return createDocument(tx,actor.id,'ACCOUNTING_HANDOFF',{receiptId:receipt?.id||null,receiptSlices,orderId:order.id,stone:order.data.stone,unit:order.data.unit,quantity:q,supplierId:order.data.supplierId,supplierName:order.data.supplierName,orderPrice:order.data.price,price:money(input.price),amount:money(input.price)==null?null:new Decimal(money(input.price)!).mul(q).toFixed(),invoiceNumber:input.invoiceNumber||'',paymentStatus:'NOT_POSTED',route:order.data.route}, {parentId:receipt?.id||order.id,ownerId:order.ownerId,customerId:receipt?.customerId||order.customerId});
  }
  if(type==='ACCOUNTING_HANDOFF_CANCEL') {
    assertCapability(access.buyer||access.accountant);
    const doc=await document(tx,required(input.documentId,'documentId','پرونده مالی'),'ACCOUNTING_HANDOFF');
    if(doc.status!=='OPEN')throw new PurchasingError('DOCUMENT_CLOSED','این ارسال قبلاً لغو یا تعیین تکلیف شده است؛ سابقه را بررسی کنید.');
    if(doc.data.invoiceId)throw new PurchasingError('INVOICE_ALREADY_POSTED','برای فاکتور ثبت‌شده از مسیر اصلاح حسابداری اقدام کنید؛ پرونده قابل لغو ساده نیست.');
    return updateDocument(tx,actor.id,doc,'ACCOUNTING_HANDOFF_CANCELLED',{...doc.data,paymentStatus:'CANCELLED'},input.expectedVersion,{status:'CANCELLED'});
  }
  if(type!=='ACCOUNTING_RECOGNIZE')throw new PurchasingError('INVALID_ACTION','عملیات حسابداری انتخاب‌شده معتبر نیست.',400);
  assertCapability(access.accountant,'ثبت فاکتور و بدهی به مجوز صریح حسابداری نیاز دارد.');
  const handoff=await document(tx,required(input.documentId,'documentId','پرونده حسابداری'),'ACCOUNTING_HANDOFF');
  if(handoff.status==='CANCELLED')throw new PurchasingError('DOCUMENT_CLOSED','این ارسال به حسابداری لغو شده است؛ پرونده معتبر را انتخاب کنید.');
  assertCapability(await canReadDocument(tx,access,handoff));
  if(input.expectedVersion!==handoff.version)throw new PurchasingError('VERSION_CONFLICT','اطلاعات پرونده مالی تغییر کرده است؛ نسخه تازه را بررسی کنید.');
  if(handoff.data.invoiceId)throw new PurchasingError('INVOICE_ALREADY_POSTED','فاکتور این مقدار قبلاً ثبت شده است؛ همان سند حسابداری را پیگیری کنید.');
  const order=await document(tx,handoff.data.orderId,'ORDER');
  const receiptSlices=slices(handoff),receipts:Doc[]=[];
  if(!receiptSlices.length||add(...receiptSlices.map(s=>s.quantity))!==handoff.data.quantity)throw new PurchasingError('HANDOFF_SOURCE_UNVERIFIED','سهم دریافت‌های این فاکتور قابل تطبیق نیست؛ پرونده را بررسی کنید.');
  for(const slice of receiptSlices){const receipt=await document(tx,slice.receiptId);if(!['RECEIPT','WAREHOUSE_TRANSFER'].includes(receipt.kind)||(receipt.data.orderId||receipt.parentId)!==order.id)throw new PurchasingError('HANDOFF_SOURCE_UNVERIFIED','رسیدهای فاکتور باید متعلق به همین سفارش باشند.');receipts.push(receipt);}
  if(await tx.purchasingExistingEvidence.count({where:{documentId:{in:[order.id,...receipts.map(r=>r.id)]},sourceType:'SUPPLIER_INVOICE'}}))throw new PurchasingError('EXISTING_INVOICE_REQUIRED','برای این دریافت سابقه فاکتور متصل شده است؛ پیش از ثبت تازه، سوابق قبلی را تطبیق دهید.');
  const supplier=await tx.purchasingSupplier.findUnique({where:{id:order.data.supplierId}});
  if(!supplier?.accountingPartyId)throw new PurchasingError('ACCOUNTING_PARTY_REQUIRED','ابتدا تأمین‌کننده را به طرف‌حساب موجود حسابداری متصل کنید؛ حساب تکراری نسازید.');
  const invoiceNumber=required(input.invoiceNumber,'invoiceNumber','شماره فاکتور تأمین‌کننده'),price=money(input.price);
  const invoiceDraft=Object.fromEntries(['invoiceTotal','discount','freight','recoverableTax','nonRecoverableTax','documentDate','dueDate','bookId','periodId'].map(key=>[key,typeof input[key]==='string'?input[key]:'']));
  if(price==null)throw new PurchasingError('INVOICE_PRICE_REQUIRED','نرخ فاکتور را به تومان وارد کنید.',400,'price');
  if(order.data.price==null||price!==order.data.price)return updateDocument(tx,actor.id,handoff,'INVOICE_PRICE_MISMATCH',{...handoff.data,invoiceDraft,price,invoiceNumber,orderPrice:order.data.price,paymentStatus:'PRICE_MISMATCH'},input.expectedVersion,{status:'OPEN'});
  const siblings=(await tx.purchasingDocument.findMany({where:{kind:'ACCOUNTING_HANDOFF',data:{path:['orderId'],equals:order.id},id:{not:handoff.id}}})).map(asDoc);
  for(const receipt of receipts){const recognized=add(...siblings.filter(d=>d.data.invoiceId).flatMap(slices).filter(s=>s.receiptId===receipt.id).map(s=>s.quantity));const slice=receiptSlices.find(s=>s.receiptId===receipt.id)!;if(gt(add(recognized,slice.quantity),accepted(receipt)))throw new PurchasingError('ACCEPTED_QUANTITY_CHANGED','پذیرش، برگشت یا انتقال این بار تغییر کرده است؛ مقدار فاکتور را با انبار تطبیق دهید.');}
  const issuedAt=date(required(input.documentDate,'documentDate','تاریخ فاکتور'))!,dueDate=date(required(input.dueDate,'dueDate','سررسید'))!;
  const documentDate=new Date(`${issuedAt}T12:00:00+03:30`);
  const bookId=required(input.bookId,'bookId','دفتر حسابداری'),periodId=required(input.periodId,'periodId','دوره حسابداری');
  const period=await tx.accountingPostingPeriod.findUnique({where:{id:periodId},include:{fiscalYear:true}});
  if(!period||period.fiscalYear.bookId!==bookId)throw new PurchasingError('ACCOUNTING_PERIOD_REQUIRED','دوره متعلق به دفتر انتخاب‌شده را انتخاب کنید.',400,'periodId');
  if(receipts.some(receipt=>receipt.data.route==='warehouse'&&!receipt.data.inventory?.identityId))throw new PurchasingError('INVENTORY_RECONCILIATION_REQUIRED','این دریافت به موجودی قبلی متصل نشده است؛ ابتدا سابقه واقعی انبار را تطبیق دهید.');
  const unitPriceRials=rials(price,'price');
  const grossRaw=new Decimal(handoff.data.quantity).mul(price).mul(10),grossRials=BigInt(grossRaw.toDecimalPlaces(0,Decimal.ROUND_HALF_UP).toFixed());
  const discountRials=rials(money(input.discount)||'0','discount'),freightRials=rials(money(input.freight)||'0','freight'),recoverableTaxRials=rials(money(input.recoverableTax)||'0','recoverableTax'),nonRecoverableTaxRials=rials(money(input.nonRecoverableTax)||'0','nonRecoverableTax');
  const invoiceTotalRials=rials(required(input.invoiceTotal,'invoiceTotal','جمع همین فاکتور به تومان'),'invoiceTotal');
  const net=grossRials-discountRials+freightRials+recoverableTaxRials+nonRecoverableTaxRials;
  if(net!==invoiceTotalRials)throw new PurchasingError('INVOICE_TOTAL_MISMATCH','جمع فاکتور با مقدار، نرخ و هزینه‌های واردشده برابر نیست. کل همین فاکتور و هزینه‌ها را بررسی کنید؛ فاکتور کامل را به‌عنوان فاکتور بخشی ثبت نکنید.',400,'invoiceTotal');
  const agreedFactoryCosts=add(...(order.data.costs||[]).filter((c:JsonObject)=>c.recipientId===order.data.supplierId).map((c:JsonObject)=>c.amount));
  const agreedFreightRaw=new Decimal(agreedFactoryCosts).mul(handoff.data.quantity).div(order.data.quantity).mul(10);
  const priorOrderInvoices=(await tx.purchasingDocument.findMany({where:{kind:'ACCOUNTING_HANDOFF',data:{path:['orderId'],equals:order.id}},select:{data:true}})).map(d=>d.data as JsonObject).filter(d=>d.invoiceId);
  const priorInvoiceQuantity=add(...priorOrderInvoices.map(d=>d.quantity)),priorInvoiceFreight=priorOrderInvoices.reduce((n,d)=>n+BigInt(d.freightRials||'0'),0n);
  const agreedFreight=handoff.data.quantity===max('0',sub(order.data.quantity,priorInvoiceQuantity))?BigInt(new Decimal(agreedFactoryCosts).mul(10).toDecimalPlaces(0,Decimal.ROUND_HALF_UP).toFixed())-priorInvoiceFreight:BigInt(agreedFreightRaw.toDecimalPlaces(0,Decimal.ROUND_HALF_UP).toFixed());
  if(freightRials!==agreedFreight)return updateDocument(tx,actor.id,handoff,'INVOICE_COST_MISMATCH',{...handoff.data,invoiceDraft,price,invoiceNumber,paymentStatus:'COST_MISMATCH',invoiceFreightRials:freightRials.toString(),agreedFreightRials:agreedFreight.toString()},input.expectedVersion);
  const common={receiptSlices,orderId:order.id,quantity:handoff.data.quantity,unit:order.data.unit,supplierPartyId:supplier.accountingPartyId,unitPriceRials:unitPriceRials.toString()};
  const evidence=await publishSupplierInvoiceOperationalEvidence(tx,{sourceId:handoff.id,sourceVersion:handoff.version,sourcePayload:{...common,invoiceNumber,priceToman:price,grossBeforeRoundingRials:grossRaw.toFixed(),grossRials:grossRials.toString(),discountRials:discountRials.toString(),freightRials:freightRials.toString(),recoverableTaxRials:recoverableTaxRials.toString(),nonRecoverableTaxRials:nonRecoverableTaxRials.toString(),netRials:net.toString(),roundingRule:'IRR_HALF_UP',actorId:actor.id},occurredAt:new Date()});
  const app=createAccountingSupplyChainApplication(createAccountingSupplyChainPrismaRepository(tx),{now:()=>new Date(),post:createSupplyChainLedgerPosting(tx),resolveEvidence:(item,types)=>resolveAccountingOperationalEvidence(tx,item,types)});
  const portions=(total:bigint)=>{let used=0n;return receiptSlices.map((slice,index)=>{const amount=index===receiptSlices.length-1?total-used:BigInt(proportionalQuantity(slice.quantity,handoff.data.quantity,total.toString()).split('.')[0]);used+=amount;return amount;});};
  const grossParts=portions(grossRials),discountParts=portions(discountRials),freightParts=portions(freightRials),recoverableParts=portions(recoverableTaxRials),nonRecoverableParts=portions(nonRecoverableTaxRials),lines:PurchaseLine[]=[];
  for(const [index,receipt] of receipts.entries()) {
    const slice=receiptSlices[index],lineId=`${handoff.id}:${index}`,physicalIdentityId=receipt.data.inventory?.identityId||null;
    const source={receiptId:receipt.id,orderId:order.id,quantity:slice.quantity,unit:order.data.unit,supplierPartyId:supplier.accountingPartyId,unitPriceRials:unitPriceRials.toString()};
    const orderEvidence=await publishPurchasingMatchOperationalEvidence(tx,{sourceType:'PURCHASING_ORDER_SLICE',sourceId:lineId,sourceVersion:handoff.version,sourcePayload:{...source,orderVersion:order.version},occurredAt:new Date()});
    const receiptEvidence=await publishPurchasingMatchOperationalEvidence(tx,{sourceType:'PURCHASING_RECEIPT_SLICE',sourceId:lineId,sourceVersion:handoff.version,sourcePayload:{...source,receiptVersion:receipt.version,physicalIdentityId,recipient:receipt.data.recipient},occurredAt:new Date()});
    const inventory={identityId:physicalIdentityId||`purchase-direct:${receipt.id}`,warehouseId:physicalIdentityId?'sabalan-warehouse':`customer:${receipt.customerId}`,locationId:physicalIdentityId?receipt.data.location:'مقصد مشتری',originId:receipt.id,valuationMethod:'SPECIFIC_IDENTIFICATION' as const};
    lines.push({id:lineId,kind:'INVENTORY',description:order.data.stone,quantity:slice.quantity,unit:order.data.unit,unitPriceRials,grossRials:grossParts[index],discountRials:discountParts[index],attributableFreightRials:freightParts[index],recoverableTaxRials:recoverableParts[index],nonRecoverableTaxRials:nonRecoverableParts[index],deductionRials:0n,retentionRials:0n,roundingRials:0n,orderEvidence,receiptEvidence,inventory});
  }
  const result=await app.recognizeSupplierInvoice({bookId,fiscalYearId:period.fiscalYearId,periodId,documentDate,dueDate:new Date(`${dueDate}T12:00:00+03:30`),idempotencyKey:`purchase-invoice:${handoff.id}`,correlationId:handoff.id,supplierPartyId:supplier.accountingPartyId,supplierInvoiceNumber:invoiceNumber,actor:{id:actor.id,profile:'ACCOUNTANT'},evidence,lines});
  if(result.kind!=='POSTED')throw new PurchasingError(result.exceptionCode||'INVOICE_MATCH_FAILED','تطبیق فاکتور کامل نشد؛ سفارش، پذیرش بار و شماره فاکتور قبلی را بررسی کنید.');
  if(result.invoiceId)await tx.purchasingExistingEvidence.create({data:{documentId:handoff.id,sourceType:'SUPPLIER_INVOICE',sourceId:result.invoiceId,sourceHash:evidence.hash,snapshot:json(result),createdBy:actor.id}});
  return updateDocument(tx,actor.id,handoff,'SUPPLIER_INVOICE_RECOGNIZED',{...handoff.data,price,invoiceNumber,orderPrice:order.data.price,invoiceId:result.invoiceId,voucherId:result.voucherId,openItemId:result.openItemId,amount:new Decimal(net.toString()).div(10).toFixed(),grossRials:grossRials.toString(),netRials:net.toString(),freightRials:freightRials.toString(),grossBeforeRoundingRials:grossRaw.toFixed(),paymentStatus:'POSTED_UNSETTLED'},handoff.version,{status:'RESOLVED'});
}
