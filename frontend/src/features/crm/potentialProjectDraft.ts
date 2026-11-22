import {draftRecord} from '@/lib/modelDraft';

export type PotentialProjectDraft={customerId:string;title:string;responsibleSellerId:string;status:string;workType:string;
  address:string;estimatedValue:string;probability:string;expectedCloseDate:string;description:string;source:string};
export function parsePotentialProjectDraft(value:unknown):PotentialProjectDraft {
  draftRecord(value,['customerId','title','responsibleSellerId','status','workType','address','estimatedValue','probability','expectedCloseDate','description','source']);
  return value as PotentialProjectDraft;
}
export function emptyPotentialProjectDraft(value:PotentialProjectDraft,defaults:{customerId:string;responsibleSellerId:string;workType:string}){
  return value.customerId===defaults.customerId&&value.responsibleSellerId===defaults.responsibleSellerId
    &&value.workType===defaults.workType&&value.status==='جدید'
    &&!value.title&&!value.address&&!value.estimatedValue&&!value.probability&&!value.expectedCloseDate&&!value.description&&!value.source;
}
