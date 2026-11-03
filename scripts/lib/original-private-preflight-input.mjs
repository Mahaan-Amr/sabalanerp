/** Private anonymous input on the SAME supervised Root stdin. No files/env. */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {assertOriginalCandidateRollbackOwner} from './original-candidate-rollback-owner.mjs';
const sequences=new WeakMap(),active=new WeakSet(),refusals=new WeakMap();
export function readOriginalPrivatePreflightRefusal(error,owner){const held=refusals.get(error);assert.ok(held?.owner===owner,'ORIGINAL_PRIVATE_PREFLIGHT_REFUSAL_REQUIRED');assertOriginalCandidateRollbackOwner(owner);return structuredClone(held.record);}

export async function readOriginalPrivatePreflightFrame({input,expected}){
 assert.equal(typeof input.iterator,'function');const iterator=input.iterator({destroyOnReturn:false});let raw=Buffer.alloc(0);
 try{
  for(;;){const part=await iterator.next();assert.equal(part.done,false,'PRIVATE_PREFLIGHT_INPUT_CLOSED');raw=Buffer.concat([raw,Buffer.from(part.value)]);assert.ok(raw.length<=16384,'PRIVATE_PREFLIGHT_FRAME_BOUND');const end=raw.indexOf(10);if(end<0)continue;assert.equal(end,raw.length-1,'PRIVATE_PREFLIGHT_INTERLEAVED_INPUT_REFUSED');break;}
  let value;try{value=JSON.parse(raw.toString());}catch{throw Error('PRIVATE_PREFLIGHT_FRAME_REFUSED');}
  assert.deepEqual(Object.keys(value).sort(),['challenge','credential','format','rootOperation','sequence']);
  assert.equal(value.format,'sabalan-native-c3-private-preflight-input/v1');for(const key of ['rootOperation','sequence','challenge'])assert.equal(value[key],expected[key]);
  const credential=value.credential;delete value.credential;assert.ok(typeof credential==='string'&&credential.length>0&&Buffer.byteLength(credential)<=4096&&!/[\r\n\0]/.test(credential),'PRIVATE_PREFLIGHT_CREDENTIAL_REFUSED');return credential;
 }finally{raw.fill(0);await iterator.return();}
}

export async function acquireOriginalPrivatePreflightCredential(owner,{input=process.stdin,output=process.stdout}={}){
 assertOriginalCandidateRollbackOwner(owner);assert.ok(['PREPARING','MASTER_RETAINED'].includes(owner.inspect().phase));assert.equal(active.has(owner),false,'PRIVATE_PREFLIGHT_ALREADY_ACTIVE');active.add(owner);
 const sequence=(sequences.get(owner)??0)+1;sequences.set(owner,sequence);const expected={rootOperation:owner.operation,sequence,challenge:randomBytes(32).toString('hex')};
 try{
  output.write(JSON.stringify({format:'sabalan-native-c3-private-preflight-request/v1',...expected,phase:owner.inspect().phase,remoteActorsStarted:false,productionAdmission:false})+'\n');
  const credential=await readOriginalPrivatePreflightFrame({input,expected});assertOriginalCandidateRollbackOwner(owner);return credential;
 }catch(error){
  const refused=Error('ORIGINAL_PRIVATE_PREFLIGHT_INPUT_CLOSED_OR_REFUSED');refusals.set(refused,{owner,record:{format:'sabalan-private-preflight-input-refusal/v1',rootOperation:owner.operation,sequence,remoteActorsStarted:false,productionAdmission:false}});throw refused;
 }finally{active.delete(owner);}
}
