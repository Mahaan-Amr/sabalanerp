export type SupportOriginOwner={userId:string;sessionId:string};
const valid=(value:SupportOriginOwner)=>value&&Object.keys(value).sort().join(',')==='sessionId,userId'
  &&[value.userId,value.sessionId].every(part=>typeof part==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(part));
export function supportOriginKey(owner:SupportOriginOwner){if(!valid(owner))throw Error('SUPPORT_ORIGIN_OWNER_UNPROVEN');return 'sabalan:support-origin:v1:'+owner.userId+':'+owner.sessionId;}
export function ownedSupportOrigin(owner:SupportOriginOwner,origin:Record<string,unknown>){
  supportOriginKey(owner);if(!origin||typeof origin.route!=='string')throw Error('SUPPORT_ORIGIN_UNVERIFIED');
  const value={format:'sabalan-owned-support-origin/v1',owner:{userId:owner.userId,sessionId:owner.sessionId},origin};
  const raw=JSON.stringify(value);if(new TextEncoder().encode(raw).length>512*1024)throw Error('SUPPORT_ORIGIN_TOO_LARGE');return raw;
}
export function readOwnedSupportOrigin(raw:string,owner:SupportOriginOwner):Record<string,unknown>&{route:string}{
  supportOriginKey(owner);if(new TextEncoder().encode(raw).length>512*1024)throw Error('SUPPORT_ORIGIN_TOO_LARGE');
  const value=JSON.parse(raw);
  if(!value||Object.keys(value).sort().join(',')!=='format,origin,owner'||value.format!=='sabalan-owned-support-origin/v1'
    ||!valid(value.owner)||value.owner.userId!==owner.userId||value.owner.sessionId!==owner.sessionId
    ||!value.origin||Array.isArray(value.origin)||typeof value.origin.route!=='string')throw Error('SUPPORT_ORIGIN_OWNER_UNPROVEN');
  return value.origin;
}
