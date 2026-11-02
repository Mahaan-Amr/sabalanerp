import { receiveAcceptedPurchase, returnAcceptedPurchase, purchaseCustodyProjection } from '../inventoryPurchaseCustody';
import { add, sub, min, max, gt, proportionalQuantity, PurchasingError, type Doc, type JsonObject } from './domain';
import { asDoc, type Tx } from './repository';
import { currentRequestNeed } from './currentNeed';

export { purchaseCustodyProjection };
/** Persist who actually received accepted material. Later returns must not shift
 * another customer's share just because a total changed. */
export async function acceptedPurchaseShares(tx:Tx,order:Doc,amount:string,receiptCustomerId:string|null) {
  const receipts=(await tx.purchasingDocument.findMany({where:{kind:'RECEIPT',parentId:order.id}})).map(asDoc);
  const allocations:JsonObject[]=order.data.effectiveAllocations||order.data.allocations||[];
  let remaining=amount;
  const shares:JsonObject[]=[];
  // Earlier operational receipts remain authoritative facts without inventing
  // inventory events. Their accepted quantities still consume allocation space.
  let legacyAccepted=add(...receipts.filter(r=>order.data.route!=='direct'||r.customerId===receiptCustomerId).map(r=>max('0',sub(sub(r.data.accepted||'0',r.data.acceptedReturned||'0'),add(...(r.data.acceptedShares||[]).map((s:JsonObject)=>s.purchaseQuantity))))));
  for(const allocation of allocations) {
    if(order.data.route==='direct'&&allocation.customerId!==receiptCustomerId)continue;
    const previous=receipts.flatMap(r=>r.data.acceptedShares||[]).filter(s=>s.requestId===allocation.requestId);
    const legacy=min(legacyAccepted,allocation.purchaseQuantity);legacyAccepted=sub(legacyAccepted,legacy);
    const used=add(legacy,...previous.map(s=>s.purchaseQuantity));
    let take=min(remaining,max('0',sub(allocation.purchaseQuantity,used)));
    if(!gt(take,'0'))continue;
    const priorDemand=add(proportionalQuantity(legacy,allocation.purchaseQuantity,allocation.quantity),...previous.map(s=>s.quantity));
    if(allocation.contractId) {
      const request=asDoc(await tx.purchasingDocument.findUniqueOrThrow({where:{id:allocation.requestId}}));
      const need=await currentRequestNeed(tx,request);
      const otherLinks=await tx.purchasingLink.findMany({where:{targetId:request.id,purpose:'ALLOCATION',sourceId:{not:order.id},source:{status:{not:'VOID'}}},select:{sourceId:true}});
      const otherIds=otherLinks.map(l=>l.sourceId);
      const otherDocs=(await tx.purchasingDocument.findMany({where:{OR:[{id:{in:otherIds}},{kind:'RECEIPT',parentId:{in:otherIds}}]}})).map(asDoc);
      const otherAccepted=add(...otherDocs.filter(d=>d.kind==='ORDER').map(o=>acceptedDemandForRequest(o,otherDocs,request)));
      const remainingDemand=max('0',sub(sub(need.quantity||'0',priorDemand),otherAccepted));
      take=min(take,proportionalQuantity(remainingDemand,allocation.quantity,allocation.purchaseQuantity));
      if(!gt(take,'0'))continue;
    }
    const demand=max('0',sub(proportionalQuantity(add(used,take),allocation.purchaseQuantity,allocation.quantity),priorDemand));
    shares.push({requestId:allocation.requestId,contractId:allocation.contractId,itemId:allocation.itemId,customerId:allocation.customerId,purchaseQuantity:take,quantity:demand,unit:allocation.unit,purposeId:allocation.contractId?`contract:${allocation.contractId}:item:${allocation.itemId}`:null});
    remaining=sub(remaining,take);if(!gt(remaining,'0'))break;
  }
  if(gt(remaining,'0'))shares.push({requestId:null,contractId:null,purchaseQuantity:remaining,quantity:remaining,unit:order.data.unit,purposeId:null});
  return shares;
}

export async function recordAcceptedCustody(tx:Tx,actorId:string,receipt:Doc,amount:string,shares:JsonObject[]) {
  if(receipt.data.route!=='warehouse'||!gt(amount,'0'))return null;
  return receiveAcceptedPurchase(tx,{receiptId:receipt.id,version:receipt.version,actorId,quantity:amount,unit:receipt.data.unit,location:receipt.data.location,shares:shares.filter(s=>s.purposeId).map(s=>({purposeId:s.purposeId,quantity:s.purchaseQuantity})),source:{receiptId:receipt.id,version:receipt.version,actorId,quantity:amount,unit:receipt.data.unit,shares}});
}

export async function returnedPurchaseShares(tx:Tx,actorId:string,receipt:Doc,amount:string,input:JsonObject) {
  const shares:JsonObject[]=(receipt.data.acceptedShares||[]).map((s:JsonObject)=>({...s}));
  if(!shares.length)return null;
  const eligible=shares.filter(s=>gt(s.purchaseQuantity,'0')&&!s.warehouseTransferred);
  const chosen=input.shareRequestId||input.shareRequestId===''?String(input.shareRequestId==='stock'?'':input.shareRequestId):eligible.length===1?String(eligible[0].requestId||''):null;
  if(chosen===null)throw new PurchasingError('RETURN_SHARE_REQUIRED','این رسید چند سهم دارد؛ مشخص کنید برگشت از سهم کدام قرارداد یا انبار است.',400,'shareRequestId');
  const share=eligible.find(s=>String(s.requestId||'')===chosen);
  if(!share||gt(amount,share.purchaseQuantity))throw new PurchasingError('RETURN_SHARE_EXCEEDED','مقدار برگشت از سهم انتخاب‌شده بیشتر است.',400,'quantity');
  const cut=proportionalQuantity(amount,share.purchaseQuantity,share.quantity);
  share.purchaseQuantity=sub(share.purchaseQuantity,amount);share.quantity=sub(share.quantity,cut);
  const effect=receipt.data.route==='warehouse'?await returnAcceptedPurchase(tx,{receiptId:receipt.id,version:receipt.version+1,actorId,quantity:amount,shares:share.purposeId?[{purposeId:share.purposeId,quantity:amount}]:[],source:{receiptId:receipt.id,version:receipt.version+1,action:'RETURN_ACCEPTED',quantity:amount,requestId:share.requestId,actorId,reason:input.reason}}):null;
  return {shares,effect};
}

export function mergeAcceptedShares(shares:JsonObject[]) {
  const merged=new Map<string,JsonObject>();
  for(const share of shares){const key=String(share.requestId||`stock:${share.warehouseTransferred?'warehouse':'here'}`),prior=merged.get(key);merged.set(key,{...share,purchaseQuantity:add(prior?.purchaseQuantity,share.purchaseQuantity),quantity:add(prior?.quantity,share.quantity)});}
  return [...merged.values()];
}

export function acceptedDemandForRequest(order:Doc,docs:Doc[],request:Doc) {
  const receipts=docs.filter(r=>r.kind==='RECEIPT'&&r.parentId===order.id&&(order.data.route!=='direct'||r.customerId===request.customerId));
  const persisted=add(...receipts.flatMap(r=>r.data.acceptedShares||[]).filter((s:JsonObject)=>s.requestId===request.id).map((s:JsonObject)=>s.quantity));
  const legacy=add(...receipts.map(r=>max('0',sub(sub(r.data.accepted||'0',r.data.acceptedReturned||'0'),add(...(r.data.acceptedShares||[]).map((s:JsonObject)=>s.purchaseQuantity))))));
  const allocations:JsonObject[]=order.data.allocations||[],allocation=allocations.find(a=>a.requestId===request.id);
  if(!allocation)return persisted;
  const before=add(...allocations.slice(0,allocations.indexOf(allocation)).filter(a=>order.data.route!=='direct'||a.customerId===request.customerId).map(a=>a.purchaseQuantity));
  const share=min(allocation.purchaseQuantity,max('0',sub(legacy,before)));
  return add(persisted,proportionalQuantity(share,allocation.purchaseQuantity,allocation.quantity));
}
