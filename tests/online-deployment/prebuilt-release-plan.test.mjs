import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {validatePrebuiltReleasePlan,prebuiltReleaseExports} from '../../deploy/scripts/prebuilt-release-plan.mjs';

const hash=character=>character.repeat(64),image=character=>'sha256:'+hash(character);
function fixture(){
 const operations={receiptSha256:hash('a'),files:Object.fromEntries(['deploy/scripts/deploy.sh','deploy/scripts/online-release-launcher.py','deploy/scripts/prebuilt-release-plan.mjs','deploy/scripts/storage-preflight.sh','deploy/scripts/storage-preflight.mjs','scripts/deployment-storage.mjs','scripts/deployment-capacity.mjs'].map(name=>[name,hash('b')]))};
 const plan={format:'sabalan-prebuilt-protected-release-plan/v1',applicationCommit:'a'.repeat(40),applicationTree:'b'.repeat(40),applicationSourceHash:hash('c'),inquirySourceCommit:'d'.repeat(40),images:{},operations};
 const actual={head:plan.applicationCommit,tree:plan.applicationTree,status:'',inquiryGitlink:plan.inquirySourceCommit,inquiryHead:plan.inquirySourceCommit,inquiryStatus:'',operations:structuredClone(operations),images:{},buildReceipts:{},archiveReceipts:{},linuxCheckoutByteHash:hash('f')};
 for(const [index,role]of ['backend','frontend','inquiry'].entries()){
  const sourceCommit=role==='backend'?plan.applicationCommit:role==='frontend'?'e'.repeat(40):plan.inquirySourceCommit,graph={index:image(String(index+1)),platform:image('4'),config:image(String(index+5)),rootfsDiffIds:[image('8')],archiveSha256:hash('9'),archiveBytes:10240};
  const selected={image:graph.config,sourceCommit,archiveGraph:graph,buildReceipt:{file:'/root/private/'+role+'-build.json',sha256:hash('a')},archiveReceipt:{file:'/root/private/'+role+'-graph.json',sha256:hash('b')}};plan.images[role]=selected;
  actual.images[role]={Id:graph.config,Os:'linux',Architecture:'amd64',RootFS:{Layers:graph.rootfsDiffIds},Config:{Labels:{'io.sabalan.performance.source-commit':sourceCommit,'io.sabalan.performance.source-hash':plan.applicationSourceHash}}};actual.archiveReceipts[role]=structuredClone(graph);
  if(role==='backend')actual.buildReceipts[role]={format:'sabalan-current-backend-image/v1',pass:true,sourceUnchanged:true,sourceCommit,image:{id:graph.index,labels:actual.images[role].Config.Labels},performanceSourceHash:plan.applicationSourceHash};
  if(role==='frontend'){selected.browser={id:'erp_online_committed_actual123',nativeBuildId:'erp_online_committed_actual123',manifestSha256:hash('c')};actual.buildReceipts[role]={format:'sabalan-current-frontend-image-build/v2',pass:true,phase:'COMPLETE',sourceCommit,outputImage:{id:graph.index},buildId:selected.browser.id,manifestSha256:selected.browser.manifestSha256};}
  if(role==='inquiry'){selected.browser={id:'inquiry_online_actual12345',nativeBuildId:'build-actual-native-next',manifestSha256:hash('d')};actual.buildReceipts[role]={format:'sabalan-inquiry-native-image-diagnostic/v1',image:graph.index,inquirySourceCommit:sourceCommit,browserDeploymentId:selected.browser.id};}
 }return{plan,actual};
}
test('content selection keeps CONFIG/index, component commits and Git/build-byte namespaces separate without admission',()=>{
 const {plan,actual}=fixture(),result=validatePrebuiltReleasePlan(plan,actual);assert.equal(result.releaseAdmission,false);assert.equal(result.images.backend,plan.images.backend.archiveGraph.config);assert.notEqual(result.images.backend,plan.images.backend.archiveGraph.index);assert.notEqual(actual.linuxCheckoutByteHash,plan.applicationSourceHash);
 assert.notEqual(plan.images.frontend.sourceCommit,plan.applicationCommit);assert.notEqual(plan.images.inquiry.browser.id,plan.images.inquiry.browser.nativeBuildId);
 const exports=prebuiltReleaseExports(result);assert.match(exports,/DEPLOYMENT_BROWSER_BUILD_ID='erp_online_committed_actual123'/);assert.match(exports,/DEPLOYMENT_PREBUILT_FRONTEND_CONFIG='sha256:6{64}'/);assert.doesNotMatch(exports,/force|sign|admission/i);
});
test('changed source, dirty gitlink, images, graph, build bytes, operations and browser identity refuse',()=>{
 for(const mutate of [
  ({actual})=>{actual.head='f'.repeat(40);},({actual})=>{actual.tree='f'.repeat(40);},({actual})=>{actual.status='?? file';},({actual})=>{actual.inquiryStatus=' M changed';},({actual})=>{actual.inquiryHead='f'.repeat(40);},
  ({plan})=>{plan.force=true;},({plan})=>{plan.images.backend.image=plan.images.backend.archiveGraph.index;},({actual})=>{actual.images.frontend.Id=image('f');},({actual})=>{actual.images.inquiry.RootFS.Layers=[image('f')];},
  ({actual})=>{actual.buildReceipts.backend.performanceSourceHash=hash('f');},({actual})=>{actual.images.backend.Config.Labels['io.sabalan.performance.source-hash']=hash('f');},({actual})=>{actual.archiveReceipts.frontend.platform=image('f');},
  ({actual})=>{actual.operations.files['deploy/scripts/deploy.sh']=hash('f');},({plan})=>{plan.images.frontend.browser.id='erp_rebuilt_other123';},({plan})=>{plan.images.inquiry.browser.id='inquiry_rebuilt_other123';},
  ({plan,actual})=>{delete plan.operations.files['deploy/scripts/storage-preflight.sh'];delete actual.operations.files['deploy/scripts/storage-preflight.sh'];},
 ]){const input=fixture();mutate(input);assert.throws(()=>validatePrebuiltReleasePlan(input.plan,input.actual));}
});

const script=fs.readFileSync(new URL('../../deploy/scripts/deploy.sh',import.meta.url),'utf8').replaceAll('\r\n','\n'),bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/sh';
test('prebuilt real shell lane retains cleanup/capacity and never fetches, builds, retags or derives a browser ID',()=>{
 const start=script.indexOf('if [ "${DEPLOYMENT_MODE}" = "release" ] && [ "${CAPTURE_ONLY}" -eq 0 ]; then\nif [ "${PREBUILT_RELEASE}" -eq 0 ]; then'),end=script.indexOf('elif [ "${CAPTURE_ONLY}" -eq 1 ]; then',start);assert.ok(start>0&&end>start);const block=script.slice(start,end)+'fi\n';
 for(const [capacity,verifyExit,status,events]of [[2097152,0,0,['CLEANUP','MEASURE','VERIFY','CONFIG','READY']],[10,0,1,['CLEANUP','MEASURE']],[2097152,7,1,['CLEANUP','MEASURE','VERIFY']]]){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'prebuilt-release-'));try{
   const result=spawnSync(bash,['-c',`set -eu
DEPLOYMENT_MODE=release; CAPTURE_ONLY=0; PREBUILT_RELEASE=1; OPERATIONS_ROOT=/operations; ENV_FILE=/private/env; REPO_ROOT=/repository
DEPLOYMENT_PREVIOUS_BACKEND_IMAGE=oldbackend; DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE=oldfrontend; DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE=oldinquiry
DEPLOYMENT_PREVIOUS_NGINX_IMAGE=oldnginx; DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE=oldpostgres; DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE=oldclamav
DEPLOYMENT_BROWSER_BUILD_ID=erp_original_actual123
: > events
sh(){ echo CLEANUP >> events; }
df(){ echo MEASURE >> events; printf 'Filesystem Blocks Used Available Capacity Mounted\\nmock 0 0 ${capacity} 0 /\\n'; }
docker(){ case "$*" in 'image inspect --format {{.Size}} '*) echo 1;; 'info --format {{.DockerRootDir}}') echo /mock;; *) exit 99;; esac; }
compose(){ [ "$*" = 'config --quiet' ] || exit 98; echo CONFIG >> events; }
verify_prebuilt_release(){ echo VERIFY >> events; [ ${verifyExit} -eq 0 ] || return ${verifyExit}; printf "export DEPLOYMENT_TARGET_COMMIT='actual'\\n"; }
${block}
[ "$DEPLOYMENT_BROWSER_BUILD_ID" = erp_original_actual123 ]
echo READY >> events
`],{cwd:directory,encoding:'utf8'});assert.ifError(result.error);assert.equal(result.status,status,result.stderr);assert.deepEqual(fs.readFileSync(path.join(directory,'events'),'utf8').trim().split('\n'),events);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
 }
});
test('real mutation boundary revalidates before MUTATION_STARTED and protected targets reach owned cleanup',()=>{
 const index=script.indexOf('\nphase MUTATION_STARTED\n'),start=script.lastIndexOf('if [ "${PREBUILT_RELEASE}" -eq 1 ]; then',index),block=script.slice(start,index)+'\nphase MUTATION_STARTED\n';assert.ok(start>script.indexOf('phase REMOTE_CHECKPOINT_VERIFIED'));
 const result=spawnSync(bash,['-c',`set -eu; PREBUILT_RELEASE=1; verify_prebuilt_release(){ return 17; }; phase(){ echo MUTATION; }; ${block}`],{encoding:'utf8'});assert.equal(result.status,1);assert.doesNotMatch(result.stdout,/MUTATION/);
 const storage=fs.readFileSync(new URL('../../deploy/scripts/storage-preflight.sh',import.meta.url),'utf8').replaceAll('\r\n','\n'),from=storage.indexOf('set --\nif [ -n "${DEPLOYMENT_PREBUILT_BACKEND_CONFIG:'),to=storage.indexOf('# Both hosts must finish',from);assert.ok(from>0&&to>from);
 const selected=['a','b','c'].map(image),env={...process.env,DEPLOYMENT_PREBUILT_BACKEND_CONFIG:selected[0],DEPLOYMENT_PREBUILT_FRONTEND_CONFIG:selected[1],DEPLOYMENT_PREBUILT_INQUIRY_CONFIG:selected[2]};
 const protectedResult=spawnSync(bash,['-c',`set -eu\n${storage.slice(from,to)}\nprintf '%s\\n' "$@"`],{encoding:'utf8',env});assert.equal(protectedResult.status,0,protectedResult.stderr);assert.deepEqual(protectedResult.stdout.trim().split('\n'),selected.flatMap(value=>['--protected-image',value]));
 const invalid=spawnSync(bash,['-c',`set -eu\n${storage.slice(from,to)}\necho READY`],{encoding:'utf8',env:{...env,DEPLOYMENT_PREBUILT_INQUIRY_CONFIG:'mutable:tag'}});assert.equal(invalid.status,1);assert.doesNotMatch(invalid.stdout,/READY/);
});
