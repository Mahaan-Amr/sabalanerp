import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMaintenanceSelection} from '../../deploy/scripts/maintenance-image-selection.mjs';
const h=c=>c.repeat(64),id=c=>'sha256:'+h(c);
export function fixture(){
 const plan={format:'sabalan-maintenance-image-selection/v1',uploadPolicy:'no-malware-scan',applicationCommit:'a'.repeat(40),applicationTree:'b'.repeat(40),applicationSourceHash:h('c'),inquirySourceCommit:'d'.repeat(40),imageStore:'classic',target:{composeFile:'docker-compose.prod.yml',qaPlanSha256:null},operations:{commit:'a'.repeat(40),tree:'b'.repeat(40),files:{'deploy/scripts/deploy.sh':h('e')}},images:{}};
 const actual={uploadPolicy:'no-malware-scan',scannerRetained:false,operationsScannerRetained:false,head:plan.applicationCommit,tree:plan.applicationTree,status:'',inquiryHead:plan.inquirySourceCommit,inquiryGitlink:plan.inquirySourceCommit,inquiryStatus:'',operations:structuredClone(plan.operations),target:structuredClone(plan.target),imageStore:'classic',images:{},archiveReceipts:{},browsers:{}};
 for(const [n,role]of ['backend','frontend','inquiry'].entries()){
  const graph={index:id(String(n+1)),platform:id('4'),config:id(String(n+5)),rootfsDiffIds:[id('8')],archiveSha256:h('9'),archiveBytes:10240};
  const browser=role==='backend'?null:{id:role==='frontend'?'erp_actual_build123':'inquiry_actual_build123',nativeBuildId:role==='frontend'?'erp_actual_build123':'native-next-build',manifestSha256:h('f')};
  plan.images[role]={image:graph.config,archiveFile:'/private/'+role+'.tar',archiveGraph:graph,browser};
  actual.images[role]={Id:graph.config,Os:'linux',Architecture:'amd64',RootFS:{Layers:graph.rootfsDiffIds},Config:{Labels:{'io.sabalan.performance.source-commit':plan.applicationCommit,'io.sabalan.performance.source-hash':plan.applicationSourceHash,...(role==='backend'?{'io.sabalan.release.upload-policy':'no-malware-scan'}:{})}}};
  actual.archiveReceipts[role]=structuredClone(graph);actual.browsers[role]=structuredClone(browser);
 }
 return {plan,actual};
}
test('ordinary maintenance selects exact installed content with distinct session authority and mandatory explicit QA identity',()=>{
 const {plan,actual}=fixture();const selected=validateMaintenanceSelection(plan,actual);assert.equal(selected.releaseAdmission,false);assert.equal(selected.frontendBuildId,'erp_actual_build123');
 plan.target={composeFile:'docker-compose.rehearsal.yml',qaPlanSha256:h('e')};actual.target=structuredClone(plan.target);assert.equal(validateMaintenanceSelection(plan,actual).releaseAdmission,false);
 actual.target.qaPlanSha256=h('f');assert.throws(()=>validateMaintenanceSelection(plan,actual));
});
test('changed sources, receipts, scanner policy, mutable images, browser bytes and mode extensions refuse',()=>{
 for(const mutate of [
  ({plan})=>{plan.force=true;},({actual})=>{actual.head='f'.repeat(40);},({actual})=>{actual.status=' M changed';},({actual})=>{actual.inquiryHead='f'.repeat(40);},
  ({actual})=>{actual.operations.files['deploy/scripts/deploy.sh']=h('f');},({actual})=>{actual.images.backend.Config.Labels['io.sabalan.performance.source-hash']=h('f');},
  ({actual})=>{actual.images.backend.Config.Labels['io.sabalan.release.upload-policy']='scan-required';},({plan})=>{plan.images.backend.image='backend:latest';},
  ({actual})=>{actual.archiveReceipts.backend.archiveSha256=h('f');},({actual})=>{actual.archiveReceipts.inquiry.rootfsDiffIds=[id('f')];},
  ({actual})=>{actual.browsers.inquiry.nativeBuildId='another-native-id';},({actual})=>{actual.browsers.frontend.manifestSha256=h('a');},
  ({plan})=>{plan.target={composeFile:'docker-compose.rehearsal.yml',qaPlanSha256:null};},
 ]){const input=fixture();mutate(input);assert.throws(()=>validateMaintenanceSelection(input.plan,input.actual));}
});
test('containerd INDEX execution binds its native descriptor while classic selection uses CONFIG',()=>{
 const {plan,actual}=fixture();plan.imageStore=actual.imageStore='containerd';
 for(const role of ['backend','frontend','inquiry']){const graph=plan.images[role].archiveGraph;plan.images[role].image=actual.images[role].Id=graph.index;actual.images[role].Descriptor={digest:graph.index,mediaType:'application/vnd.oci.image.index.v1+json',size:856};}
 assert.equal(validateMaintenanceSelection(plan,actual).images.backend,plan.images.backend.archiveGraph.index);
 actual.images.backend.Descriptor.digest=id('f');assert.throws(()=>validateMaintenanceSelection(plan,actual));
});
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
const shell=process.env.SABALAN_TEST_SHELL??(process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/sh');
const script=fs.readFileSync(new URL('../../deploy/scripts/deploy.sh',import.meta.url),'utf8').replaceAll('\r\n','\n');
test('actual runner entry reaches maintenance selection with QA and custody while old online mode and mixed modes refuse',()=>{
 const prefix="set -eu; SCRIPT_DIR=/operations/deploy/scripts; OPERATIONS_ROOT=/operations; REPO_ROOT=/repository\n"+script.slice(script.indexOf('SYSTEM_RECOVERY_BACKUP_HOST='),script.indexOf('\ncd "${REPO_ROOT}"'));
 const run=(args,env={})=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'maintenance-entry-'));try{const file=path.join(dir,'entry.sh');fs.writeFileSync(file,prefix+'\nprintf "REACHED:%s:%s\\n" "$MAINTENANCE_IMAGE_SELECTION" "$PREBUILT_RELEASE"');return spawnSync(shell,[file,...args],{encoding:'utf8',env:{...process.env,...env}});}finally{fs.rmSync(dir,{recursive:true,force:true});}};
 const args=['--maintenance-images','/private/env','/private/plan',h('a')];
 for(const env of [{},{DEPLOYMENT_QA_REHEARSAL_PLAN_FILE:'/qa/plan',DEPLOYMENT_QA_REHEARSAL_PLAN_SHA256:h('e')},{DEPLOYMENT_CUSTOMER_ALLOCATION_EVIDENCE_DIR:'/private/evidence',DEPLOYMENT_CUSTOMER_ALLOCATION_AUTHORITY_DIR:'/private/authority',DEPLOYMENT_CUSTOMER_ALLOCATION_APPROVER_SHA256:h('f')}]){const result=run(args,env);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/REACHED:1:1/);}
 for(const env of [{DEPLOYMENT_MODE:'configuration'},{DEPLOYMENT_ONLINE_BOOTSTRAP_REQUEST_FD:'4',DEPLOYMENT_ONLINE_BOOTSTRAP_RESPONSE_FD:'5'},{DEPLOYMENT_CLAMAV_TARGET_IMAGE:id('a')},{DEPLOYMENT_CUSTOMER_ALLOCATION_EVIDENCE_DIR:'/private/evidence'}]){const result=run(args,env);assert.notEqual(result.status,0);assert.doesNotMatch(result.stdout,/REACHED/);}
 assert.match(run(['/private/env']).stdout,/REACHED:0:0/);
 assert.notEqual(run(['--prebuilt-release','/private/env','/private/plan',h('a')]).status,0);
});
test('QA selector precedes content selection and full maintenance, signed activation and reopening keep their order',()=>{
 const ordered=['COMPOSE_FILE="$(node "${OPERATIONS_ROOT}/deploy/scripts/qa-rehearsal-target.mjs"','exec 9>"${LOCK_FILE}"','maintenance-image-selection.mjs" resume','  prebuilt_exports="$(verify_prebuilt_release)"','verify_prebuilt_release bind','control prepare','control acquire','phase MAINTENANCE_REQUESTED','phase TRAFFIC_BLOCKED','phase SERVICES_DRAINED','phase LOCAL_CHECKPOINT_VERIFIED','phase REMOTE_CHECKPOINT_VERIFIED','phase MUTATION_STARTED','phase MIGRATIONS_APPLIED','run_customer_allocation_controller activate','phase RELEASE_STARTED','phase GATES_PASSED','phase TRAFFIC_OPENED'];
 let cursor=0;for(const token of ordered){const next=script.indexOf(token,cursor);assert.ok(next>=cursor,token);cursor=next+token.length;}
 const verify=script.slice(script.indexOf('verify_prebuilt_release() {'),script.indexOf('customer_allocation_retention_path() {'));
 assert.match(verify,/maintenance-image-selection.mjs/);assert.match(verify,/"\$\{COMPOSE_FILE\}"/);
 const signed=script.slice(script.indexOf('  echo "Waiting for an independent customer allocation decision'),script.indexOf('phase RELEASE_STARTED'));
 assert.match(signed,/wait_for_cutover_approval/);assert.match(signed,/verify_public_maintenance/);assert.match(signed,/assert_original_legacy_still_stopped/);assert.match(signed,/retain/);
});
test('the same content selector supports a scanner-retaining predecessor only with its exact source graph',()=>{
 const {plan,actual}=fixture();plan.uploadPolicy=actual.uploadPolicy='legacy-scanner';delete actual.images.backend.Config.Labels['io.sabalan.release.upload-policy'];
 assert.throws(()=>validateMaintenanceSelection(plan,actual),/MAINTENANCE_SOURCE_SCANNER_GRAPH_CHANGED/);
 actual.scannerRetained=actual.operationsScannerRetained=true;assert.equal(validateMaintenanceSelection(plan,actual).releaseAdmission,false);
 actual.images.backend.Config.Labels['io.sabalan.release.upload-policy']='no-malware-scan';assert.throws(()=>validateMaintenanceSelection(plan,actual),/MAINTENANCE_UPLOAD_POLICY_CHANGED/);
});
test('candidate and retained QA graphs use the same shared decision without requiring allocation activation',()=>{
 const selector=new URL('../../deploy/scripts/release-compose-file.sh',import.meta.url);
 for(const [compose,legacy,policy,expected]of [['docker-compose.rehearsal.yml','0','no-malware-scan','docker-compose.rehearsal-scanner-free.yml'],['docker-compose.rehearsal.yml','1','no-malware-scan','docker-compose.rehearsal.yml'],['docker-compose.rehearsal.yml','1','legacy-scanner','docker-compose.rehearsal.yml'],['docker-compose.prod.yml','0','no-malware-scan','docker-compose.prod.yml']]){
  const result=spawnSync(shell,[selector.pathname.replace(/^\/([A-Za-z]:)/,'$1'),compose,legacy,policy],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),expected);
 }
 assert.match(script,/release-compose-file.sh/);
});
test('scanner-retaining source cannot select incompatible scanner-free operations before runtime changes',()=>{
 const {plan,actual}=fixture();plan.uploadPolicy=actual.uploadPolicy='legacy-scanner';actual.scannerRetained=true;actual.operationsScannerRetained=false;delete actual.images.backend.Config.Labels['io.sabalan.release.upload-policy'];
 assert.throws(()=>validateMaintenanceSelection(plan,actual),/MAINTENANCE_OPERATIONS_SCANNER_GRAPH_INCOMPATIBLE/);
});
test('ordinary QA retains the observed legacy scanner for rollback while executing the selected scanner-free target',()=>{
 const from=script.indexOf('case "${previous_upload_policy}" in'),to=script.indexOf('export DEPLOYMENT_PREVIOUS_BACKEND_IMAGE',from);const block=script.slice(from,to);assert.ok(from>0&&to>from);
 for(const [policy,expected]of [['no-malware-scan','0'],['legacy-scanner','1']]){
  const code=`set -eu\nprevious_upload_policy=''; LEGACY_RELEASE_GRAPH=0; DEPLOYMENT_CLAMAV_REPAIR=false; DEPLOYMENT_MODE=release; CAPTURE_ONLY=0; COMPOSE_FILE=docker-compose.rehearsal.yml; ALLOCATION_EVIDENCE_DIR=''; DEPLOYMENT_MAINTENANCE_UPLOAD_POLICY=${policy}\nimage_of_service(){ printf retained-scanner-image; }; compose(){ printf retained-scanner-container; }; docker(){ printf healthy; }\n${block}\nprintf '%s:%s' "$LEGACY_RELEASE_GRAPH" "$DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE"\n`;
  const result=spawnSync(shell,['-c',code],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,expected+':retained-scanner-image');
 }
});
