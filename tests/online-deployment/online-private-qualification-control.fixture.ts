/** Data-only verifier. It creates no runtime/native/release capability. */
import {createPublicKey,verify} from 'node:crypto';
export const PRIVATE_QUALIFICATION_CONTROL_FORMAT='sabalan-private-qualification-control/v1';
export type PrivateQualificationControl=Readonly<{format:typeof PRIVATE_QUALIFICATION_CONTROL_FORMAT;session:string;actorId:string;scopeSha256:string;sequence:number;command:'PRIVATE_PREPARE_DRAIN'|'PRIVATE_SHUTDOWN';signature:string}>;
export function verifyPrivateQualificationControl(bytes:Buffer,publicKeyDer:Buffer,expected:Readonly<{session:string;actorId:string;scopeSha256:string;sequence:number}>):PrivateQualificationControl{
 const fail=():never=>{throw Error('PRIVATE_QUALIFICATION_ORIGINAL_CONTROL_UNPROVEN');};
 if(!bytes.length||bytes.length>2048||publicKeyDer.length!==44||publicKeyDer.subarray(0,12).toString('hex')!=='302a300506032b6570032100')fail();
 const v=JSON.parse(bytes.toString('utf8'));
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!=='actorId,command,format,scopeSha256,sequence,session,signature'
  ||v.format!==PRIVATE_QUALIFICATION_CONTROL_FORMAT||v.session!==expected.session||v.actorId!==expected.actorId||v.scopeSha256!==expected.scopeSha256
  ||![v.session,v.actorId,v.scopeSha256].every(value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value))
  ||!Number.isSafeInteger(v.sequence)||v.sequence!==expected.sequence||v.sequence<1
  ||!['PRIVATE_PREPARE_DRAIN','PRIVATE_SHUTDOWN'].includes(v.command)||typeof v.signature!=='string'
  ||!/^[A-Za-z0-9+/]{86}==$/.test(v.signature)||Buffer.from(v.signature,'base64').toString('base64')!==v.signature)fail();
 const key=createPublicKey({key:publicKeyDer,format:'der',type:'spki'});
 const message=Buffer.from([v.format,v.session,v.actorId,v.scopeSha256,String(v.sequence),v.command].join('\0'),'utf8');
 if(key.asymmetricKeyType!=='ed25519'||!verify(null,message,key,Buffer.from(v.signature,'base64')))fail();
 return Object.freeze(v);
}
