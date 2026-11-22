import {releasePurchaseProtection} from '../inventoryPurchaseCustody';
import {currentRequestNeed} from './currentNeed';
import {acceptedDemandForRequest,mergeAcceptedShares,recordAcceptedCustody} from './custody';
import {assertCapability,type Access,type Actor} from './access';
import {add,sub,min,max,gt,quantity,proportionalQuantity,required,PurchasingError,type JsonObject} from './domain';
import {document,asDoc,updateDocument,createDocument,type Tx} from './repository';

export async function transferSurplus(tx:Tx,actor:Actor,access:Access,input:JsonObject) {
  assertCapability(access.buyer);
  const request=await document(tx,required(input.documentId,'documentId','درخواست خرید'),'REQUEST');
  if(request.version!==input.expectedVersion)throw new PurchasingError('VERSION_CONFLICT','درخواست تغییر کرده است؛ مقدار جاری را بررسی کنید.');
  if(!request.contractId)throw new PurchasingError('CUSTOMER_NEED_REQUIRED','انتقال مازاد مشتری فقط برای سهم قرارداد است.');
  const links=await tx.purchasingLink.findMany({where:{targetId:request.id,purpose:'ALLOCATION',source:{status:{not:'VOID'}}},select:{sourceId:true}}),ids=links.map(l=>l.sourceId);
  const docs=(await tx.purchasingDocument.findMany({where:{OR:[{id:{in:ids}},{parentId:{in:ids},kind:'RECEIPT'}]},orderBy:{createdAt:'desc'}})).map(asDoc);
  const current=await currentRequestNeed(tx,request);
  const supplied=add(...docs.filter(d=>d.kind==='ORDER').map(o=>acceptedDemandForRequest(o,docs,request)));
  const surplus=max('0',sub(supplied,current.quantity||'0')),q=quantity(input.quantity);
  if(gt(q,surplus))throw new PurchasingError('SURPLUS_EXCEEDED','مقدار از مازاد پذیرفته‌شده این قرارداد بیشتر است؛ نیاز جاری و پذیرش بار را بررسی کنید.',409,'quantity');
  if(request.data.raw&&input.conversionConfirmed!==true)throw new PurchasingError('CONVERSION_REQUIRED','برای قلم خام، تبدیل سهم محصول نهایی به مقدار خرید را تأیید کنید.',400,'conversionConfirmed');
  let remaining=q;const moved:JsonObject[]=[];
  const identityLocks=docs.filter(d=>d.kind==='RECEIPT').map(d=>d.data.route==='warehouse'?`purchase-receipt:${d.id}`:`purchase-direct:${d.id}`).sort();
  for(const id of identityLocks)await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
  for(const receipt of docs.filter(d=>d.kind==='RECEIPT')) {
    const shares:JsonObject[]=(receipt.data.acceptedShares||[]).map((s:JsonObject)=>({...s})),share=shares.find(s=>s.requestId===request.id&&gt(s.quantity,'0'));
    if(!share)continue;
    const take=min(remaining,share.quantity),purchase=proportionalQuantity(take,share.quantity,share.purchaseQuantity);
    if(!gt(purchase,'0'))throw new PurchasingError('TRANSFER_PRECISION_REQUIRED','مقدار انتخاب‌شده برای انتقال بسیار کوچک است؛ مقدار دقیق خرید را بررسی کنید.');
    const source={requestId:request.id,requestVersion:request.version+1,receiptId:receipt.id,quantity:take,purchaseQuantity:purchase,unit:receipt.data.unit,currentNeed:current.quantity,actorId:actor.id};
    if(receipt.data.route==='warehouse') {
      if(!receipt.data.inventory)throw new PurchasingError('INVENTORY_RECONCILIATION_REQUIRED','این رسید به موجودی واقعی متصل نشده است؛ ابتدا سابقه قبلی انبار را تطبیق دهید.');
      await releasePurchaseProtection(tx,{receiptId:receipt.id,requestId:request.id,version:request.version+1,actorId:actor.id,purposeId:share.purposeId,quantity:purchase,source});
    } else {
      if(await tx.accountingInventoryValuationLayer.count({where:{identityId:`purchase-direct:${receipt.id}`}}))throw new PurchasingError('ACCOUNTING_TRANSFER_REQUIRED','بار مقصد قبلاً ارزش‌گذاری شده است؛ انتقال واقعی آن باید از مسیر موجودی و حسابداری همان هویت انجام شود تا موجودی دوباره ثبت نشود.');
      assertCapability(access.receiver,'دریافت واقعی مازاد از مقصد مشتری را انباردار یا مدیریت ثبت می‌کند.');
      if(input.physicalConfirmed!==true)throw new PurchasingError('WAREHOUSE_ARRIVAL_REQUIRED','انتقال از مقصد مشتری را فقط پس از رسیدن واقعی سنگ به انبار تأیید کنید.',400,'physicalConfirmed');
      const transfer=await createDocument(tx,actor.id,'WAREHOUSE_TRANSFER',{...source,orderId:receipt.parentId,sourceReceiptId:receipt.id,stone:receipt.data.stone,quantity:purchase,unit:receipt.data.unit,accepted:purchase,acceptedShares:[{requestId:null,purposeId:null,purchaseQuantity:purchase,quantity:purchase,unit:receipt.data.unit}],route:'warehouse',location:'انبار سبلان',occurredAt:new Date().toISOString()},{parentId:receipt.id,ownerId:request.ownerId});
      const inventory=await recordAcceptedCustody(tx,actor.id,transfer,purchase,[]);
      await updateDocument(tx,actor.id,transfer,'CUSTODY_LINKED',{...transfer.data,inventory},transfer.version);
    }
    share.quantity=sub(share.quantity,take);share.purchaseQuantity=sub(share.purchaseQuantity,purchase);
    shares.push({requestId:null,contractId:null,purposeId:null,quantity:purchase,purchaseQuantity:purchase,unit:receipt.data.unit,transferredFrom:request.id,...(receipt.data.route==='direct'?{warehouseTransferred:true}:{})});
    await updateDocument(tx,actor.id,receipt,'CUSTOMER_SURPLUS_TO_STOCK',{...receipt.data,acceptedShares:mergeAcceptedShares(shares),...(receipt.data.route==='direct'?{movedToWarehouse:add(receipt.data.movedToWarehouse,purchase)}:{})},receipt.version);
    moved.push(source);remaining=sub(remaining,take);if(!gt(remaining,'0'))break;
  }
  if(gt(remaining,'0'))throw new PurchasingError('SURPLUS_RECONCILIATION_REQUIRED','سهم دریافت‌های قدیمی قابل انتقال خودکار نیست؛ ابتدا سوابق انبار را تطبیق دهید.');
  return updateDocument(tx,actor.id,request,'CUSTOMER_SURPLUS_TO_STOCK',{...request.data,surplusTransfers:[...(request.data.surplusTransfers||[]),...moved],sourceVersion:current.version},request.version);
}
