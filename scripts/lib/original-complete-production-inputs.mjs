/** Actual finite read-only prerequisites under the SAME retained Root lease.
 * Only this factory's own originals can create the ephemeral input token. */
import assert from'node:assert/strict';import path from'node:path';import fs from'node:fs';
import{assertOriginalCandidateRollbackOwner}from'./original-candidate-rollback-owner.mjs';import{originalBackendBaseCommands}from'./production-backend-base-process.mjs';import{freshBothHostBackendBasePreflight}from'./production-backend-base-artifacts.mjs';import{completePlanReader,completePlanSha as sha}from'./original-complete-plan-files.mjs';
import{collectOriginalReadOnlyStoragePreflight,readOriginalReadOnlyStorageRefusal}from'./original-readonly-storage-preflight.mjs';
const tokens=new WeakMap(),Q='D:/sabalanerp-online-qa',python='C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe';
const closedRefusals=new WeakMap();
export function readOriginalClosedProductionInputRefusal(error,owner){const held=closedRefusals.get(error);assert.ok(held&&held.owner===owner,'ORIGINAL_CLOSED_PRODUCTION_INPUT_REFUSAL_REQUIRED');held.revalidate();return structuredClone(held.record);}
export function readOriginalCompleteBaselineWrapper(reader){const reference={file:path.resolve(Q+'/C29-installed45cab-healthy-baseline-source-r2-exact-bytes-20261024/run-baseline-observer.py'),sha256:'ee1ef2a1560e965e7709cc355c7cb5902640a9ee08e3fca93d437eee20473bed'};const raw=reader.read(reference);assert.equal(sha(raw),reference.sha256,'COMPLETE_BASELINE_WRAPPER_CHANGED');return reference;}
export function readOriginalCompleteProductionInputs(token,owner){const held=tokens.get(token);assert.ok(held&&held.owner===owner,'ORIGINAL_COMPLETE_PRODUCTION_INPUT_OWNER_REQUIRED');held.revalidate();return held;}
export async function collectOriginalCompleteProductionInputs(owner,{beforeLocal=false,localCompletion,independentCompletion}={}){
 assert.equal(typeof beforeLocal,'boolean');const assertCurrent=()=>beforeLocal?owner.assertPreparingCurrent():owner.assertCompleteCurrent();
 assertOriginalCandidateRollbackOwner(owner);await assertCurrent();const root=path.resolve(import.meta.dirname,'../..'),reader=completePlanReader(),commands=originalBackendBaseCommands(),children=[];let closure,baseline,preparation,preflight,storage,failure;
 const pin=file=>({file:path.resolve(file),sha256:sha(fs.readFileSync(file))});
 async function run(args){assertOriginalCandidateRollbackOwner(owner);await assertCurrent();const row=await commands.run(python,['-I','-B',...args],{maximum:2*1024**2});children.push(row);commands.assertSuccessful(row);assert.ok(row.stdoutEof&&row.stderrEof&&!row.killed);assert.equal(row.stderr,'');await assertCurrent();return JSON.parse(row.stdout.trim());}
 try{
  const baselineWrapper=readOriginalCompleteBaselineWrapper(reader);
  baseline=await run(['-c',"import pathlib,hashlib,sys;file=sys.argv.pop(1);raw=pathlib.Path(file).read_bytes();assert hashlib.sha256(raw).hexdigest()=='ee1ef2a1560e965e7709cc355c7cb5902640a9ee08e3fca93d437eee20473bed';sys.argv[0]=file;exec(compile(raw,file,'exec'),{'__name__':'__main__','__file__':file})",baselineWrapper.file,'--observe-reviewed','--installation',Q+'/offline-source-install-original-20261024T161731966906Z.json','--installation-sha256','4ce668432ad3a82b3b1224ecc7305c1c734e9862d2bc64d1040c9073940676f3','--installation-original-sha256','77f249b57bee1e92799e5b2a2b9d0bc4419f5a73ab0b76efd540dc54f026eb19']);assert.equal(baseline.qualified,true,'COMPLETE_FRESH_HEALTHY_PRODUCTION_BASELINE_REQUIRED');
  preparation=await run([path.join(root,'deploy/scripts/prepare-original-complete-production-inputs-v2.py'),baseline.file,baseline.sha256]);reader.read(preparation.source);reader.read(preparation.runtime);reader.read(preparation.producerReview);
  const review=JSON.parse(reader.read(preparation.producerReview)),admission=review.files['current-admission.py'];assert.ok(admission);reader.read(admission);
  storage=await collectOriginalReadOnlyStoragePreflight(owner,{runtime:preparation.runtime,admission,beforeLocal,localCompletion,independentCompletion});
  storage.revalidate();const file=path.join(root,'reports/qa/both-host-preflight-no-delete-'+storage.record.operation+'.json'),raw=Buffer.from(JSON.stringify(storage.report)+'\n');const fd=fs.openSync(file,'wx',0o600);try{let n=0;while(n<raw.length){const count=fs.writeSync(fd,raw.subarray(n));assert.ok(count>0);n+=count;}fs.fsyncSync(fd);}finally{fs.closeSync(fd);}assert.equal(sha(fs.readFileSync(file)),sha(raw));preflight={report:file};
 }catch(error){failure=error;}finally{closure=await commands.close();}
 if(failure){
  assert.equal(closure.allOriginalChildrenClosed,true);assert.equal(closure.interrupted,false);
  let negative;try{negative=readOriginalReadOnlyStorageRefusal(failure,owner);}catch{/* Unknown custody is never converted into a closed refusal. */}
  if(negative)closedRefusals.set(failure,{owner,record:{...negative,preparationOriginals:closure},revalidate(){assertOriginalCandidateRollbackOwner(owner);reader.revalidate();readOriginalReadOnlyStorageRefusal(failure,owner);}});
  throw failure;
 }
 assert.equal(closure.allOriginalChildrenClosed,true);assert.equal(closure.interrupted,false);const preflightRef=pin(preflight.report??preflight.file);reader.read(preflightRef);const canonical=freshBothHostBackendBasePreflight(root,preflightRef.file);
 const review=JSON.parse(reader.read(preparation.producerReview)),admission=review.files['current-admission.py'];assert.ok(admission);reader.read(admission);const spec=JSON.parse(reader.read(preparation.runtime));assert.equal(spec.freshRuntimeBaselineReceipt.sha256,baseline.sha256);assert.equal(spec.freshRuntimeBaseline.readOnly,true);assert.equal(spec.freshRuntimeBaseline.allOriginalChildrenClosed,true);
 const value={format:'sabalan-original-complete-production-inputs/v1',beforeLocal,baseline:{file:baseline.file,sha256:baseline.sha256},runtime:preparation.runtime,admission:{file:admission.file,sha256:admission.sha256},producerReview:preparation.producerReview,preflight:preflightRef,canonical,observedAt:canonical.observedAt,originalChildren:closure,productionAdmission:false};
 const token=Object.freeze({});tokens.set(token,{owner,value,revalidate(){assertOriginalCandidateRollbackOwner(owner);reader.revalidate();freshBothHostBackendBasePreflight(root,preflightRef.file);assert.ok(Date.now()-Date.parse(value.observedAt)<=600000,'COMPLETE_PRODUCTION_INPUTS_EXPIRED');},children});await assertCurrent();return token;
}
