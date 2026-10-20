import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../../deploy/scripts/deploy.sh',import.meta.url),'utf8');
test('protected release captures the stopped bank before checkpoint, applies target after journaled mutation, and verifies before reopening',()=>{
 const steps=['phase SERVICES_DRAINED\ncapture_clamav_checkpoint','run_backend_timed_with_heartbeat "${checkpoint_timeout}" node dist/scripts/deployment-checkpoint.js','phase REMOTE_CHECKPOINT_VERIFIED','phase MUTATION_STARTED','node scripts/clamav-checkpoint.mjs activate','phase RELEASE_STARTED','verify_clamav_repair_runtime\nremaining_mutation_seconds','phase TRAFFIC_OPENED'];
 let previous=-1;
 for(const step of steps) {const index=source.indexOf(step);assert.ok(index>previous,`missing or out of order: ${step}`);previous=index;}
 assert.doesNotMatch(source,/compose up -d postgres clamav/,'pre-checkpoint must not replace AV');
 assert.match(source,/if \[ "\$\{DEPLOYMENT_CLAMAV_REPAIR\}" = true \] && \[ "\$\{MUTATION_STARTED\}" -eq 0 \]; then[\s\S]*compose start clamav[\s\S]*--no-deps/);
 assert.match(source,/deployment-rollback.js[\s\S]*switch_to_previous_images\n    restore_clamav_configuration[\s\S]*verify_clamav_repair_runtime[\s\S]*DEPLOYMENT_GATE_MODE=ROLLBACK/);
 assert.match(source,/PUBLIC_TRAFFIC_OPEN.*[\s\S]*rollback is forbidden because new writes may exist/);
 assert.match(source,/DEPLOYMENT_MODE.*release.*[\s\S]*ClamAV repair requires the complete protected release path/);
});

// Execute the real controller against fail-closed CLI adapters. All files, leases,
// image state and backup transport are private fixtures; no real deployment occurs.
for(const failure of ['qualification','remote-tamper','post-mutation','rollback-qualifier','after-open','success']) test(`complete controller fixture: ${failure}`,{timeout:120000},async()=>{
 const os=await import('node:os'),path=await import('node:path'),crypto=await import('node:crypto');
 const {spawnSync,execFileSync}=await import('node:child_process');const {createRequire}=await import('node:module');
 const repository=new URL('../../',import.meta.url).pathname;
 const require=createRequire(import.meta.url),root=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-clamav-controller-'));
 const fixture=new URL('./controller-fixture.cjs',import.meta.url).pathname;
 const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
 const quote=text=>"'"+text.replaceAll("'","'\\''")+"'";
 let typescript;
 try{typescript=require.resolve('typescript',{paths:[path.join(repository,'backend')]});}catch{typescript=path.resolve(repository,'../typescript.js');}
 assert.ok(fs.existsSync(typescript),'the isolated QA harness must provide TypeScript for the real recovery crypto');
 try {
  for(const dir of ['.git','bin','secrets','remote','reports','coordination','bank','candidate','candidate-bank','scripts','backend/scripts','deploy/nginx'])fs.mkdirSync(path.join(root,dir),{recursive:true});
  fs.writeFileSync(path.join(root,'deploy/nginx/maintenance.html'),'test-only maintenance');
  fs.writeFileSync(path.join(root,'secrets/local-rollback-key'),'fixture-only-'.repeat(4));
  fs.writeFileSync(path.join(root,'secrets/remote-recovery-public.pem'),'-----BEGIN PUBLIC KEY-----');
  fs.copyFileSync(path.join(repository,'scripts/performance-deployment-environment.mjs'),path.join(root,'scripts/performance-deployment-environment.mjs'));
  fs.copyFileSync(path.join(repository,'scripts/clamav-release-readiness.mjs'),path.join(root,'scripts/clamav-release-readiness.mjs'));
  fs.copyFileSync(path.join(repository,'backend/scripts/clamav-checkpoint.mjs'),path.join(root,'backend/scripts/clamav-checkpoint.mjs'));
  const originals={};
  for(const name of ['main','daily','bytecode']){
   fs.writeFileSync(path.join(root,'bank',name+'.cvd'),'original-'+name);
   fs.writeFileSync(path.join(root,'candidate-bank',name+'.cvd'),'target-'+name);
   originals[name+'.cvd']=hash(Buffer.from('original-'+name));
  }
  fs.writeFileSync(path.join(root,'bank/freshclam.dat'),'native-cooldown-fixture');
  execFileSync('tar',['-cpf',path.join(root,'candidate/target-bank.tar'),'-C',path.join(root,'candidate-bank'),'.']);
  const oldImage='sha256:'+'6'.repeat(64),targetImage='sha256:'+'f'.repeat(64),versions={main:63,daily:28157,bytecode:339};
  const proof={image:oldImage,engine:'1.4.5',runtimeVerifier:'native-1.4-daemon-v1',checkedAt:new Date().toISOString(),versions,restoreRehearsalPassed:true,fullReleaseRehearsalPassed:true,updaterHealthy:true,scannerClean:true,eicarRejected:true,configArchiveSha256:hash(Buffer.from('effective-config-fixture')),bankFiles:originals};
  fs.writeFileSync(path.join(root,'proof.json'),JSON.stringify(proof));
  const target={image:targetImage,engine:'1.4.6',checkedAt:new Date().toISOString(),versions,loadedDaily:versions.daily,updaterHealthy:true,signatureVerified:true,loadVerified:true,eicarRejected:true,bankSha256:hash(fs.readFileSync(path.join(root,'candidate/target-bank.tar')))};
  fs.writeFileSync(path.join(root,'candidate/target.json'),JSON.stringify(target));
  fs.writeFileSync(path.join(root,'runtime.json'),JSON.stringify({clamav:oldImage,bankRestored:false}));
  const environment=path.join(root,'.env.prod');
  fs.writeFileSync(environment,`DEPLOYMENT_SECRET_DIR=${root}/secrets\nDEPLOYMENT_REMOTE_MOUNT_HOST=${root}/remote\nDEPLOYMENT_REPORT_DIR_HOST=${root}/reports\nDEPLOYMENT_OWNER=fixture\nDEPLOYMENT_BACKEND_IMAGE_REPOSITORY=fixture/backend\nDEPLOYMENT_FRONTEND_IMAGE_REPOSITORY=fixture/frontend\nDEPLOYMENT_INQUIRY_IMAGE_REPOSITORY=fixture/inquiry\nDOMAIN=fixture.invalid\nINQUIRY_DOMAIN=inquiry.fixture.invalid\n`);
  for(const kind of ['git','docker','node'])fs.writeFileSync(path.join(root,'bin',kind),`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fixture)} ${kind} "$@"\n`,{mode:0o755});
  const shims={flock:'exit 0',curl:'printf 503',df:"printf 'Filesystem 1024-blocks Used Available Capacity Mounted\\nfixture 900000000 1 899999999 1%% /\\n'",sleep:'exec /bin/sleep 0.02',timeout:'shift; exec "$@"'};
  for(const [name,body]of Object.entries(shims))fs.writeFileSync(path.join(root,'bin',name),'#!/bin/sh\n'+body+'\n',{mode:0o755});
  const result=spawnSync('/bin/sh',[path.join(repository,'deploy/scripts/deploy.sh'),environment],{cwd:root,encoding:'utf8',timeout:110000,env:{...process.env,PATH:path.join(root,'bin')+':'+process.env.PATH,TEST_RELEASE_ROOT:root,TEST_SOURCE_ROOT:repository,TEST_RELEASE_FAILURE:failure,TEST_TYPESCRIPT_JS:typescript,DEPLOYMENT_REPO_ROOT:root,DEPLOYMENT_MODE:'release',DEPLOYMENT_CLAMAV_TARGET_IMAGE:targetImage,DEPLOYMENT_CLAMAV_BASE_COMMIT:'a'.repeat(40),DEPLOYMENT_CLAMAV_ROLLBACK_PROOF_FILE:path.join(root,'proof.json'),DEPLOYMENT_CLAMAV_READY_FILE:path.join(root,'candidate/target.json')}});
  const expected={qualification:41,'remote-tamper':43,'post-mutation':44,'rollback-qualifier':44,'after-open':46,success:0}[failure];
  assert.equal(result.status,expected,`${result.stdout}\n${result.stderr}`);
  const commands=fs.readFileSync(path.join(root,'commands.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  const includes=text=>commands.filter(c=>c.args.includes(text));
  const controls=verb=>commands.filter(c=>c.args.includes('dist/scripts/deployment-control.js')&&c.args.at(-1)===verb);
  const activation=commands.findIndex(c=>c.args.includes('scripts/clamav-checkpoint.mjs')&&c.args.at(-1)==='activate');
  const remotePhase=commands.findIndex(c=>c.args.includes('DEPLOYMENT_PHASE=REMOTE_CHECKPOINT_VERIFIED'));
  if(['post-mutation','rollback-qualifier','after-open','success'].includes(failure))assert.ok(activation>remotePhase&&remotePhase>=0,'activation requires both verified checkpoints');
  else assert.equal(activation,-1,'failed qualification or checkpoint must never activate');
  assert.equal(includes('dist/scripts/deployment-rollback.js').length,['post-mutation','rollback-qualifier'].includes(failure)?1:0,'never replay rollback or restore old data after public writes');
  if(failure==='qualification')assert.equal(controls('maintenance-on').length,0);
  else if(failure==='rollback-qualifier'||failure==='after-open'){
   assert.ok(fs.existsSync(path.join(root,'maintenance.json')),'failed rollback verification or post-open failure retains maintenance');
   assert.equal(controls('maintenance-off').length,failure==='after-open'?1:0);
  } else assert.equal(fs.existsSync(path.join(root,'maintenance.json')),false);
  const targetRemains=['success','after-open'].includes(failure);
  for(const name of ['main','daily','bytecode'])assert.equal(fs.readFileSync(path.join(root,'bank',name+'.cvd'),'utf8'),(targetRemains?'target-':'original-')+name);
  if(['post-mutation','rollback-qualifier'].includes(failure)){
   assert.equal(fs.readFileSync(path.join(root,'bank/freshclam.dat'),'utf8'),'native-cooldown-fixture');
   assert.equal(fs.readFileSync(path.join(root,'restored-config.tar'),'utf8'),'effective-config-fixture');
   assert.ok(commands.some(c=>c.kind==='node'&&c.args[1]==='inspect-rollback'&&c.phase==='ROLLBACK_STARTED'));
  }
 } finally {
  const pid=path.join(root,'advisory.pid');if(fs.existsSync(pid)){try{process.kill(Number(fs.readFileSync(pid,'utf8')));}catch(error){if(error.code!=='ESRCH')throw error;}}
  fs.rmSync(root,{recursive:true,force:true});
 }
});
