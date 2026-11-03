/** Read-only prerequisites; not wrapper/replay acceptance or a lease issuer. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {retainSerialChild} from '../../../scripts/lib/serial-physical/retained-child.mjs';
const root='C:/Users/mahan/.codex/worktrees/online-deployment/sabalanerp';
const docker='C:/Users/mahan/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe';
const out=path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'));
const sha=raw=>createHash('sha256').update(raw).digest('hex');
assert.equal(sha(fs.readFileSync(docker)),'f71e5a9fe6a8db10c7296ad6fdf0c1d7d79634e644d7ec1e8a2c18d7dcb52d21');
const rows=[];let ordinal=0;
async function run(argv,phase){
 const stdout=[],stderr=[];
 const child=spawn(docker,argv,{cwd:root,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let receipt;
 await retainSerialChild(child,{phase,sinks:Object.fromEntries([['stdout',stdout],['stderr',stderr]].map(([name,parts])=>[name,{write(raw){parts.push(Buffer.from(raw));return raw.length;},sync(){},close(){}}])),persistReceipt(row){
  receipt=row;const file=path.join(out,String(ordinal).padStart(3,'0')+'-'+phase+'.json');
  const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(row,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 }});
 ordinal++;rows.push(receipt);
 // Never persist full Compose config/env or unfiltered inspect output.
 return Buffer.concat(stdout).toString('utf8');
}
const compose=['compose','--project-name','sabalanerp-local','-f',path.join(root,'docker-compose.local.yml')];
function parseRows(raw){return raw.trim().startsWith('[')?JSON.parse(raw):raw.trim().split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x));}
async function census(phase){
 const actual=parseRows(await run([...compose,'ps','--all','--no-trunc','--format','json'],phase));
 assert.equal(actual.length,10);
 for(const item of actual){assert.equal(item.Project,'sabalanerp-local');assert.equal(item.State,'running');assert.equal(item.Health,'healthy');}
 return actual.map(({ID,Service,State,Health})=>({ID,Service,State,Health})).sort((a,b)=>a.Service.localeCompare(b.Service));
}
const initial=await census('INITIAL_PS');
await census('BEFORE_INSPECT_PS');
const template='{{json .Config.Labels}}';
const labels=JSON.parse(await run(['inspect','sabalanerp-local-postgres-1','--format',template],'POSTGRES_OWNER_LABELS'));
assert.equal(labels['com.docker.compose.project'],'sabalanerp-local');assert.equal(labels['com.docker.compose.service'],'postgres');
const actualFile=labels['com.docker.compose.project.config_files'];
assert.equal(actualFile,'D:\\sabalanerp\\docker-compose.local.yml');
await census('BEFORE_SOURCE_CONFIG_PS');
const sourceConfig=JSON.parse(await run([...compose,'config','--format','json'],'SOURCE_CONFIG'));
await census('BEFORE_EXISTING_CONFIG_PS');
const actualConfig=JSON.parse(await run(['compose','--project-name','sabalanerp-local','-f',actualFile,'config','--format','json'],'EXISTING_CONFIG'));
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hashObject=v=>sha(JSON.stringify(canonical(v)));
const equal=hashObject(sourceConfig.services.postgres)===hashObject(actualConfig.services.postgres);
const final=await census('FINAL_PS');
assert.deepEqual(final,initial);
const result={format:'sabalan-ticket416-readonly-native-preflight/v1',observedAt:new Date().toISOString(),head:'ee38ae143abb89337e7324454954f5263ea40d4e',
 scope:'Read-only native process observations; not actual wrapper/PostgreSQL fault acceptance',
 project:'sabalanerp-local',services:final,actualComposeFile:actualFile,implementationComposeFile:path.join(root,'docker-compose.local.yml'),
 postgresEffectiveConfigEquivalentNow:equal,sourcePostgresConfigSha256:hashObject(sourceConfig.services.postgres),actualPostgresConfigSha256:hashObject(actualConfig.services.postgres),restartPolicy:actualConfig.services.postgres.restart,
 sourceComposeSha256:sha(fs.readFileSync(path.join(root,'docker-compose.local.yml'))),actualComposeSha256:sha(fs.readFileSync(actualFile)),
 finiteChildren:rows.map(({originalPid,phase,code,signal,stdoutEof,stderrEof,observationFault})=>({originalPid,phase,code,signal,stdoutEof,stderrEof,observationFault})),
 requiredNativeLeaseAcquired:false,coordinatorPortsIntegrated:false,wrapperFaultProofsRun:false,postgresStopped:false,originalsRemaining:[],push:false,physicalReplayQualified:false,productionAdmission:false};
fs.writeFileSync(path.join(out,'PREFLIGHT.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({preflight:path.join(out,'PREFLIGHT.json'),services:final.length,allHealthy:true,postgresEffectiveConfigEquivalentNow:equal,finiteChildren:rows.length,allChildrenClosed:true,wrapperAcceptance:false,postgresStopped:false}));
