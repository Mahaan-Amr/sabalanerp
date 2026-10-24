/** Private verified creation-predecessor evidence; never native/business admission. */
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createNegativeEvidenceReader} from './application-native-negative-evidence.mjs';
import {validateAuthorityCohortSlots} from './application-native-authority-cohort.mjs';
import {validateNegativeAcceptanceSlots} from './application-native-negative-acceptance.mjs';
import {nativeMaterialIdentity,validateInstalledNativeRole} from '../replace-application-native-candidate-local.mjs';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const verifier=fileURLToPath(new URL('./application-native-negative-baseline.policy.py',import.meta.url));
const python='C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe';
const tokens=new WeakMap();
export function readNegativeRecoveryHandoff(selection){
 if(selection===undefined||selection===null)return null;
 const reader=createNegativeEvidenceReader();reader.read(selection);
 const policyRef={file:verifier,sha256:sha(fs.readFileSync(verifier))};reader.read(policyRef);
 assert.equal(process.platform,'win32','NEGATIVE_RECOVERY_LOCAL_WINDOWS_ONLY');assert.equal(fs.realpathSync(python),path.resolve(python),'NEGATIVE_RECOVERY_PYTHON_ALIAS');
 const child=spawnSync(python,['-I','-B',verifier,'--verify-handoff',selection.file,selection.sha256],{cwd:path.dirname(verifier),env:{SystemRoot:process.env.SystemRoot},encoding:null,windowsHide:true,maxBuffer:2*1024**2});
 assert.ok(Number.isSafeInteger(child.pid)&&child.pid>0,'NEGATIVE_VERIFIER_ORIGINAL_CHILD_REQUIRED');assert.equal(child.error,undefined,'NEGATIVE_VERIFIER_CHILD_IO_FAILURE');assert.equal(child.status,0,'NEGATIVE_HANDOFF_REFUSED');assert.equal(child.signal,null);assert.ok(Buffer.isBuffer(child.stdout)&&Buffer.isBuffer(child.stderr));assert.equal(child.stderr.length,0,'NEGATIVE_VERIFIER_STDERR');
 const value=JSON.parse(child.stdout);assert.deepEqual(Object.keys(value).sort(),['format','sourceCommit','operationRoot','historicalCandidateReplacement','identities','qualificationSlots','protectedEight','acceptance','authorityCohort','inputs','streamingInputs','qualificationSucceeded','productionAdmission','adoptsOriginalPopen'].sort());assert.equal(value.format,'sabalan-c16-verified-negative-predecessor/v1');assert.equal(value.sourceCommit,'350419a8ade0586eb12ecf897e224eac5e935aa0');assert.equal(value.operationRoot,'/app/online-runtime-acceptance/application-native-9f510fc82852cac004f91366a2b7bec0');for(const flag of ['qualificationSucceeded','productionAdmission','adoptsOriginalPopen'])assert.equal(value[flag],false);
 assert.ok(value.inputs&&typeof value.inputs==='object'&&!Array.isArray(value.inputs));for(const [file,digest]of Object.entries(value.inputs))reader.read({file,sha256:digest});const streamed=Object.values(value.streamingInputs);assert.equal(streamed.length,5,'EXACT_CURRENT_C16_STREAM_SET');assert.equal(streamed.filter(v=>v.kind==='archive').length,3,'EXACT_THREE_CURRENT_C16_ARCHIVES');assert.equal(streamed.filter(v=>v.kind==='source-snapshot').length,1,'EXACT_ONE_CURRENT_C16_LARGE_SOURCE');assert.equal(streamed.filter(v=>v.kind==='archive-inventory').length,1,'EXACT_ONE_CURRENT_C16_ARCHIVE_INVENTORY');for(const[file,ref]of Object.entries(value.streamingInputs))reader.readStream({file,...ref});reader.recheck();
 const token=Object.freeze({});tokens.set(token,{reader,value:structuredClone(value),selection:structuredClone(selection)});return token;
}
export function negativeRecoveryDescriptor(token){const row=tokens.get(token);assert.ok(row,'ORIGINAL_NEGATIVE_PREDECESSOR_REQUIRED');row.reader.recheck();return structuredClone(row.value);}
export function negativeRecoveryInputs(token){negativeRecoveryDescriptor(token);return tokens.get(token).reader.inputs();}
export function negativeRecoveryStreamingInputs(token){negativeRecoveryDescriptor(token);return tokens.get(token).reader.streamingInputs();}
export function negativeRecoverySelection(token){negativeRecoveryDescriptor(token);return structuredClone(tokens.get(token).selection);}
const canonical=v=>v&&typeof v==='object'?Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
function normalized(container){const raw=JSON.stringify(canonical(Object.fromEntries(['Config','HostConfig','Mounts'].map(k=>[k,container[k]])))).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));return{service:container.Config.Labels['com.docker.compose.service'],id:container.Id,image:container.Image,startedAt:container.State.StartedAt,running:container.State.Running,pid:container.State.Pid,status:container.State.Status,health:container.State.Health?.Status??null,configurationSha256:sha(raw),ips:Object.values(container.NetworkSettings.Networks).map(v=>v.IPAddress)};}
export function negativeRecoveryAcceptance(token){const {namedVolume,subpath,target}=negativeRecoveryDescriptor(token).acceptance;return{namedVolume,subpath,target};}
export function validateNegativeRecoveryPhysicalReadback(token,containers){
 const descriptor=negativeRecoveryDescriptor(token),expected=[...descriptor.protectedEight,...Object.values(descriptor.qualificationSlots)];assert.equal(expected.length,10);assert.deepEqual(Object.keys(containers).sort(),expected.map(v=>v.service).sort());
 for(const wanted of expected){const c=containers[wanted.service];assert.equal(c.Config.Labels['com.docker.compose.project'],'sabalanerp-local');assert.deepEqual(normalized(c),wanted,'NEGATIVE_PHYSICAL_BASELINE_CHANGED:'+wanted.service);assert.equal(c.State.Running,true);assert.equal(c.State.Health.Status,'healthy');}
 validateAuthorityCohortSlots(containers,descriptor.authorityCohort.nonce);validateNegativeAcceptanceSlots(containers,negativeRecoveryAcceptance(token));
 return{format:'sabalan-reobserved-negative-unqualified-slots/v1',qualificationSucceeded:false,historicalPhysicalIdentityClaimed:false,adoptsOriginalPopen:false,originalNativeClosureInferred:false,productionAdmission:false,identities:structuredClone(descriptor.identities),installedBytesVerified:false,nativeAndSqlQuietVerified:false,currentEmptyNamespacesVerified:false};
}
export function validateNegativeRecoveryCreatedReceipt(token,receipt){
 const descriptor=negativeRecoveryDescriptor(token),reader=tokens.get(token).reader,history=reader.json(descriptor.historicalCandidateReplacement);
 assert.deepEqual(receipt.previous,descriptor.identities);assert.deepEqual(receipt.negativeRecoveryHandoff,negativeRecoverySelection(token));assert.equal(receipt.previousReplacement,undefined);assert.equal(receipt.failedAuthorityCohort,undefined);assert.equal(receipt.knownNegativeCancellationRetirement,undefined);
 for(const service of ['backend-candidate','backend-retained']){
  const peer=service==='backend-candidate'?'backend-retained':'backend-candidate',role=service==='backend-candidate'?'candidate':'main',point=history.roleEvidence[role],material=reader.json({file:point.materialReceiptFile,sha256:point.materialReceiptSha256});const installed=receipt.reobservedInstalled[service];assert.ok(Number.isSafeInteger(installed.originalPid)&&installed.originalPid>0);assert.equal(installed.code,0);assert.equal(installed.signal,null);validateInstalledNativeRole(installed.result,nativeMaterialIdentity(material));
  for(const [row,expected]of [[receipt.negativeBaselineAuthorityVerified[service],{format:'sabalan-authority-cohort-directory/v1',mode:'verify',nonce:descriptor.authorityCohort.nonce,kind:service==='backend-candidate'?'runtime':'jobs',namespace:descriptor.authorityCohort.namespaces[service],consumerNamespace:descriptor.authorityCohort.namespaces[peer],exclusivelyCreated:false,empty:true,productionAdmission:false}],[receipt.negativeBaselineAcceptanceVerified[service],{format:'sabalan-c16-empty-acceptance-namespace/v1',mode:'verify',nonce:descriptor.acceptance.nonce,namespace:descriptor.acceptance.namespace,empty:true,exclusivelyCreated:false,productionAdmission:false}]]){assert.ok(Number.isSafeInteger(row.originalPid)&&row.originalPid>0);assert.equal(row.code,0);assert.equal(row.signal,null);assert.equal(row.failure,undefined);assert.deepEqual(JSON.parse(row.stdout),row.result);assert.deepEqual(row.result,expected);}
 }
 reader.recheck();return receipt;
}
