/** Canonical CLI seam: creates one genuine Root and then its original master.
 * The launch file selects immutable content and never supplies owner tokens. */
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {completePlanReader} from './original-complete-plan-files.mjs';
import {createOriginalCandidateRollbackOwner} from './original-candidate-rollback-owner.mjs';
import {originalCompleteConstructorReferences as references} from './original-complete-constructor-inputs.mjs';
import {knownPositive752} from './application-native-post-up-memory-baseline.mjs';
import {nativeHistoricalFile} from './frozen-native-history.mjs';
import {collectApplicationFullCatalogArtifacts} from './application-native-full-catalog-artifacts.mjs';
import {inspectOriginalLocalOnlineCheckpointInputs} from './original-local-online-checkpoint.mjs';
import {readSourceOwnedCompleteBinding} from './original-complete-source-binding.mjs';
import {readOriginalCompleteConstructorPackage} from './original-complete-constructor-package.mjs';
import {inspectOriginalCompletePreUpInputs} from './original-complete-pre-up.mjs';
const root=path.resolve(import.meta.dirname,'../..'),keys=(v,k)=>assert.deepEqual(Object.keys(v).sort(),[...k].sort());
function revalidateEmptyCatalogEntry(entry){
 assert.equal(entry.sha256,'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');assert.equal(fs.realpathSync(entry.file),entry.file);
 const fd=fs.openSync(entry.file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{const opened=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(entry.file,{bigint:true});assert.ok(opened.isFile()&&opened.nlink===1n&&opened.size===0n&&!named.isSymbolicLink());for(const key of ['ino','mode','nlink','size','mtimeNs','ctimeNs']){assert.equal(opened[key],named[key]);assert.equal(named[key],entry.identity[key]);}assert.equal(named.dev,entry.identity.dev);if(process.platform!=='win32')assert.equal(opened.dev,named.dev);}finally{fs.closeSync(fd);}
}
export function readNativeC3MasterLaunch(reference){
 const reader=completePlanReader(),value=JSON.parse(reader.read(reference));keys(value,['format','memoryPolicy','project','operationsSourceCommit','retainedInquiry','localInputs',...(Object.hasOwn(value,'localDevFrontend')?['localDevFrontend']:[])]);
 if(value.localDevFrontend){keys(value.localDevFrontend,['planFile','evidenceDirectory']);const directory=path.dirname(path.resolve(reference.file));assert.equal(path.resolve(value.localDevFrontend.planFile),path.join(directory,'supervisor-plan.json'));assert.equal(path.resolve(value.localDevFrontend.evidenceDirectory),path.join(directory,'original-evidence'));}
 assert.equal(value.format,'sabalan-native-c3-master-entry/v2');assert.equal(value.memoryPolicy,'local-qa-pressure-v1');assert.equal(value.project,'sabalanerp-local');assert.equal(value.operationsSourceCommit,execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim());
 const inputs=value.localInputs;keys(inputs,['nativeOwnerElfReceipt','completeConstructorConfiguration','prismaQualificationReceipt','fullCatalogSelection']);
 reader.read(inputs.nativeOwnerElfReceipt);inspectOriginalLocalOnlineCheckpointInputs({nativeOwnerElfReceipt:inputs.nativeOwnerElfReceipt.file});const binding=readSourceOwnedCompleteBinding();assert.equal(binding.value.format,'sabalan-original-complete-source-binding/v2');assert.deepEqual(inputs.completeConstructorConfiguration,binding.value.configuration);const constructor=readOriginalCompleteConstructorPackage(inputs.completeConstructorConfiguration);binding.revalidate();constructor.revalidate();
 const prisma=inputs.prismaQualificationReceipt;keys(prisma,['file','sha256']);const relative=path.relative(root,prisma.file).split(path.sep).join('/');assert.match(relative,/^reports\/qa\/application-prisma-[a-f0-9]{32}\.json$/);reader.read({file:nativeHistoricalFile(root,relative),sha256:prisma.sha256});
 const capture=name=>{assert.ok(name&&!path.isAbsolute(name)&&!name.split('/').includes('..'));return fs.readFileSync(nativeHistoricalFile(root,name));};
 const catalog=collectApplicationFullCatalogArtifacts({root,capture,selection:inputs.fullCatalogSelection,prismaQualificationReceipt:prisma.file}),manifest=JSON.parse(catalog.files['full-catalog-source-manifest.json']);assert.equal(manifest.compiledPackages.receiptSha256,references.compiled.sha256,'C3_EXACT_CATALOG_COMPILATION_REQUIRED');
 const empty=catalog.entries.filter(v=>v.bytes===0);for(const entry of catalog.entries)if(entry.bytes===0)revalidateEmptyCatalogEntry(entry);else reader.read({file:entry.file,sha256:entry.sha256},256*1024**2);
 keys(value.retainedInquiry,['legacyAugmentationReceipt','legacyAugmentationSha256','startupRefreshReceipt','startupRefreshSha256']);for(const prefix of ['legacyAugmentation','startupRefresh'])reader.read({file:value.retainedInquiry[prefix+'Receipt'],sha256:value.retainedInquiry[prefix+'Sha256']});
 reader.revalidate();return {value,catalog,revalidate(){reader.revalidate();for(const entry of empty)revalidateEmptyCatalogEntry(entry);binding.revalidate();constructor.revalidate();}};
}
export function nativeC3ReplacementArguments(preflight){return ['--replace','--image-receipt',references.image.file,'--material-receipt',references.material.file,'--preflight',preflight.file,'--previous-replacement-receipt',knownPositive752.file,'--previous-replacement-sha256',knownPositive752.sha256,'--isolate-authority-cohort'];}
export async function executeNativeC3MasterEntry(reference,{input=process.stdin,output=process.stdout,connectionOnly=false}={}){
 assert.equal(typeof connectionOnly,'boolean');
 const launch=readNativeC3MasterLaunch(reference);let owner;
 // This is the SAME factory-owned private input. A completed owner cannot
 // leave its referenced stdin pipe waiting on a supervisor waiting on exit.
 let terminalClosure=null,terminalInputFault=false;
 async function retireTerminalInput(){
  // The original owner has already proved closure. Never re-close or re-hold
  // it after a transport fault; retain this SAME input until actual close.
  assert.ok(terminalClosure);
  while(!input.closed){
   let wake;const changed=new Promise(resolve=>{wake=resolve;}),closed=()=>wake(),failed=()=>{terminalInputFault=true;process.exitCode=1;wake();};
   input.once('close',closed);input.once('error',failed);
   try{input.destroy();}catch{failed();}
   if(!input.closed){await Promise.race([changed,new Promise(resolve=>setTimeout(resolve,20))]);if(!input.closed)await new Promise(resolve=>setTimeout(resolve,20));}
   input.off('close',closed);input.off('error',failed);
  }
  assert.equal(input.destroyed,true);
 }
 async function closeTerminalOwner(){
  const closure=await owner.closeReadOnlyOrRestored(),state=owner.inspect();
  assert.equal(closure.leaseClosed,true);assert.equal(state.released,true);assert.equal(state.unknown,false);assert.equal(state.cancelled,false);
  assert.ok(['PREPARING','PREPARED_READ_ONLY','PREPARATION_FAILED','FAILED_BEFORE_UP','RESTORED_AFTER_FAILED_UP','RESTORED_AFTER_KNOWN_FAILED_LOCAL'].includes(state.phase));
  terminalClosure=closure;
  await retireTerminalInput();
  try{output.write(JSON.stringify({format:'sabalan-native-c3-terminal-input-closed/v1',rootOperation:owner.operation,leaseClosed:true,inputClosed:true,qualificationAccepted:false,productionAdmission:false})+'\n');}catch{terminalInputFault=true;process.exitCode=1;}
  if(terminalInputFault)throw Error('ORIGINAL_TERMINAL_INPUT_OR_OUTPUT_FAILED');
  return closure;
 }
 try{
  owner=await createOriginalCandidateRollbackOwner({privateInput:input,privateOutput:output});
  if(launch.value.localDevFrontend){const suspension=await owner.suspendDevelopmentFrontend(launch.value.localDevFrontend);launch.revalidate();output.write(JSON.stringify({format:'sabalan-native-c3-development-frontend-stopped/v1',suspension,upStarted:false,masterStarted:false,qualificationAccepted:false,productionAdmission:false})+'\n');}
  if(connectionOnly){const artifacts=inspectOriginalCompletePreUpInputs(),preflight=await owner.freshPreUpPreflight(),argv=nativeC3ReplacementArguments(preflight);argv[0]='--inspect';const receipt=await owner.runReplacement(argv,{inspectionOnly:true});assert.equal(receipt.phase,'PREPARED_READ_ONLY');assert.equal(receipt.inspectionVerified,true);launch.revalidate();inspectOriginalCompletePreUpInputs();const closure=await closeTerminalOwner();output.write(JSON.stringify({format:'sabalan-native-c3-connected-pre-up/v1',receipt,closure,artifacts,frontendLifecycleExercised:Boolean(launch.value.localDevFrontend),catalog:launch.catalog.proof,qualificationAccepted:false,upStarted:false,masterStarted:false,productionAdmission:false})+'\n');return;}
  const preflight=await owner.freshPreUpPreflight();launch.revalidate();
  const replacement=await owner.runReplacement(nativeC3ReplacementArguments(preflight));assert.equal(replacement.phase,'CANDIDATE_VERIFIED','NATIVE_C3_REPLACEMENT_NOT_VERIFIED');
  launch.revalidate();const selected=await owner.prepareMasterInputs(preflight.file,launch.value.retainedInquiry),bindings={nativeOwnerElfReceipt:launch.value.localInputs.nativeOwnerElfReceipt,completeConstructorConfiguration:launch.value.localInputs.completeConstructorConfiguration};
  output.write(JSON.stringify({format:'sabalan-native-c3-root-ready/v1',operation:owner.operation,...selected,productionAdmission:false})+'\n');
  await owner.continueWithOriginalMaster({...selected,prismaQualificationReceipt:launch.value.localInputs.prismaQualificationReceipt.file,fullCatalogSelection:launch.value.localInputs.fullCatalogSelection,initialInputBindings:bindings,input,output});
  if(['RESTORED_AFTER_KNOWN_FAILED_LOCAL','RESTORED_AFTER_FAILED_UP'].includes(owner.inspect().phase))await closeTerminalOwner();
 }catch(error){
  process.exitCode=1;if(owner&&!terminalClosure){try{owner.recordEntryFailure(error);}catch{}if(owner.inspect().phase==='CANDIDATE_VERIFIED')await owner.restoreBeforeMasterFailure(error);try{await closeTerminalOwner();}catch{if(!terminalClosure)await owner.retainUnclassifiedFailure(error);}}
  if(terminalClosure)await retireTerminalInput();
  try{output.write(JSON.stringify({format:'sabalan-native-c3-entry-failed/v1',owner:owner?.inspect()??null,errorType:error?.name??'Error',terminalInputFault,qualificationSucceeded:false,productionAdmission:false})+'\n');}catch{process.exitCode=1;}
 }
}
