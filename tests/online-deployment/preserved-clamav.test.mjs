import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {validateSelection,validateBinding,selectionBinding,canonical,hash,validateResumeSelection,validatePreservationJournal,validateIdentity,assertComposePreserves,infrastructureDescriptor,preservationSources} from '../../deploy/scripts/preserved-clamav.mjs';
function fixture(){
 const row={Id:'a'.repeat(64),Image:'sha256:'+'b'.repeat(64),State:{StartedAt:'2026-10-20T11:34:38.50560581Z',Pid:159049,Running:true,Restarting:false,Dead:false,Health:{Status:'healthy'}},Config:{Labels:{'com.docker.compose.project':'sabalanerp','com.docker.compose.service':'clamav'},Env:['NOTE=فارسی😀']},HostConfig:{ExtraHosts:[]},Mounts:[{Type:'volume',Name:'sabalanerp_clamav_database',RW:true}],NetworkSettings:{Networks:{sabalanerp_default:{IPAddress:'172.18.0.5'}}}};
 const selection={format:'sabalan-preserved-clamav/v1',containerId:row.Id,image:row.Image,startedAt:row.State.StartedAt,hostPid:row.State.Pid,stableConfigurationSha256:hash(canonical({Config:row.Config,HostConfig:row.HostConfig,Mounts:row.Mounts,Networks:row.NetworkSettings.Networks})),initialIdentitySha256:'c'.repeat(64),initialHealthSha256:'d'.repeat(64)};
 return {row,selection,binding:selectionBinding(selection,'e'.repeat(64))};
}
test('canonical stable projection uses Python ensure_ascii escaping and Unicode code-point key ordering',()=>{
 assert.equal(canonical({'😀':'پ','\ue000':'漢',a:'\u007f'}),String.raw`{"a":"\u007f","\ue000":"\u6f22","\ud83d\ude00":"\u067e"}`);
});
test('exact existing scanner preserves stable fields while mutable health history may advance',()=>{
 const {row,selection}=fixture();validateIdentity(selection,row);row.State.Health.Log=[{Output:'new naturally eligible update'}];row.State.Health.FailingStreak=0;validateIdentity(selection,row);
 for(const change of [r=>r.Id='f'.repeat(64),r=>r.Image='sha256:'+'f'.repeat(64),r=>r.State.Pid++,r=>r.State.StartedAt='2026-10-23T00:00:00Z',r=>r.State.Running=false,r=>r.State.Restarting=true,r=>r.State.Health.Status='unhealthy',r=>r.Config.Env.push('CHANGED=true'),r=>r.HostConfig.ExtraHosts.push('sabalan-clamav-egress:host-gateway'),r=>r.Mounts[0].RW=false,r=>r.NetworkSettings.Networks.sabalanerp_default.IPAddress='172.18.0.9']){
  const changed=structuredClone(row);change(changed);assert.throws(()=>validateIdentity(selection,changed));
 }
});
test('scanner mutation, implicit all services, unknown services and dependency recreation refuse',()=>{
 for(const args of [['run','--no-deps','clamav'],['exec','clamav','sh'],['run','--no-deps','unknown'],['up','--no-deps','--always-recreate-deps','postgres'],['up','--no-deps','--scale','clamav=0','postgres'],['up','--no-deps'],['up','frontend'],['up','--no-deps','clamav'],['down'],['stop'],['restart','backend']])assert.throws(()=>assertComposePreserves(args),args.join(' '));
 for(const args of [['up','-d','--no-deps','--no-build','--wait','--wait-timeout','300','postgres','backend','frontend','inquiry','nginx'],['stop','-t','300','frontend','backend','inquiry'],['run','-T','--rm','--no-deps','deployment','node','script'],['exec','-T','backend','sh','-c','test'],['ps','-q','clamav']])assertComposePreserves(args);
});
test('binding refuses omitted or changed selection; desired alias hash differs from effective scanner hash',()=>{
 const {binding}=fixture();validateBinding(binding);const changed=structuredClone(binding);changed.selection.hostPid++;assert.throws(()=>validateBinding(changed));
 assert.throws(()=>validateSelection({...binding.selection,force:true}));assert.throws(()=>validateBinding({planSha256:binding.planSha256}));
 const first=infrastructureDescriptor('1'.repeat(64),binding),next=infrastructureDescriptor('2'.repeat(64),binding);
 assert.equal(first.preservedClamavStableConfigurationSha256,binding.selection.stableConfigurationSha256);assert.notEqual(hash(canonical(first)),hash(canonical(next)));assert.notEqual(hash(canonical(first)),first.desiredComposeSha256);
});
test('abort and rollback execute preservation branch without scanner creation or dependency traversal',()=>{
 const source=fs.readFileSync(new URL('../../deploy/scripts/deploy.sh',import.meta.url),'utf8').replaceAll('\r\n','\n');const start=source.indexOf('start_release_services() {'),end=source.indexOf('\nrun_backend()',start);assert.ok(start>0&&end>start);
 const shell=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/sh';
 for(const mutation of [0,1]){
  const code=`set -eu\nCAPTURE_ONLY=0\nMUTATION_STARTED=${mutation}\nDEPLOYMENT_CLAMAV_OPERATION=repair\nDEPLOYMENT_CLAMAV_REPAIR=false\nDEPLOYMENT_PRESERVED_CLAMAV_BINDING_HEX=bound\npreserved_clamav_guard(){ [ "$1" = health ]; }\ncompose(){ printf '%s\\n' "$*"; }\n`+source.slice(start,end)+'\nstart_release_services 300\n';
  const result=spawnSync(shell,['-c',code],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);const lines=result.stdout.trim().split('\n');assert.equal(lines.length,2);for(const line of lines){assert.ok(line.includes('--no-deps'));assert.ok(!line.split(' ').includes('clamav'));}
 }
});
test('host pack carries all canonical inspector imports and preservation policy without dropping original ports',()=>{
 const result=spawnSync(process.execPath,['scripts/build-online-controller-host-pack.mjs','--inspect'],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);const files=JSON.parse(result.stdout).hostFiles;
 for(const file of preservationSources)assert.equal(files.filter(name=>name===file).length,1,file);
 for(const file of ['deploy/scripts/online-owner-service.py','deploy/scripts/online-release-launcher.py','deploy/scripts/capture-only-release.mjs','deploy/scripts/legacy-backend-signal.py'])assert.ok(files.includes(file));
});

test('resume cannot silently drop preservation after lost plan metadata or mismatched original journal',()=>{
 const {binding}=fixture();const session={deploymentId:'deploy-actual',preservedClamav:binding},journal={deploymentId:'deploy-actual',sequence:1,event:'deployment-prepared',details:{preservedClamav:binding}};
 assert.deepEqual(validateResumeSelection(session,journal,binding,null),binding);
 for(const [saved,log,metadata,inherited]of [[session,journal,null,null],[{deploymentId:session.deploymentId},journal,binding,null],[session,{...journal,details:{}},binding,null],[session,{...journal,deploymentId:'other'},binding,null],[session,journal,binding,selectionBinding(binding.selection,'f'.repeat(64))]])assert.throws(()=>validateResumeSelection(saved,log,metadata,inherited));
 assert.equal(validateResumeSelection({deploymentId:'legacy'},{deploymentId:'legacy',sequence:1,event:'deployment-prepared'},null,null),null);
});

test('resume journal binding verifies real checksum chain before any Compose call',()=>{
 const unsigned={sequence:1,at:'2026-10-23T11:02:08Z',deploymentId:'deploy-actual',phase:'PREFLIGHT',event:'deployment-prepared',previousHash:null,details:{preservedClamav:fixture().binding}};
 const entry={...unsigned,hash:hash(JSON.stringify(unsigned))};assert.deepEqual(validatePreservationJournal([entry]),entry);
 const changed=structuredClone(entry);changed.details.preservedClamav.selection.hostPid++;assert.throws(()=>validatePreservationJournal([changed]));
 assert.throws(()=>validatePreservationJournal([{...entry,sequence:2}]));assert.throws(()=>validatePreservationJournal([]));
});

test('owned lease heartbeats continue after inspector deadline until actual original EOF; late gate never reopens',()=>{
 const source=fs.readFileSync(new URL('../../deploy/scripts/deploy.sh',import.meta.url),'utf8').replaceAll('\r\n','\n');
 const extract=(from,to)=>{const start=source.indexOf(from),end=source.indexOf(to,start);assert.ok(start>=0&&end>start);return source.slice(start,end);};
 const guarded=extract('preserved_clamav_guard() {','\ncompose() {'),heartbeat=extract('run_original_owned_with_heartbeat() {','\nwait_for_cutover_approval() {'),control=extract('control() {','\nenter_maintenance() {');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-preserved-original-')),events=path.join(directory,'events.log'),fixtureFile=path.join(directory,'original.mjs');
 try{
  const helper=new URL('../../deploy/scripts/preserved-clamav.mjs',import.meta.url);
  const childSource="const fs=require('node:fs');setTimeout(()=>{fs.appendFileSync(process.argv[1],'CHILD_EXITING\\n');process.stdout.write('normal EOF\\n');},450);";
  fs.writeFileSync(fixtureFile,`import fs from 'node:fs';\nimport {observeOriginalCommand} from ${JSON.stringify(helper.href)};\nconst file=process.argv[2];fs.appendFileSync(file,'INSPECTOR_STARTED\\n');const original=process.stderr.write.bind(process.stderr);process.stderr.write=(data,...rest)=>{if(String(data).includes('DEADLINE_HELD'))fs.appendFileSync(file,'DEADLINE_HELD\\n');return original(data,...rest);};\ntry{await observeOriginalCommand(process.execPath,['-e',${JSON.stringify(childSource)},file],25);fs.appendFileSync(file,'UNEXPECTED_SUCCESS\\n');}catch(error){fs.appendFileSync(file,'ORIGINAL_CLOSED '+JSON.stringify(error.original)+'\\n');process.exitCode=75;}\n`);
  const shell=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/sh';
  const code=`set -eu\nDB_LEASE_ACQUIRED=1\nDEPLOYMENT_PRESERVED_CLAMAV_BINDING_HEX=bound\nDEPLOYMENT_CLAMAV_REPAIR=false\nOPERATIONS_ROOT=/fixed/pack\nnode(){ "$PRESERVATION_REAL_NODE" "$PRESERVATION_FIXTURE" "$PRESERVATION_EVENTS"; }\nsleep(){ command sleep 0.005; }\nrun_backend(){ printf 'HEARTBEAT %s\\n' "$*" >> "$PRESERVATION_EVENTS"; }\n${guarded}\n${heartbeat}\n${control}\nif preserved_clamav_guard health; then printf 'REOPEN\\n' >> "$PRESERVATION_EVENTS"; else printf 'REFUSED\\n' >> "$PRESERVATION_EVENTS"; fi\n`;
  const result=spawnSync(shell,['-c',code],{encoding:'utf8',env:{...process.env,PRESERVATION_REAL_NODE:process.execPath.replaceAll('\\','/'),PRESERVATION_FIXTURE:fixtureFile.replaceAll('\\','/'),PRESERVATION_EVENTS:events.replaceAll('\\','/')}});
  assert.equal(result.status,0,result.stderr);const lines=fs.readFileSync(events,'utf8').trim().split('\n');
  assert.equal(lines.filter(line=>line==='INSPECTOR_STARTED').length,1);const held=lines.indexOf('DEADLINE_HELD'),exiting=lines.indexOf('CHILD_EXITING'),closed=lines.findIndex(line=>line.startsWith('ORIGINAL_CLOSED '));assert.ok(held>=0&&exiting>held&&closed>exiting,lines.join('\n'));
  assert.ok(lines.slice(held+1,closed).some(line=>line==='HEARTBEAT node dist/scripts/deployment-control.js heartbeat'),'raw lease heartbeat continued after deadline');
  const observed=JSON.parse(lines[closed].slice('ORIGINAL_CLOSED '.length));assert.equal(observed.code,0);assert.equal(observed.signal,null);assert.equal(observed.pipesClosed,true);assert.equal(observed.deadlineExceeded,true);assert.ok(Number.isSafeInteger(observed.pid));assert.equal(lines.at(-1),'REFUSED');assert.ok(!lines.includes('REOPEN'));assert.ok(!lines.includes('UNEXPECTED_SUCCESS'));
 }finally{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('sabalan-preserved-original-'));fs.rmSync(directory,{recursive:true,force:true});}
});
test('actual Docker builder COPY projection resolves the new TypeScript policy declaration before tsc',()=>{
 const require=createRequire(new URL('../../backend/package.json',import.meta.url)),ts=require('typescript');
 const root=fileURLToPath(new URL('../../',import.meta.url)),docker=fs.readFileSync(path.join(root,'backend/Dockerfile'),'utf8');
 const builder=docker.slice(0,docker.indexOf('RUN NODE_OPTIONS=--max-old-space-size=3072 npm run build'));
 const files=new Map();
 for(const line of builder.split(/\r?\n/)){
  if(!line.startsWith('COPY ')||!line.endsWith(' ./scripts/'))continue;
  const inputs=line.split(/\s+/).slice(1,-1);for(const input of inputs)files.set('/fixture/app/scripts/'+path.posix.basename(input),path.join(root,input));
 }
 const importer='/fixture/app/src/scripts/deployment-control.ts',specifier='../../scripts/preserved-clamav-policy.mjs';
 const resolve=selected=>ts.resolveModuleName(specifier,importer,{moduleResolution:ts.ModuleResolutionKind.Node10},{fileExists:file=>selected.has(file)&&fs.statSync(selected.get(file)).isFile(),readFile:file=>selected.has(file)?fs.readFileSync(selected.get(file),'utf8'):undefined}).resolvedModule;
 const resolved=resolve(files);assert.ok(resolved,'policy must resolve inside actual builder inputs');assert.equal(resolved.resolvedFileName,'/fixture/app/scripts/preserved-clamav-policy.d.mts');assert.ok(files.has('/fixture/app/scripts/preserved-clamav-policy.mjs'),'runtime module copied with its declaration');
 const missing=new Map(files);missing.delete('/fixture/app/scripts/preserved-clamav-policy.mjs');missing.delete('/fixture/app/scripts/preserved-clamav-policy.d.mts');assert.equal(resolve(missing),undefined,'negative control reproduces the previous missing-module failure');
});

test('successful stdout-valued guard stays exact while real owned heartbeat JSON goes to stderr',()=>{
 const source=fs.readFileSync(new URL('../../deploy/scripts/deploy.sh',import.meta.url),'utf8').replaceAll('\r\n','\n');
 const extract=(from,to)=>{const start=source.indexOf(from),end=source.indexOf(to,start);assert.ok(start>=0&&end>start);return source.slice(start,end);};
 const guarded=extract('preserved_clamav_guard() {','\ncompose() {'),heartbeat=extract('run_original_owned_with_heartbeat() {','\nwait_for_cutover_approval() {'),control=extract('control() {','\nenter_maintenance() {');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-preserved-stdout-')),events=path.join(directory,'events.log'),fixtureFile=path.join(directory,'success.mjs'),payload='a'.repeat(64);
 try{
  const helper=new URL('../../deploy/scripts/preserved-clamav.mjs',import.meta.url),childSource=`setTimeout(()=>process.stdout.write(${JSON.stringify(payload)}),1200);`;
  fs.writeFileSync(fixtureFile,`import {observeOriginalCommand} from ${JSON.stringify(helper.href)};\nprocess.stdout.write(await observeOriginalCommand(process.execPath,['-e',${JSON.stringify(childSource)}],10000));\n`);
  const shell=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/sh';
  const code=`set -eu\nDB_LEASE_ACQUIRED=1\nDEPLOYMENT_PRESERVED_CLAMAV_BINDING_HEX=bound\nDEPLOYMENT_CLAMAV_REPAIR=false\nOPERATIONS_ROOT=/fixed/pack\nnode(){ "$PRESERVATION_REAL_NODE" "$PRESERVATION_FIXTURE"; }\nsleep(){ command sleep 0.005; }\nrun_backend(){ printf '{"ok":true,"phase":"heartbeat"}\\n'; printf 'HEARTBEAT\\n' >> "$PRESERVATION_EVENTS"; }\n${guarded}\n${heartbeat}\n${control}\nvalue="$(preserved_clamav_guard infrastructure desiredHash)"\nprintf '%s' "$value"\n`;
  const result=spawnSync(shell,['-c',code],{encoding:'utf8',env:{...process.env,PRESERVATION_REAL_NODE:process.execPath.replaceAll('\\','/'),PRESERVATION_FIXTURE:fixtureFile.replaceAll('\\','/'),PRESERVATION_EVENTS:events.replaceAll('\\','/')}});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,payload,'heartbeat JSON cannot contaminate captured infrastructure digest or Compose YAML');assert.match(result.stderr,/\{"ok":true,"phase":"heartbeat"\}/);assert.ok(fs.readFileSync(events,'utf8').trim().split('\n').length>=1);
  // Negative control runs only mocked backend/helper services and reproduces the old capture bug.
  const unsafeHeartbeat=heartbeat.replace('control heartbeat >&2','control heartbeat');assert.notEqual(unsafeHeartbeat,heartbeat);
  const negative=spawnSync(shell,['-c',code.replace(heartbeat,unsafeHeartbeat)],{encoding:'utf8',env:{...process.env,PRESERVATION_REAL_NODE:process.execPath.replaceAll('\\','/'),PRESERVATION_FIXTURE:fixtureFile.replaceAll('\\','/'),PRESERVATION_EVENTS:events.replaceAll('\\','/')}});
  assert.equal(negative.status,0,negative.stderr);assert.notEqual(negative.stdout,payload);assert.match(negative.stdout,/\{"ok":true,"phase":"heartbeat"\}/);assert.ok(negative.stdout.endsWith(payload));

 }finally{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('sabalan-preserved-stdout-'));fs.rmSync(directory,{recursive:true,force:true});}
});
