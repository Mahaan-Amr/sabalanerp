// Test-only CLI adapters. Never delegate Docker, Git, curl or readiness traffic to real hosts.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=process.env.TEST_RELEASE_ROOT, repository=process.env.TEST_SOURCE_ROOT;
const [kind,...a]=process.argv.slice(2), log=path.join(root,'commands.jsonl');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const save=(file,value)=>fs.writeFileSync(path.join(root,file),JSON.stringify(value));
const record=value=>fs.appendFileSync(log,JSON.stringify(value)+'\n');
const env=key=>{
 const exported=a.find((value,index)=>a[index-1]==='-e' && (value===key || value.startsWith(key+'=')));
 return exported===key ? process.env[key] || '' : (exported || '').slice(key.length+1);
};
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
const backendId='1'.repeat(64),postgresId='5'.repeat(64);
const bootstrapEnvironment={POSTGRES_USER:'postgres',POSTGRES_PASSWORD:'fixture',POSTGRES_DB:'sabalanerp'};
const runtimeEnvironment={DATABASE_URL:'postgresql://runtime:fixture@postgres:5432/sabalanerp?schema=public'};
const controlEnvironment={DATABASE_URL:'postgresql://postgres:fixture@postgres:5432/sabalanerp?schema=public'};
function container(role,id,environment){
 return {Id:id,Image:image(role),Config:{
  Labels:{'com.docker.compose.project':'sabalanerp','com.docker.compose.service':role},
  Env:Object.entries(environment).map(([key,value])=>key+'='+value)
 },State:{Running:true},Mounts:[]};
}
const rollbackEnvironment={PERFORMANCE_RELEASE_COMMIT:'a'.repeat(40),PERFORMANCE_RELEASE_SOURCE_HASH:'b'.repeat(64),PERFORMANCE_RELEASE_BACKEND_IMAGE:image('backend'),PERFORMANCE_RELEASE_FRONTEND_IMAGE:image('frontend'),PERFORMANCE_RELEASE_INQUIRY_IMAGE:image('inquiry'),PERFORMANCE_RELEASE_SCHEMA_HASH:'b'.repeat(64),PERFORMANCE_RELEASE_POLICY_HASH:'b'.repeat(64),PERFORMANCE_RELEASE_INFRASTRUCTURE_HASH:'b'.repeat(64),PERFORMANCE_RUNTIME_INFRASTRUCTURE_HASH:'b'.repeat(64)};
(async()=>{
 record({kind,args:a,phase:phase()});
 if(kind==='git'){
  if(a[0]==='rev-parse')console.log('c'.repeat(40));
  else if(!['diff','fetch','checkout','pull','submodule'].includes(a[0]))throw Error('Unexpected Git operation');
  return;
 }
 if(kind==='python3'){
  const [script,mode,compose,environment,previousImage,plan,session]=a;
  if(script?.endsWith('/deploy/scripts/dispatch-volume-transition.py')){
   if(!['stage','attest','transition','verify-mounted'].includes(mode)||compose!==path.join(root,'docker-compose.prod.yml')||environment!==path.join(root,'.env.prod')||previousImage!==backendId||plan!==image('backend')||a.length!==6)throw Error('Dispatch transition fixture identity mismatch');
   console.log(process.env.DEPLOYMENT_CLAMAV_OPERATION==='incident-recovery'?'mounted':'legacy');return;
  }
  if(!script?.endsWith('/deploy/scripts/legacy-backend-signal.py')||!['--preflight','--forward','--assert-resolved','--assert-current-stopped','--assert-unleased-drain-allowed'].includes(mode))throw Error('Unexpected fixture python command');
  if(failure==='legacy-signal'&&mode==='--preflight')process.exit(48);
  if(compose!==path.join(root,'docker-compose.prod.yml')||environment!==path.join(root,'.env.prod')||previousImage!==image('backend')||plan!==path.join(root,'.deploy-state','legacy-backend-drain-'+process.env.DEPLOYMENT_ID+'.json'))throw Error('Legacy signal fixture identity mismatch');
  const marker=path.join(root,'reports/fixture-legacy-preflight.json');
  const forwarded=path.join(root,'reports/fixture-legacy-forward.json');
  if(mode==='--preflight'){if(a.length!==6)throw Error('Legacy preflight arguments');fs.writeFileSync(marker,JSON.stringify({previousImage,plan}),{flag:'wx'});}
  else if(mode==='--forward'){
   if(a.length!==7||session!==path.join(root,'reports/active-deployment-session.json')||!fs.existsSync(marker)||phase()!=='TRAFFIC_BLOCKED'||!fs.existsSync(path.join(root,'maintenance.json')))throw Error('Legacy forward boundary unproven');
   if(JSON.stringify(JSON.parse(fs.readFileSync(marker)))!==JSON.stringify({previousImage,plan}))throw Error('Legacy preflight changed');
   fs.writeFileSync(forwarded,JSON.stringify({previousImage,plan}),{flag:'wx'});
  } else if(mode==='--assert-unleased-drain-allowed'){
   if(a.length!==6||!fs.existsSync(marker)||fs.existsSync(forwarded))throw Error('Unleased drain boundary unproven');
  } else {
   if(a.length!==(mode==='--assert-current-stopped'?7:6)||!fs.existsSync(marker)||!fs.existsSync(forwarded)||JSON.stringify(JSON.parse(fs.readFileSync(marker)))!==JSON.stringify({previousImage,plan})||JSON.stringify(JSON.parse(fs.readFileSync(forwarded)))!==JSON.stringify({previousImage,plan}))throw Error('Legacy resolution without original forward');
   if(mode==='--assert-current-stopped'&&(session!==path.join(root,'reports/active-deployment-session.json')||!['TRAFFIC_BLOCKED','SERVICES_DRAINED','REMOTE_CHECKPOINT_VERIFIED'].includes(phase())))throw Error('Current stopped boundary unproven');
  }
  return;
 }
 if(kind==='node'){
  // Only this exact production binder is adapted: CI is intentionally non-root,
  // while production requires root-owned receipts. Preserve all other checks and
  // verify the test-only receipt identity before returning its digest.
  const binderLine=fs.readFileSync(path.join(repository,'deploy/scripts/deploy.sh'),'utf8').split('\n').find(line=>line.includes('DEPLOYMENT_REMOTE_RETENTION_RECEIPT_SHA256="$(node -e '));
  const binder=binderLine?.match(/node -e '([^']+)'/)?.[1];
  if(a[0]==='-e'&&a[1]===binder){
   if(a.length!==3)throw Error('Unexpected fixture binder arguments');
   const file=a[2],before=fs.lstatSync(file,{bigint:true});
   if(path.dirname(file)!==path.join(root,'reports')||fs.realpathSync(file)!==file||!before.isFile()||before.uid!==BigInt(process.getuid())||before.nlink!==1n||(before.mode&511n)!==256n||before.size>8388608n)throw Error('Invalid fixture receipt custody');
   const raw=fs.readFileSync(file),after=fs.lstatSync(file,{bigint:true});
   for(const key of ['dev','ino','size','mtimeNs','ctimeNs'])if(before[key]!==after[key])throw Error('Fixture receipt changed');
   const value=JSON.parse(raw);
   if(value.format!=='fixture-only-host-retention'||!['BEFORE_CHECKPOINT','AFTER_CHECKPOINT'].includes(value.stage)||path.basename(file)!==`remote-retention-${value.deploymentId}-${value.stage}.json`)throw Error('Invalid fixture receipt identity');
   process.stdout.write(hash(raw));return;
  }
  if(a[0]?.endsWith('/preserved-clamav.mjs')&&a[1]==='resume'){
   const file=path.join(root,'reports/active-deployment-session.json'),stat=fs.lstatSync(file);
   if(a[2]!==file||a.length!==3||!stat.isFile()||stat.uid!==process.getuid()||stat.nlink!==1||(stat.mode&0o077)!==0
     ||read('reports/active-deployment-session.json').preservedClamav)throw Error('Invalid fixture resume session');
   return;
  }
 if(a[0]?.endsWith('/maintenance-image-selection.mjs')&&a[1]==='resume'&&process.getuid()!==0){
   const file=path.join(root,'reports/active-deployment-session.json');
   if(a[2]!==file||a.length!==3||read('reports/active-deployment-session.json').maintenanceImages)throw Error('Invalid fixture maintenance-image resume');
   const {validatePreservationJournal}=await import(require('node:url').pathToFileURL(path.join(repository,'deploy/scripts/preserved-clamav.mjs')));
   const first=validatePreservationJournal(fs.readFileSync(path.join(root,'reports/active-deployment.jsonl'),'utf8').trimEnd().split('\n').map(JSON.parse));
   if(first.deploymentId!==read('reports/active-deployment-session.json').deploymentId||first.details?.maintenanceImages)throw Error('Invalid fixture maintenance-image journal');
   return;
 }
  if(a[0]?.endsWith('/backup-retention-host.mjs')){
   if(a[1]==='--inspect'){if(a.length!==3||a[2]!==path.join(root,'.env.prod'))throw Error('Unexpected backup inspection');console.log(JSON.stringify({inspected:true,sshStarted:false}));return;}
   const [,environment,id,stage,receipt,holds]=a;
   if(a.length!==6||environment!==path.join(root,'.env.prod')||!['BEFORE_CHECKPOINT','AFTER_CHECKPOINT'].includes(stage)||receipt!==path.join(root,'reports',`remote-retention-${id}-${stage}.json`)||holds!==path.join(root,'reports',`retention-holds-${id}-${stage}.json`)||JSON.stringify(JSON.parse(fs.readFileSync(holds)))!=='[]')throw Error('Unexpected backup fixture request');
   fs.writeFileSync(receipt,JSON.stringify({format:'fixture-only-host-retention',deploymentId:id,stage})+'\n',{flag:'wx',mode:0o400});return;
  }
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
   else if(command==='verify'||command==='verify-incident'){
    const receipt=policy.validateReceipt(JSON.parse(fs.readFileSync(input)),expected,versions);
    if(receipt.bankSha256!==hash(fs.readFileSync(path.join(path.dirname(input),'target-bank.tar'))))throw Error('Target binding mismatch');
    if(command==='verify-incident'){
     const snapshot=JSON.parse(fs.readFileSync(a[4]));
     const {validateIncidentSnapshot}=await import(require('node:url').pathToFileURL(path.join(repository,'backend/scripts/clamav-incident-policy.mjs')));
     let observedAt=Date.now();
     if (phase()==='REMOTE_CHECKPOINT_VERIFIED') {
      const unit=read('coordination/clamav-checkpoint-'+read('reports/active-deployment-session.json').deploymentId+'/unit.json');
      observedAt=Date.parse(unit.incidentCapturedAt);
      if (Number(a[6])!==observedAt) throw Error('Controller did not use the authenticated capture time');
     } else if (a[6]!==undefined) throw Error('Preflight must use current time');
     validateIncidentSnapshot(snapshot,snapshot.image,observedAt);
     policy.validateIncidentTarget(receipt,snapshot,Number(a[5]));
     console.log(hash(fs.readFileSync(input)));return;
    }
   } else if(command==='inspect-rollback'){
    const proof=JSON.parse(fs.readFileSync(expected));policy.validateRollbackProof(proof,proof.image,versions);
    if(failure==='qualification' || (failure==='rollback-qualifier' && phase()==='ROLLBACK_STARTED'))process.exit(41);
    for(const [file,digest] of Object.entries(proof.bankFiles))if(hash(fs.readFileSync(path.join(bank,file)))!==digest)throw Error('Rollback bank mismatch');
    if(read('runtime.json').clamav!==proof.image)throw Error('Wrong rollback image');
   } else if(command==='inspect'){
    const bytes=fs.readFileSync(expected||path.join(root,'candidate','target.json'));
    if(expected&&a[4]!==hash(bytes))throw Error('Installed ClamAV incident receipt differs from preflight');
    policy.validateReceipt(JSON.parse(bytes),read('runtime.json').clamav,versions);
   } else throw Error('Unexpected readiness command');
   console.log('{}');return;
  }
  if(a[0]==='--input-type=module' && a.some(value=>value.includes('performanceSourceHash'))){console.log('b'.repeat(64));return;}
  const result=cp.spawnSync(process.execPath,a,{stdio:'inherit',env:process.env});process.exit(result.status??1);
 }
 if(kind!=='docker')throw Error('Only known test adapters are permitted');
 if(a[0]==='info'){console.log(root);return;}
 if(a[0]==='tag'){
  if(a.length!==3||a[1]!==image('postgres')||a[2]!=='sabalanerp-recovery-postgres:'+a[1].slice(7))throw Error('Invalid fixture recovery PostgreSQL tag');
  save('recovery-postgres-tag.json',{target:a[2],image:a[1]});return;
 }
 if(a[0]==='image' && a[1]==='inspect'){
  if(a.some(value=>value.includes('io.sabalan.performance.source-commit')))console.log('c'.repeat(40));
  else if(a.some(value=>value.includes('io.sabalan.performance.source-hash')))console.log('b'.repeat(64));
  else if(a.includes('{{.Size}}'))console.log('1000000');
  else {
   const name=a.at(-1);
   if(name.startsWith('sabalanerp-recovery-postgres:')){
    const tag=read('recovery-postgres-tag.json');
    if(name!==tag.target)throw Error('Fixture recovery PostgreSQL image was not retained');
    console.log(tag.image);
   } else console.log(name.startsWith('sha256:')?name:name.startsWith('fixture/backend:')?'sha256:'+'8'.repeat(64):name.startsWith('fixture/frontend:')?'sha256:'+'9'.repeat(64):name.startsWith('fixture/inquiry:')?'sha256:'+'a'.repeat(64):image('nginx'));
  }
  return;
 }
 if(a[0]==='builder')return;
 if(a[0]==='volume'&&a[1]==='inspect'){console.log(root);return;}
 if(a[0]==='container'&&a[1]==='inspect'){
  if(a.length!==4||a[2]!==backendId||a[3]!==postgresId)throw Error('Database role observation must inspect the running backend and postgres');
  console.log(JSON.stringify([container('backend',backendId,runtimeEnvironment),container('postgres',postgresId,bootstrapEnvironment)]));return;
 }
 if(a[0]==='inspect'){
  if(a.includes('--format')){
   const format=a[a.indexOf('--format')+1],service=a.at(-1),name=service===backendId?'backend':service===postgresId?'postgres':service;
   // Docker's index lookup on a missing string label returns an empty string.
   if(format==='{{index .Config.Labels "io.sabalan.release.upload-policy"}}'){
    if(name!=='backend')throw Error('Upload policy must be read from the previous backend');
    console.log('');return;
   }
   if(format==='{{.Image}} {{.State.Running}}'&&name==='postgres'){
    console.log((failure==='resume-wrong-postgres'?image('inquiry'):image('postgres'))+' '+(failure!=='resume-stopped-postgres'));return;
   }
   if(name==='clamav' && format==='{{.State.Status}}'){
    console.log(read('runtime.json').clamavRunning===false?'exited':'running');return;
   }
   console.log(format==='{{.Image}}'?image(name):format==='{{.Id}}'?service:format==='{{.State.Running}}'?'false':'10.0.0.2');
  } else console.log(JSON.stringify([container('backend',backendId,{...runtimeEnvironment,...rollbackEnvironment})]));
  return;
 }
 if(a[0]==='cp'){
  const [source,destination]=a.slice(1).filter(value=>value!=='-a');
  if(source==='clamav:/etc/clamav/.' && destination==='-'){process.stdout.write('effective-config-fixture');return;}
  if(source.startsWith(backendId+':/app/recovery-coordination/')){copy(path.join(coordination,source.split('/app/recovery-coordination/')[1]),destination);return;}
  if(destination===backendId+':/app/recovery-coordination/'){copy(source,path.join(coordination,path.basename(source)));return;}
  if(source==='-'){
   if(!read('runtime.json').bankRestored)throw Error('Configuration must follow bank restore');
   fs.writeFileSync(path.join(root,'restored-config.tar'),fs.readFileSync(0));return;
  }
  throw Error('Unexpected copy');
 }
 if(a[0]==='exec'&&a[1]===backendId&&a.at(-1).includes('p=/app/storage/dispatch-documents'))return;
 if(a[0]!=='compose')throw Error('Unexpected fixture Docker command: '+a[0]);
 if(a.includes('ps')){
  if(a.at(-1)==='postgres'&&failure==='resume-missing-postgres')return;
  console.log(a.at(-1)==='backend'?backendId:a.at(-1)==='postgres'?postgresId:a.at(-1));return;
 }
 if(a.includes('config')){console.log(a.includes('json')?JSON.stringify({name:'sabalanerp',services:{postgres:{environment:bootstrapEnvironment},deployment:{environment:controlEnvironment},backend:{environment:runtimeEnvironment,volumes:[{type:'volume',source:'backend_storage_dispatch_documents',target:'/app/storage/dispatch-documents'}]}},volumes:{backend_storage_dispatch_documents:{name:'fixture_dispatch_documents'}}}):'services: {}');return;}
 if(a.some(value=>value.includes('exec python3 - --assert-closed'))){if(failure==='runtime-not-closed')process.exit(49);return;}
 if(a.includes('stop') && a.includes('clamav')){
  const state=read('runtime.json');state.clamavRunning=false;save('runtime.json',state);return;
 }
 if(a.includes('build')||a.includes('create')||a.includes('stop')||a.includes('start'))return;
 if(a.includes('up')){
  if(a.includes('clamav')){const state=read('runtime.json');state.clamav=process.env.DEPLOYMENT_CLAMAV_IMAGE;state.clamavRunning=true;save('runtime.json',state);}return;
 }
 if(a.includes('dist/scripts/deployment-control.js')){
  const command=a[a.indexOf('dist/scripts/deployment-control.js')+1],session='reports/active-deployment-session.json';
  if(command==='prepare')save(session,{deploymentId:env('DEPLOYMENT_ID'),leaseToken:'fixture-lease',phase:'PREFLIGHT',rollbackPerformanceEnvironment:rollbackEnvironment,clamavOperation:env('DEPLOYMENT_CLAMAV_OPERATION'),clamavIncidentSnapshotSha256:env('DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_SHA256'),clamavIncidentReceiptSha256:env('DEPLOYMENT_CLAMAV_INCIDENT_RECEIPT_SHA256')});
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
  const {requireBoundary,boundIncidentTarget,captureUnit,restoreUnit,verifyUnit,verifyIncidentCapture}=await import(require('node:url').pathToFileURL(path.join(repository,'backend/scripts/clamav-checkpoint.mjs')));
  const command=a[a.indexOf('scripts/clamav-checkpoint.mjs')+1];
  requireBoundary({session:read('reports/active-deployment-session.json'),active:read('active.json'),maintenance:read('maintenance.json'),id,token:env('DEPLOYMENT_LEASE_TOKEN'),phase:{capture:'SERVICES_DRAINED','verify-incident-capture':'REMOTE_CHECKPOINT_VERIFIED',activate:'MUTATION_STARTED'}[command]});
  const binding=()=>boundIncidentTarget(read('reports/active-deployment-session.json'),Object.fromEntries(['DEPLOYMENT_CLAMAV_OPERATION',
   'DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_SHA256','DEPLOYMENT_CLAMAV_INCIDENT_RECEIPT_SHA256','DEPLOYMENT_CLAMAV_TARGET_IMAGE'].map(key=>[key,env(key)])));
  const target=binding();
  if(command==='capture'){
   const incident=Boolean(target);
   if(failure==='target-coordinate-capture')fs.appendFileSync(path.join(unit,'target.json'),'\n');
   if(hash(fs.readFileSync(path.join(unit,incident?'incident-snapshot.json':'rollback-proof.json')))!==env(incident?'DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_SHA256':'DEPLOYMENT_CLAMAV_ROLLBACK_PROOF_SHA256'))throw Error('Original evidence changed');
   await captureUnit({bank,unit,id,image:image('clamav'),target});
  } else if (command==='verify-incident-capture') {
   const capturedAt=await verifyIncidentCapture({unit,id,checkpoint:read('checkpoint.json'),target,
    snapshotSha256:env('DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_SHA256')});
   console.log(capturedAt);
  } else {
   const checkpoint=read('checkpoint.json');await verifyUnit({unit,id,checkpoint});
   const receipt=JSON.parse(fs.readFileSync(path.join(unit,'target.json')));
   if(receipt.image!==env('DEPLOYMENT_CLAMAV_TARGET_IMAGE')||receipt.bankSha256!==hash(fs.readFileSync(path.join(unit,'target-bank.tar'))))throw Error('Activation binding mismatch');
   await restoreUnit({bank,unit,id,checkpoint,target,archive:'target-bank.tar',beforeMutation:async()=>{
    if(failure==='install-interrupted')throw Error('Injected interrupted installation');
    const active=read('active.json');if(failure==='lease-expired')active.leaseExpiresAt=new Date(0).toISOString();
    requireBoundary({session:read('reports/active-deployment-session.json'),active,maintenance:read('maintenance.json'),id,token:env('DEPLOYMENT_LEASE_TOKEN'),phase:'MUTATION_STARTED'});
    binding();
   }});
   if(failure==='post-mutation'&&env('DEPLOYMENT_CLAMAV_OPERATION')==='incident-recovery')process.exit(44);
  }
  return;
 }
 if(a.includes('dist/scripts/deployment-retention-local.js')){
  const i=a.indexOf('dist/scripts/deployment-retention-local.js'),command=a[i+1],stage=a[i+2],id=env('DEPLOYMENT_ID');
  if(!['BEFORE_CHECKPOINT','AFTER_CHECKPOINT'].includes(stage))throw Error('Unexpected retention stage');
  const name=`remote-retention-${id}-${stage}.json`,file=path.join(root,'reports',name);
  if(command==='export-holds')fs.writeFileSync(path.join(root,'reports',`retention-holds-${id}-${stage}.json`),'[]\n',{flag:'wx',mode:0o400});
  else if(command==='apply'){
   const receipt=JSON.parse(fs.readFileSync(file));
   if(receipt.format!=='fixture-only-host-retention'||receipt.deploymentId!==id||receipt.stage!==stage||env('DEPLOYMENT_REMOTE_RETENTION_RECEIPT')!==`/app/deployment-reports/${name}`||env('DEPLOYMENT_REMOTE_RETENTION_RECEIPT_SHA256')!==hash(fs.readFileSync(file)))throw Error('Retention receipt mismatch');
  } else throw Error('Unexpected retention command');
  return;
 }
 // This simulates a predecessor image carrying the old recency blocker.
 if(a.includes('dist/scripts/deployment-drill-preflight.js'))process.exit(49);
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
 if(a.includes('dist/scripts/deployment-owned-migrations.js')&&a.includes('--verify-current')){
  installTsHook();
  const directory=path.join(repository,'backend/prisma/migrations');
  const history=fs.readdirSync(directory,{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>({
   name:entry.name,checksum:hash(fs.readFileSync(path.join(directory,entry.name,'migration.sql'))),finished:new Date(),rolledBack:null
  }));
  if(failure==='ledger-checksum')history[0].checksum='0'.repeat(64);
  if(failure==='ledger-pending')history.pop();
  const script=path.join(repository,'backend/src/scripts/deployment-owned-migrations.ts');
  const Module=require('node:module');
  const load=Module._load;
  const argv=process.argv;
  try {
   await new Promise(resolve=>{
    Module._load=function(request,parent,isMain){
     if(parent?.filename===script){
      if(request==='../lib/prisma')return {prisma:{$queryRaw:async()=>history},disconnectDatabase:resolve};
      if(request==='../services/protectedBridgeMigrations')throw Error('Read-only verification must not load migration writers');
     }
     return load.apply(this,arguments);
    };
    process.argv=[process.execPath,script,'--verify-current'];
    require(script);
   });
  } finally { Module._load=load; process.argv=argv; }
  return;
 }
 if(a.some(value=>value.includes('verifyInquiryBaseline(path.join')))return;
 if(a.includes('dist/scripts/deployment-inquiry.js')){
  if(!a.includes('scripts/with-backend-control-ownership.sh')||phase()!=='MIGRATIONS_APPLIED')throw Error('Inquiry ownership boundary unproven');
  return;
 }
 if(a.includes('dist/scripts/deployment-owned-migrations.js')){
  if(!a.includes('scripts/with-backend-control-ownership.sh')||phase()!=='MUTATION_STARTED')throw Error('Migration ownership boundary unproven');
  if(['post-mutation','rollback-qualifier'].includes(failure))process.exit(44);return;
 }
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
 if(a.includes('sh') && a.includes('-c') && a.at(-1).includes('exec python3 - --assert-closed')){
  const prior=fs.readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  if(!prior.some(row=>row.kind==='python3'&&row.args[1]==='--assert-resolved'))throw Error('Native closure before signal resolution');
  return;
 }
 if(a.includes('exec')&&a.some(value=>value.includes('pg_isready')))return;
 if(a.includes('exec')){
  const text=a.at(-1);
  if(text.includes('default_transaction_read_only')){
   const sql=fs.readFileSync(0,'utf8');
   if(!sql.includes('public.customer_allocation_release_control'))throw Error('Customer allocation guard must read the release state');
   console.log('ABSENT');return;
  }
  if(text.includes('pg_sleep(21600)')){fs.writeFileSync(path.join(root,'advisory.pid'),String(process.pid));setInterval(()=>{},1000);return;}
  if(text.includes('pg_locks'))console.log('1');
  else if(text.includes('pg_stat_activity WHERE client_addr'))console.log('0');
  else if(text.includes('round(100.0'))console.log('20');
  else if(text.includes('pg_database_size'))console.log('1000000');
  else if(text.includes('df -Pk'))console.log('6000000');
  else if(!text.includes('pg_terminate_backend')&&!text.includes('HR_HIRING_ANTIVIRUS_COMMAND'))throw Error('Unexpected exec');
  return;
 }
 const allowed=['validate-production-environment','deployment-notify','deployment-gates','deployment-finalize-recovery','deployment-inquiry','dry-run-contract-product-graph-migration','audit-hr-onboarding-task-retirement','migrate-all-contract-product-graphs','reconcile-contract-financial-evidence'];
 if(a.includes('dist/scripts/deployment-notify.js')&&a.includes('retry-blocker')&&failure==='before-maintenance')process.exit(22);
 if(allowed.some(script=>a.includes('dist/scripts/'+script+'.js')))return;
 throw Error('Unexpected fixture CLI operation: '+JSON.stringify(a));
})().catch(error=>{console.error(error.message);process.exitCode=90;});
