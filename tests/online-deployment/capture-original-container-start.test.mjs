import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {originalServiceConfiguration,originalContainerIdentities,startOriginalCaptureServices,observeOriginalCaptureChild} from '../../deploy/scripts/capture-only-release.mjs';
const roles=['backend','frontend','inquiry','nginx','postgres','clamav'];
function fixture(){
 const rows=roles.map((role,i)=>({Id:String(i+1).repeat(64),Created:'2026-10-19T00:00:00Z',Image:'sha256:'+'a'.repeat(64),Config:{Hostname:String(i+1).repeat(12),Image:'original-reference',Env:['FIRST=1','SECOND=2'],Labels:{'com.docker.compose.project':'sabalanerp','com.docker.compose.service':role}},HostConfig:{Binds:['/one:/one','/two:/two']},Mounts:[],NetworkSettings:{Networks:{sabalanerp:{}}},State:{Running:false,Health:{Status:'unhealthy'},StartedAt:'before-stop'}}));
 const snapshot={services:originalServiceConfiguration(rows),originalContainerIdentities:originalContainerIdentities(rows),configurationBytes:{env:{sha256:'original',bytes:10}}};let now=0;const events=[];
 const io={now:()=>now,overallDeadlineMs:600000,sleep:async ms=>{now+=ms;},bindings:async()=>snapshot.configurationBytes,inspect:async()=>structuredClone(rows),start:async ids=>{events.push(['start',...ids]);for(const row of rows.filter(row=>ids.includes(row.Id))){row.State={Running:true,Health:{Status:'healthy'},StartedAt:'original-container-started'};}},restart:async id=>{events.push(['restart',id]);const row=rows.find(row=>row.Id===id);row.State={Running:true,Health:{Status:'healthy'},StartedAt:'nginx-restarted'};}};
 return {rows,snapshot,io,events};
}
test('actual capture start orchestration starts original IDs and restarts original nginx without changing any configuration bytes',async()=>{
 const f=fixture();await startOriginalCaptureServices(f.snapshot,f.io,30);assert.deepEqual(f.events,[['start',...['postgres','clamav','backend','frontend','inquiry'].map(role=>f.snapshot.originalContainerIdentities[role].id)],['restart',f.snapshot.originalContainerIdentities.nginx.id]]);assert.deepEqual(originalServiceConfiguration(f.rows),f.snapshot.services);assert.deepEqual(originalContainerIdentities(f.rows),f.snapshot.originalContainerIdentities);
});
test('missing original IDs, same-image replacement, Env reordering and changed config binds refuse before starting',async()=>{
 for(const mutate of [f=>delete f.snapshot.originalContainerIdentities,f=>f.rows[0].Id='f'.repeat(64),f=>f.rows[0].Created='2026-10-20T00:00:00Z',f=>f.rows[0].Config.Env.reverse(),f=>f.io.bindings=async()=>({changed:true})]){const f=fixture();mutate(f);await assert.rejects(startOriginalCaptureServices(f.snapshot,f.io,30));assert.deepEqual(f.events,[]);}
});
test('configuration changes after start and unresolved health never reach nginx restart or any reopen',async()=>{
 const f=fixture(),start=f.io.start;f.io.start=async ids=>{await start(ids);f.rows[0].Config.Env.push('NEW=unsafe');};await assert.rejects(startOriginalCaptureServices(f.snapshot,f.io,30));assert.equal(f.events.length,1);
 const slow=fixture();slow.io.start=async ids=>slow.events.push(['start',...ids]);await assert.rejects(startOriginalCaptureServices(slow.snapshot,slow.io,2),/HEALTH_BUDGET/);assert.equal(slow.events.length,1);
});
test('remaining original global budget controls admission and late natural completion never admits the next mutation',async()=>{
 const expired=fixture();expired.io.overallDeadlineMs=-1;await assert.rejects(startOriginalCaptureServices(expired.snapshot,expired.io,300),/BUDGET/);assert.deepEqual(expired.events,[]);
 for(const phase of ['start','restart']){const f=fixture();f.io.overallDeadlineMs=1000;const original=f.io[phase];f.io[phase]=async value=>{await original(value);await f.io.sleep(1001);};await assert.rejects(startOriginalCaptureServices(f.snapshot,f.io,300),/BUDGET/);assert.equal(f.events.length,phase==='start'?1:2);assert.equal(f.rows[0].State.Running,true);}
});
test('signal during original start retains its native observer through natural closure and prevents nginx restart',async()=>{
 const f=fixture(),child=new EventEmitter();Object.assign(child,{pid:321,stdout:new PassThrough(),stderr:new PassThrough()});let interrupted=false,closed=false,settled=false;const receipts=[];
 f.io.start=async ids=>{f.events.push(['start',...ids]);await observeOriginalCaptureChild(child,{now:()=>0,deadline:10000,isInterrupted:()=>interrupted,onHeld:()=>{},onClosed:row=>{closed=true;receipts.push(row);}});};
 const running=startOriginalCaptureServices(f.snapshot,f.io,30).then(()=>{settled=true;},error=>{settled=true;throw error;});
 await new Promise(resolve=>setImmediate(resolve));interrupted=true;await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);assert.equal(closed,false);
 child.stdout.end('0\n');child.stderr.end();child.emit('close',0,null);await assert.rejects(running,/INTERRUPTION_HELD/);assert.equal(receipts[0].closed,true);assert.equal(receipts[0].interrupted,true);assert.equal(f.events.length,1);
});
test('actual shell capture completion and pre-mutation failure share pinned start; ordinary release retains compose path',()=>{
 const source=fs.readFileSync(new URL('../../deploy/scripts/deploy.sh',import.meta.url),'utf8').replaceAll('\r\n','\n'),begin=source.indexOf('start_release_services() {'),end=source.indexOf('\n}\n',begin)+3,body=source.slice(begin,end),shell=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/sh';
 for(const capture of [0,1]){const script=['set -eu',`CAPTURE_ONLY=${capture}; MUTATION_STARTED=0; MAINTENANCE_ACTIVE=1; DB_LEASE_ACQUIRED=1; capture_pause_started=123`, 'SESSION_HOST_PATH=/private/original-session; CAPTURE_ONLY_SNAPSHOT=/private/snapshot; ENV_FILE=deploy/.env.prod; REPO_ROOT=/opt/sabalanerp; OPERATIONS_ROOT=/private/ops; COMPOSE_FILE=docker-compose.prod.yml','DEPLOYMENT_CLAMAV_OPERATION=repair; DEPLOYMENT_CLAMAV_REPAIR=false; DEPLOYMENT_PHASE=REMOTE_CHECKPOINT_VERIFIED','capture_remaining_seconds(){ echo 19; }','node(){ printf "PINNED:%s:%s:%s:%s:%s:%s\\n" "$2" "$3" "$4" "$5" "$6" "$7"; }','run_original_owned_with_heartbeat(){ echo HEARTBEAT_OWNER; "$@"; }','compose(){ echo COMPOSE:$*; }',body,'start_release_services 30'].join('\n');const result=spawnSync(shell,['-c',script],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);if(capture){assert.match(result.stdout,/HEARTBEAT_OWNER/);assert.match(result.stdout,/PINNED:start-original:\/private\/snapshot:deploy\/\.env.prod:\/opt\/sabalanerp\/docker-compose.prod.yml:19:123/);assert.doesNotMatch(result.stdout,/COMPOSE:/);}else{assert.match(result.stdout,/COMPOSE:up -d --no-build/);assert.match(result.stdout,/force-recreate/);assert.doesNotMatch(result.stdout,/PINNED:/);}}
 for(const name of ['complete_capture_only() {','recover_failure() {']){const from=source.indexOf(name);assert.ok(source.indexOf('start_release_services 300',from)>from);}
});
