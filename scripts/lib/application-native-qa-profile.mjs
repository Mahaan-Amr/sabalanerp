/** Optional local resource evidence; never release/native admission. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {candidateQaMemoryBytes,expandedCandidateQaMemoryBytes,qaSwapBytes,retainedQaMemoryBytes,validateQaMemoryTransitionReceipt} from './application-native-qa-memory.mjs';
const profiles=new WeakMap(),sha=raw=>createHash('sha256').update(raw).digest('hex');
function stable(file){assert.ok(path.isAbsolute(file));file=path.resolve(file);assert.equal(fs.realpathSync(file),file);const a=fs.lstatSync(file,{bigint:true});assert.ok(a.isFile()&&!a.isSymbolicLink()&&a.nlink===1n&&a.size>0n&&a.size<=16n*1024n**2n);const raw=fs.readFileSync(file),b=fs.lstatSync(file,{bigint:true});for(const k of ['dev','ino','size','mtimeNs','ctimeNs','nlink'])assert.equal(a[k],b[k]);return raw;}
function completed(value){assert.equal(value.format,'sabalan-application-native-candidate/v1');assert.equal(value.pass,true);assert.equal(value.phase,'COMPLETE');assert.equal(value.productionAdmission,false);assert.equal(value.up.code,0);assert.equal(value.up.signal,null);assert.equal(value.originalChildren.allOriginalChildrenClosed,true);assert.equal(value.originalChildren.interrupted,false);}
function predecessorIdentity(receipt,predecessor,expanded){
 for(const service of ['backend-candidate','backend-retained']){const old=predecessor.actual[service],observed=receipt.previous[service];assert.equal(old.memoryBytes,service==='backend-candidate'?(expanded?expandedCandidateQaMemoryBytes:candidateQaMemoryBytes):retainedQaMemoryBytes);assert.equal(old.memorySwapBytes,expanded&&service==='backend-candidate'?expandedCandidateQaMemoryBytes:qaSwapBytes);assert.deepEqual(observed,Object.fromEntries(['id','image','startedAt'].map(k=>[k,old[k]])));assert.deepEqual(receipt.reobservedBaseline.identities[service],observed);assert.deepEqual(receipt.reobservedBaseline.previousIdentities[service],observed);assert.equal(receipt.reobservedInstalled[service].code,0);assert.equal(receipt.reobservedInstalled[service].signal,null);assert.equal(receipt.reobservedNativeQuiet[service].originalNativeProcesses,0);assert.equal(receipt.reobservedNativeQuiet[service].adoptsOriginalPopen,false);}
 assert.equal(receipt.reobservedBaseline.format,'sabalan-reobserved-quiescent-installed-slots/v1');for(const key of ['adoptsOriginalPopen','originalNativeClosureInferred','birthReasonClaimed','productionAdmission'])assert.equal(receipt.reobservedBaseline[key],false);assert.equal(receipt.reobservedBaseline.installedBytesVerified,true);assert.equal(receipt.reobservedBaseline.nativeAndSqlQuietVerified,true);assert.equal(receipt.reobservedSqlQuiet.visible,true);assert.equal(receipt.reobservedSqlQuiet.sessions,0);assert.equal(receipt.reobservedSqlQuiet.prepared,0);
}
export function validateExpandedQaMemoryEvidence(receipt,predecessor){validateQaMemoryTransitionReceipt(receipt);assert.equal(receipt.candidateQaMemoryTransition.format,'sabalan-explicit-local-qa-candidate-memory-transition/v3');completed(receipt);completed(predecessor);predecessorIdentity(receipt,predecessor,false);return receipt;}
const sameRef=(a,b)=>{assert.equal(path.resolve(a.file),path.resolve(b.file));assert.equal(a.sha256,b.sha256);};
export function validatePreservedQaMemoryEvidence(receipt,predecessor,transition){
 validateQaMemoryTransitionReceipt(receipt);completed(receipt);completed(predecessor);const p=receipt.candidateQaMemoryProfile;assert.equal(p.format,'sabalan-preserved-local-qa-candidate-memory-profile/v1');sameRef(p.transition,transition);predecessorIdentity(receipt,predecessor,true);
 if(predecessor.candidateQaMemoryTransition?.format==='sabalan-explicit-local-qa-candidate-memory-transition/v3')sameRef(p.predecessor,transition);
 else{validateQaMemoryTransitionReceipt(predecessor);assert.equal(predecessor.candidateQaMemoryProfile.format,p.format);sameRef(predecessor.candidateQaMemoryProfile.transition,transition);}
 return receipt;
}
export function readExplicitQaMemoryProfile(selection){
 if(selection===undefined||selection===null)return null;
 const inputs=new Map();const read=ref=>{assert.deepEqual(Object.keys(ref).sort(),['file','sha256']);assert.match(ref.sha256,/^[a-f0-9]{64}$/);const raw=stable(ref.file);assert.equal(sha(raw),ref.sha256);const file=path.resolve(ref.file);if(inputs.has(file))assert.deepEqual(inputs.get(file).raw,raw);inputs.set(file,{raw,sha256:ref.sha256});return JSON.parse(raw);};
 const receipt=read(selection),preserved=receipt.candidateQaMemoryProfile,transition=preserved?.transition??selection;
 const anchor=read(transition),anchorPrior=anchor.candidateQaMemoryTransition?.predecessor;assert.ok(anchorPrior);assert.equal(anchor.inputs[anchorPrior.file],anchorPrior.sha256);validateExpandedQaMemoryEvidence(anchor,read(anchorPrior));
 if(preserved){assert.equal(receipt.inputs[preserved.predecessor.file],preserved.predecessor.sha256);assert.equal(receipt.inputs[transition.file],transition.sha256);validatePreservedQaMemoryEvidence(receipt,read(preserved.predecessor),transition);}
 else sameRef(selection,transition);
 const descriptor=Object.freeze({format:'sabalan-explicit-local-qa-memory-profile/v1',candidateBytes:expandedCandidateQaMemoryBytes,candidateSwapBytes:expandedCandidateQaMemoryBytes,replacementReceiptSha256:selection.sha256});const token=Object.freeze({});profiles.set(token,{inputs,transition:structuredClone(transition),descriptor});return token;
}
export function readQaMemoryProfile(token){if(token===undefined||token===null)return null;const row=profiles.get(token);assert.ok(row,'ORIGINAL_QA_MEMORY_PROFILE_REQUIRED');for(const[file,pin]of row.inputs)assert.deepEqual(stable(file),pin.raw);return structuredClone(row.descriptor);}
export function qaMemoryProfileTransition(token){readQaMemoryProfile(token);return structuredClone(profiles.get(token).transition);}
export function qaMemoryProfileInputs(token){readQaMemoryProfile(token);return Object.fromEntries([...profiles.get(token).inputs].map(([file,pin])=>[file,pin.sha256]));}
export function expectedQaCandidateMemory(token){return readQaMemoryProfile(token)?.candidateBytes??candidateQaMemoryBytes;}
