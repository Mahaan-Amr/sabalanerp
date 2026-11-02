import {assertCapability,type Actor,type Access} from './access';
import {quantity,money,required,text,date,PurchasingError,type JsonObject} from './domain';
import {createDocument,type Tx} from './repository';
import {contractSource,partnerPurchaseSource} from './source';

/** Capture a fact that already happened. No earlier RFQ, Request, approval,
 * inventory movement, invoice or payment is fabricated by this path. */
export async function historicalPurchase(tx:Tx,actor:Actor,access:Access,input:JsonObject) {
  assertCapability(access.buyer);
  const occurredAt=date(required(input.occurredAt,'occurredAt','تاریخ واقعی خرید'))!;
  if(new Date(`${occurredAt}T00:00:00+03:30`).getTime()>Date.now())throw new PurchasingError('FUTURE_HISTORICAL_DATE','تاریخ خرید انجام‌شده نمی‌تواند در آینده باشد.',400,'occurredAt');
  const supplier=await tx.purchasingSupplier.findUnique({where:{id:required(input.supplierId,'supplierId','تأمین‌کننده')}});
  if(!supplier?.isActive)throw new PurchasingError('INVALID_SUPPLIER','تأمین‌کننده فعال را انتخاب کنید.',400,'supplierId');
  const q=quantity(input.quantity),unit=required(input.unit,'unit','واحد خرید'),stone=required(input.stone,'stone','سنگ خریداری‌شده');
  let contractId:string|null=null,customerId:string|null=null,source:JsonObject|null=null,exception:string|null=null;
  if(input.contractId) {
    const contract=await tx.salesContract.findUnique({where:{id:input.contractId},select:{id:true,contractNumber:true,customerId:true}});
    if(!contract)throw new PurchasingError('CONTRACT_NOT_FOUND','قرارداد واقعی پیدا نشد؛ شماره قرارداد را بررسی کنید.',404);
    contractId=contract.id;customerId=contract.customerId;
    source={contractId,itemId:required(input.itemId,'itemId','ردیف قرارداد'),contractNumber:contract.contractNumber};
    const row=await tx.contractItem.findFirst({where:{contractId,OR:[{id:source.itemId},{productRowId:source.itemId}]},select:{id:true}});
    const partner=await tx.salesContract.findUnique({where:{id:contractId},select:{partnerCaseId:true}});
    if(partner?.partnerCaseId&&!(await partnerPurchaseSource(tx,partner.partnerCaseId)).partner.products.some(p=>p.productRowId===source!.itemId))throw new PurchasingError('CONTRACT_SOURCE_CHANGED','ردیف انتخاب‌شده متعلق به پرونده همکار نیست.');
    if(!row&&!partner?.partnerCaseId)throw new PurchasingError('CONTRACT_SOURCE_CHANGED','ردیف موردنظر متعلق به این قرارداد نیست.');
    try{await contractSource(tx,access,contractId,row?.id||source.itemId,true,new Date(`${occurredAt}T23:59:59.999+03:30`));}
    catch(error){if(error instanceof PurchasingError&&['FINANCIAL_RECORD_REQUIRED','CONTRACT_SOURCE_CHANGED','PARTNER_SOURCE_UNVERIFIED'].includes(error.code))exception='FINANCIAL_RECORD_MISSING_AT_CAPTURE';else throw error;}
  }
  return createDocument(tx,actor.id,'ORDER',{stone,quantity:q,unit,price:money(input.price),supplierId:supplier.id,supplierName:supplier.name,allocations:[],historicalSources:source?[source]:[],costs:[],route:input.route==='direct'?'direct':'warehouse',historical:true,captureOnly:true,occurredAt,exception,notes:text(input.notes),paymentTerms:text(input.paymentTerms),priorSystemRequest:false},{ownerId:actor.id,contractId,customerId});
}
