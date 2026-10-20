// Test-only CLI adapters. Never delegate Docker, Git, curl or readiness traffic to real hosts.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=process.env.TEST_RELEASE_ROOT, repository=process.env.TEST_SOURCE_ROOT;
const [kind,...a]=process.argv.slice(2), log=path.join(root,'commands.jsonl');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const save=(file,value)=>fs.writeFileSync(path.join(root,file),JSON.stringify(value));
const record=value=>fs.appendFileSync(log,JSON.stringify(value)+'\n');
const env=key=>(a.find(value=>value.startsWith(key+'='))||'').slice(key.length+1);
const phase=()=>fs.existsSync(path.join(root,'reports/active-deployment-session.json'))?read('reports/active-deployment-session.json').phase:'';
const failure=process.env.TEST_RELEASE_FAILURE;
const copy=(source,destination)=>fs.cpSync(source,destination,{recursive:true});
const coordination=path.join(root,'coordination'), bank=path.join(root,'bank');
function installTsHook(){
 const ts=require(process.env.TEST_TYPESCRIPT_JS);
 require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
}
const serviceImages={backend:'1',frontend:'2',inquiry:'3',nginx:'4',postgres:'5',clamav:'6'};
const image=service=>'sha256:'+serviceImages[service].repeat(64);
const rollbackEnvironment={PERFORMANCE_RELEASE_COMMIT:'a'.repeat(40),PERFORMANCE_RELEASE_SOURCE_HASH:'b'.repeat(64),PERFORMANCE_RELEASE_BACKEND_IMAGE:image('backend'),PERFORMANCE_RELEASE_FRONTEND_IMAGE:image('frontend'),PERFORMANCE_RELEASE_INQUIRY_IMAGE:image('inquiry'),PERFORMANCE_RELEASE_SCHEMA_HASH:'b'.repeat(64),PERFORMANCE_RELEASE_POLICY_HASH:'b'.repeat(64),PERFORMANCE_RELEASE_INFRASTRUCTURE_HASH:'b'.repeat(64),PERFORMANCE_RUNTIME_INFRASTRUCTURE_HASH:'b'.repeat(64)};
(async()=>{
 record({kind,args:a,phase:phase()});
 if(kind==='git'){
  if(a[0]==='rev-parse')console.log('c'.repeat(40));
  else if(!['diff','fetch','checkout','pull','submodule'].includes(a[0]))throw Error('Unexpected Git operation');
  return;
 }
 if(kind==='node'){
  if(a[0]?.endsWith('/clamav-incident-recovery.mjs')){
   const {validateIncidentSnapshot}=await import(require('node:url').pathToFileURL(path.join(repository,'backend/scripts/clamav-incident-policy.mjs')));
   const evidence=JSON.parse(fs.readFileSync(a[3]));validateIncidentSnapshot(evidence,image('clamav'));
   for(const [file,digest]of Object.entries(evidence.bankFiles))if(hash(fs.readFileSync(path.join(bank,file)))!==digest)throw Error('Original incident bank changed');
   if(read('runtime.json').clamav!==evidence.image)throw Error('Original incident image changed');
   console.log('{}');return;
  }
  if(a[0]?.endsWith('/clamav-release-readiness.mjs')){
   const [script,command,input,expected]=a;
   const policy=await import(require('node:url').pathToFileURL(path.join(repository,'scripts/clamav-release-readiness.mjs')));
   const versions={main:63,daily:28157,bytecode:339};
   if(command==='rollback-proof')policy.validateRollbackProof(JSON.parse(fs.readFileSync(input)),expected,versions);
   else if(command==='scope')policy.validateRepairPaths(['deploy/clamav/inspect-native.sh']);
   else if(command==='verify'){
    const receipt=policy.validateReceipt(JSON.parse(fs.readFileSync(input)),expected,versions);
    if(receipt.bankSha256!==hash(fs.readFileSync(path.join(path.dirname(input),'target-bank.tar'))))throw Error('Target binding mismatch');
   } else if(command==='inspect-rollback'){
    const proof=JSON.parse(fs.readFileSync(expected));policy.validateRollbackProof(proof,proof.image,versions);
    if(failure==='qualification' || (failure==='rollback-qualifier' && phase()==='ROLLBACK_STARTED'))process.exit(41);
    for(const [file,digest] of Object.entries(proof.bankFiles))if(hash(fs.readFileSync(path.join(bank,file)))!==digest)throw Error('Rollback bank mismatch');
    if(read('runtime.json').clamav!==proof.image)throw Error('Wrong rollback image');
   } else if(command==='inspect'){
    const receipt=read('candidate/target.json');policy.validateReceipt(receipt,read('runtime.json').clamav,versions);
   } else throw Error('Unexpected readiness command');
   console.log('{}');return;
  }
  if(a[0]==='--input-type=module' && a.some(value=>value.includes('performanceSourceHash'))){console.log('b'.repeat(64));return;}
  const result=cp.spawnSync(process.execPath,a,{stdio:'inherit',env:process.env});process.exit(result.status??1);
 }
 if(kind!=='docker')throw Error('Only known test adapters are permitted');
 if(a[0]==='info'){console.log(root);return;}
 if(a[0]==='image' && a[1]==='inspect'){
  if(a.includes('{{.Size}}'))console.log('1000000');
  else {const name=a.at(-1); console.log(name.startsWith('sha256:')?name:name.startsWith('fixture/backend:')?'sha256:'+'8'.repeat(64):name.startsWith('fixture/frontend:')?'sha256:'+'9'.repeat(64):name.startsWith('fixture/inquiry:')?'sha256:'+'a'.repeat(64):image('nginx'));}return;
 }
 if(a[0]==='builder')return;
 if(a[0]==='inspect'){
  if(a.includes('--format')){
   const format=a[a.indexOf('--format')+1],service=a.at(-1);
   console.log(format==='{{.Image}}'?image(service):format==='{{.State.Running}}'?'false':'10.0.0.2');
  } else console.log(JSON.stringify([{Id:'backend',Image:image('backend'),Config:{Env:Object.entries(rollbackEnvironment).map(([k,v])=>k+'='+v)},State:{Running:true}}]));
  return;
 }
 if(a[0]==='cp'){
  const [source,destination]=a.slice(1).filter(value=>value!=='-a');
  if(source==='clamav:/etc/clamav/.' && destination==='-'){process.stdout.write('effective-config-fixture');return;}
  if(source.startsWith('backend:/app/recovery-coordination/')){copy(path.join(coordination,source.split('/app/recovery-coordination/')[1]),destination);return;}
  if(destination==='backend:/app/recovery-coordination/'){copy(source,path.join(coordination,path.basename(source)));return;}
  if(source==='-'){
   if(!read('runtime.json').bankRestored)throw Error('Configuration must follow bank restore');
   fs.writeFileSync(path.join(root,'restored-config.tar'),fs.readFileSync(0));return;
  }
  throw Error('Unexpected copy');
 }
 if(a[0]!=='compose')throw Error('Unexpected Docker command');
 if(a.includes('ps')){console.log(a.at(-1));return;}
 if(a.includes('config')){console.log('services: {}');return;}
 if(a.includes('build')||a.includes('create')||a.includes('stop')||a.includes('start'))return;
 if(a.includes('up')){
  if(a.includes('clamav')){const state=read('runtime.json');state.clamav=process.env.DEPLOYMENT_CLAMAV_IMAGE;save('runtime.json',state);}return;
 }
 if(a.includes('dist/scripts/deployment-control.js')){
  const command=a[a.indexOf('dist/scripts/deployment-control.js')+1],session='reports/active-deployment-session.json';
  if(command==='prepare')save(session,{deploymentId:env('DEPLOYMENT_ID'),leaseToken:'fixture-lease',phase:'PREFLIGHT',rollbackPerformanceEnvironment:rollbackEnvironment,clamavOperation:env('DEPLOYMENT_CLAMAV_OPERATION'),clamavIncidentSnapshotSha256:env('DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_SHA256')});
  else if(command==='maintenance-on'){
   save('maintenance.json',{deploymentId:env('DEPLOYMENT_ID')});
   if(failure==='marker-interrupted')process.exit(25);
  }
  else if(command==='maintenance-off'){
   if(failure==='after-open' && phase()==='TRAFFIC_OPENED')process.exit(46);
   fs.rmSync(path.join(root,'maintenance.json'),{force:true});
  } else if(command==='incident-boundary-state'){
   const s=read(session);console.log(fs.existsSync(path.join(root,'maintenance.json'))||!['PREFLIGHT','LEASE_ACQUIRED','MAINTENANCE_REQUESTED'].includes(s.phase)?'PROTECTED':'PRE_MAINTENANCE');
  } else if(command==='acquire'||command==='transition'||command==='local-transition'){
   if(command==='acquire'&&failure==='acquire-failure')process.exit(23);
   if(command==='transition'&&env('DEPLOYMENT_PHASE')==='MAINTENANCE_REQUESTED'&&failure==='after-acquire')process.exit(24);
   const s=read(session);s.phase=command==='acquire'?'LEASE_ACQUIRED':env('DEPLOYMENT_PHASE');save(session,s);
   save('active.json',{id:s.deploymentId,leaseToken:s.leaseToken,phase:s.phase,leaseExpiresAt:new Date(Date.now()+1200000).toISOString()});
  } else if(command==='finish'||command==='cancel-preflight'){
   save('finished.json',{result:env('DEPLOYMENT_RESULT'),phase:env('DEPLOYMENT_PHASE')});fs.rmSync(path.join(root,session),{force:true});
  } else if(command!=='heartbeat')throw Error('Unexpected control command');
  return;
 }
 if(a.includes('dist/scripts/deployment-performance-identity.js')){
  save('reports/performance-database-'+env('DEPLOYMENT_ID')+'.json',{schemaHash:'b'.repeat(64),policyHash:'b'.repeat(64)});return;
 }
 const id=env('DEPLOYMENT_ID'),unit=path.join(coordination,'clamav-checkpoint-'+id);
 if(a.includes('scripts/clamav-checkpoint.mjs')){
  const {requireBoundary,captureUnit,restoreUnit,verifyUnit}=await import(require('node:url').pathToFileURL(path.join(repository,'backend/scripts/clamav-checkpoint.mjs')));
  const command=a[a.indexOf('scripts/clamav-checkpoint.mjs')+1];
  requireBoundary({session:read('reports/active-deployment-session.json'),active:read('active.json'),maintenance:read('maintenance.json'),id,token:env('DEPLOYMENT_LEASE_TOKEN'),phase:command==='capture'?'SERVICES_DRAINED':'MUTATION_STARTED'});
  if(command==='capture'){
   const incident=env('DEPLOYMENT_CLAMAV_OPERATION')==='incident-recovery';
   if(incident){const {requireIncidentSession}=await import(require('node:url').pathToFileURL(path.join(repository,'backend/scripts/clamav-incident-policy.mjs')));requireIncidentSession(read('reports/active-deployment-session.json'),'incident-recovery',env('DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_SHA256'));}
   if(hash(fs.readFileSync(path.join(unit,incident?'incident-snapshot.json':'rollback-proof.json')))!==env(incident?'DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_SHA256':'DEPLOYMENT_CLAMAV_ROLLBACK_PROOF_SHA256'))throw Error('Original evidence changed');
   await captureUnit({bank,unit,id,image:image('clamav')});
  }
  else {
   const checkpoint=read('checkpoint.json');await verifyUnit({unit,id,checkpoint});
   const receipt=JSON.parse(fs.readFileSync(path.join(unit,'target.json')));
   if(receipt.image!==env('DEPLOYMENT_CLAMAV_TARGET_IMAGE')||receipt.bankSha256!==hash(fs.readFileSync(path.join(unit,'target-bank.tar'))))throw Error('Activation binding mismatch');
   await restoreUnit({bank,unit,id,checkpoint,archive:'target-bank.tar',beforeMutation:async()=>{
    if(failure==='install-interrupted')throw Error('Injected interrupted installation');
    const active=read('active.json');if(failure==='lease-expired')active.leaseExpiresAt=new Date(0).toISOString();
    requireBoundary({session:read('reports/active-deployment-session.json'),active,maintenance:read('maintenance.json'),id,token:env('DEPLOYMENT_LEASE_TOKEN'),phase:'MUTATION_STARTED'});
   }});
  }
  return;
 }
 if(a.includes('dist/scripts/deployment-checkpoint.js')){
  installTsHook();const {encryptRecoveryArchive,decryptRecoveryArchive}=require(path.join(repository,'backend/src/services/recoveryCrypto.ts'));
  const payload=path.join(root,'payload');fs.mkdirSync(path.join(payload,'recovery-coordination'),{recursive:true});
  copy(unit,path.join(payload,'recovery-coordination',path.basename(unit)));
  const components=fs.readdirSync(unit).map(file=>{const bytes=fs.readFileSync(path.join(unit,file));return {path:'recovery-coordination/'+path.basename(unit)+'/'+file,size:bytes.length,sha256:hash(bytes)};});
  cp.execFileSync('tar',['-czf',path.join(root,'payload.tar.gz'),'-C',payload,'.']);
  const key=crypto.randomBytes(32).toString('hex');fs.writeFileSync(path.join(root,'fixture-key'),key,{mode:0o600});
  await encryptRecoveryArchive(path.join(root,'payload.tar.gz'),path.join(root,'checkpoint.sabrec'),key);
  copy(path.join(root,'checkpoint.sabrec'),path.join(root,'remote/checkpoint.sabrec'));
  if(failure==='remote-tamper')fs.appendFileSync(path.join(root,'remote/checkpoint.sabrec'),'tamper');
  if(hash(fs.readFileSync(path.join(root,'checkpoint.sabrec')))!==hash(fs.readFileSync(path.join(root,'remote/checkpoint.sabrec'))))process.exit(43);
  await decryptRecoveryArchive(path.join(root,'remote/checkpoint.sabrec'),path.join(root,'verified-payload.tar.gz'),key);
  const checkpoint={deploymentId:id,localVerified:true,remoteVerified:true,manifest:{components},rollbackReleaseSet:{clamav:image('clamav')}};
  const {verifyUnit}=await import(require('node:url').pathToFileURL(path.join(repository,'backend/scripts/clamav-checkpoint.mjs')));
  await verifyUnit({unit,id,checkpoint});save('checkpoint.json',checkpoint);return;
 }
 if(a.includes('db:migrate:deploy')){if(['post-mutation','rollback-qualifier'].includes(failure))process.exit(44);return;}
 if(a.includes('dist/scripts/deployment-rollback.js')){
  installTsHook();const {decryptRecoveryArchive}=require(path.join(repository,'backend/src/services/recoveryCrypto.ts'));
  const {requireBoundary,recoverUnit,restoreUnit}=await import(require('node:url').pathToFileURL(path.join(repository,'backend/scripts/clamav-checkpoint.mjs')));
  requireBoundary({session:read('reports/active-deployment-session.json'),active:read('active.json'),maintenance:read('maintenance.json'),id,token:env('DEPLOYMENT_LEASE_TOKEN'),phase:'ROLLBACK_STARTED'});
  // Exercise loss of the extra copy, actual authenticated reconstruction and bank restore.
  fs.rmSync(unit,{recursive:true});
  await recoverUnit({unit,id,checkpoint:read('checkpoint.json'),readArchive:destination=>decryptRecoveryArchive(path.join(root,'checkpoint.sabrec'),destination,fs.readFileSync(path.join(root,'fixture-key'),'utf8'))});
  await restoreUnit({bank,unit,id,checkpoint:read('checkpoint.json')});
  const state=read('runtime.json');state.bankRestored=true;save('runtime.json',state);return;
 }
 if(a.includes('exec')){
  const text=a.at(-1);
  if(text.includes('pg_sleep(21600)')){fs.writeFileSync(path.join(root,'advisory.pid'),String(process.pid));setInterval(()=>{},1000);return;}
  if(text.includes('pg_locks'))console.log('1');
  else if(text.includes('pg_stat_activity WHERE client_addr'))console.log('0');
  else if(text.includes('round(100.0'))console.log('20');
  else if(text.includes('pg_database_size'))console.log('1000000');
  else if(text.includes('df -Pk'))console.log('6000000');
  else if(!text.includes('pg_terminate_backend')&&!text.includes('HR_HIRING_ANTIVIRUS_COMMAND'))throw Error('Unexpected exec');
  return;
 }
 const allowed=['validate-production-environment','deployment-drill-preflight','deployment-notify','deployment-gates','deployment-finalize-recovery','dry-run-contract-product-graph-migration','audit-hr-onboarding-task-retirement','migrate-all-contract-product-graphs','reconcile-contract-financial-evidence'];
 if(a.includes('dist/scripts/deployment-notify.js')&&a.includes('retry-blocker')&&failure==='before-maintenance')process.exit(22);
 if(allowed.some(script=>a.includes('dist/scripts/'+script+'.js')))return;
 throw Error('Unexpected fixture CLI operation: '+JSON.stringify(a));
})().catch(error=>{console.error(error.message);process.exitCode=90;});
