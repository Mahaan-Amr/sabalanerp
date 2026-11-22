'use client';
import {ErpButton,ErpDisclosure} from '@/components/erp';
import {ModelDraftRecovery} from '@/components/ModelDraftRecovery';
import {useModelDraftRecovery} from '@/lib/useModelDraftRecovery';
export type PurchaseFormModel={draft:Record<string,string|boolean>;allocations:Array<{requestId:string;quantity:string;purchaseQuantity:string}>;costs:Array<{title:string;recipientId:string;amount:string}>};
function parse(value:unknown):PurchaseFormModel {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_PURCHASE_DRAFT');
  const model=value as PurchaseFormModel;
  if(Object.keys(model).sort().join(',')!=='allocations,costs,draft'||!model.draft||Array.isArray(model.draft)||Object.values(model.draft).some(v=>typeof v!=='string'&&typeof v!=='boolean')||!Array.isArray(model.allocations)||!Array.isArray(model.costs)||[...model.allocations,...model.costs].some(row=>!row||typeof row!=='object'||Object.values(row).some(v=>typeof v!=='string')))throw Error('INVALID_PURCHASE_DRAFT');
  return model;
}
export function PurchaseDraftRecovery({action,record,version,model,onRestore,busy,uncertain}:{action:string;record:string;version:string;model:PurchaseFormModel;onRestore:(value:PurchaseFormModel)=>void;busy:boolean;uncertain:boolean}) {
  const empty=Object.entries(model.draft).every(([key,value])=>['documentId','expectedVersion','receiptId'].includes(key)||value===''||value===false)&&!model.allocations.length&&!model.costs.length;
  const recovery=useModelDraftRecovery({workflow:'purchasing-form',route:`/dashboard/purchasing/form/${action}`,record,baseVersion:version,model,empty,active:true,busy,submissionUncertain:uncertain,parse,restore:onRestore});
  return <ErpDisclosure title="حفظ و بازیابی پیش‌نویس"><div className="space-y-3"><ModelDraftRecovery recovery={recovery} empty={empty}/>{!empty&&<ErpButton label="خالی‌کردن فرم برای بازیابی" variant="ghost" disabled={busy||uncertain} onClick={()=>onRestore({draft:Object.fromEntries(Object.entries(model.draft).map(([key,value])=>[key,['documentId','expectedVersion','receiptId'].includes(key)?value:typeof value==='boolean'?false:''])),allocations:[],costs:[]})}/>}</div></ErpDisclosure>;
}
