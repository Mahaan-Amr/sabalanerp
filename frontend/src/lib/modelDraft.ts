/** Domain models supply strict allowlists. Binary values MUST use evidence archives or refuse. */
export type ModelDraftScope={userId:string;sessionId:string;tabId:string;draftId:string;workflow:string;route:string;record:string;baseVersion:string};
export type ModelDraft<T>={format:'sabalan-model-draft/v1';scope:ModelDraftScope;schemaVersion:1;revision:number;submissionUncertain:boolean;model:T};
/** Offer eligibility only. The action must still archive/read back every active
 * draft and recheck owner, revision and live buffers before navigation. */
export function canOfferModelDraftRefresh<T>(input:{active:boolean;ownerCurrent:boolean;busy:boolean;submissionUncertain?:boolean;hasLiveBlocker:boolean;model:T;parse(value:unknown):T}):boolean{
 if(!input.active||!input.ownerCurrent||input.busy||input.submissionUncertain||input.hasLiveBlocker)return false;
 try{strictDraftJson(input.model);strictDraftJson(input.parse(input.model));return true;}catch{return false;}
}
export function strictDraftJson(value:unknown):string{
 const seen=new Set<object>();
 const visit=(item:unknown):void=>{
  if(item===null||typeof item==='string'||typeof item==='boolean')return;
  if(typeof item==='number'&&Number.isFinite(item))return;
  if(typeof item!=='object'||!item)throw Error('DRAFT_VALUE_UNSUPPORTED');
  if(seen.has(item))throw Error('DRAFT_CYCLE');seen.add(item);
  if(!Array.isArray(item)&&Object.getPrototypeOf(item)!==Object.prototype)throw Error('DRAFT_BINARY_OR_CLASS_UNARCHIVED');
  if(Object.getOwnPropertySymbols(item).length)throw Error('DRAFT_HIDDEN_FIELDS');
  if(Array.isArray(item)&&Object.keys(item).length!==item.length)throw Error('DRAFT_SPARSE_ARRAY');
  for(const key of Object.getOwnPropertyNames(item)){if(Array.isArray(item)&&key==='length')continue;if(!Object.getOwnPropertyDescriptor(item,key)?.enumerable)throw Error('DRAFT_HIDDEN_FIELDS');}
  for(const key of Object.keys(item)){const descriptor=Object.getOwnPropertyDescriptor(item,key);if(!descriptor||!('value' in descriptor))throw Error('DRAFT_ACCESSOR');visit(descriptor.value);}
  seen.delete(item);
 };visit(value);const json=JSON.stringify(value);if(new TextEncoder().encode(json).length>1024*1024)throw Error('DRAFT_BOUND');return json;
}
export function parseModelDraft<T>(json:string,parseModel:(value:unknown)=>T):ModelDraft<T>{
 const value=JSON.parse(json);if(!value||Object.keys(value).sort().join(',')!=='format,model,revision,schemaVersion,scope,submissionUncertain'||value.format!=='sabalan-model-draft/v1'||value.schemaVersion!==1||typeof value.submissionUncertain!=='boolean'||!Number.isSafeInteger(value.revision)||value.revision<0)throw Error('DRAFT_SCHEMA_UNSUPPORTED');
 const scope=value.scope;if(!scope||Object.keys(scope).sort().join(',')!=='baseVersion,draftId,record,route,sessionId,tabId,userId,workflow')throw Error('DRAFT_SCOPE_INVALID');
 for(const key of ['userId','sessionId','tabId','draftId','workflow','route','record','baseVersion'])if(typeof scope[key]!=='string'||!scope[key]||scope[key].length>512)throw Error('DRAFT_SCOPE_INVALID');
 if(!scope.route.startsWith('/dashboard/')||/[?#]/.test(scope.route))throw Error('DRAFT_ROUTE_INVALID');
 return {...value,model:parseModel(value.model)};
}
export function assertModelRestore<T>(draft:ModelDraft<T>,current:ModelDraftScope,empty:boolean,reviewed:boolean){
 for(const key of ['userId','workflow','route','record','baseVersion'] as const)if(draft.scope[key]!==current[key])throw Error('DRAFT_RESTORE_SCOPE_CHANGED');
 if(draft.submissionUncertain)throw Error('DRAFT_SUBMISSION_UNCERTAIN');
 if(!empty||!reviewed)throw Error('DRAFT_RESTORE_REVIEW_REQUIRED');
}
/** Explicit domain allowlist: no authority, cookies, staging tokens or hidden fields. */
export function draftRecord(value:unknown,strings:readonly string[],booleans:readonly string[]=[]):Record<string,string|boolean>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('DRAFT_MODEL_INVALID');
 const row=value as Record<string,unknown>,keys=[...strings,...booleans];if(Object.keys(row).sort().join(',')!==keys.slice().sort().join(','))throw Error('DRAFT_MODEL_FIELDS_INVALID');
 for(const key of strings)if(typeof row[key]!=='string'||(row[key] as string).length>200000)throw Error('DRAFT_MODEL_INVALID');
 for(const key of booleans)if(typeof row[key]!=='boolean')throw Error('DRAFT_MODEL_INVALID');
 strictDraftJson(row);return {...row} as Record<string,string|boolean>;
}
