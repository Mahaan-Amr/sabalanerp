import {normalizeDigits} from '@/lib/numberFormat';
import {plain,scaled} from './inquiryOrderDefaults';
export const amountValue=(value:unknown):bigint|null=>{
  const text=normalizeDigits(String(value??'')).replace(/[,٬\s]/g,'').replace('٫','.');
  return /^\d{1,35}(\.\d{1,30})?$/.test(text)?scaled(text):null;
};
export function sumSelection(selection:Record<string,string>):bigint|null {
  let total=BigInt(0);
  for(const value of Object.values(selection)){if(!value.trim())continue;const parsed=amountValue(value);if(parsed===null)return null;total+=parsed;}
  return total;
}
export function remainingSelection(selection:Array<{quantity:string}>,requests:Array<{status:string;quantity:string;purchaseQuantity?:string}>) {
  const selected=selection.reduce((total,s)=>total+scaled(s.quantity),BigInt(0));
  const used=requests.filter(r=>r.status!=='CANCELLED').reduce((total,r)=>total+scaled(r.purchaseQuantity||r.quantity),BigInt(0));
  return plain(selected>used?selected-used:BigInt(0));
}
export function suggestedShare(need:unknown,available:unknown,otherSelection:Record<string,string>) {
  const total=sumSelection(otherSelection),required=amountValue(need),capacity=amountValue(available);
  if(total===null)return '';
  const remaining=required===null?capacity:required>total?required-total:BigInt(0);
  if(remaining===null)return '';
  return plain(capacity!==null&&capacity<remaining?capacity:remaining);
}

export function mappedNeed(purchase:unknown,basePurchase:unknown,baseDemand:unknown,priorPurchase:unknown='0',priorDemand:unknown='0'):string|null {
  const p=amountValue(purchase),b=amountValue(basePurchase),d=amountValue(baseDemand),pp=amountValue(priorPurchase),pd=amountValue(priorDemand);
  if(p===null||b===null||d===null||pp===null||pd===null||b===BigInt(0))return null;
  const amount=(p+pp)*d/b-pd;
  return plain(amount>BigInt(0)?amount:BigInt(0));
}
