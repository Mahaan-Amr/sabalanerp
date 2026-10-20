import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {releaseEnvironmentKeys} from '../../scripts/performance-deployment-environment.mjs';

const repository=fileURLToPath(new URL('../../',import.meta.url));
const shell=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/sh';
const deployment=fs.readFileSync(path.join(repository,'deploy/scripts/deploy.sh'),'utf8');
const exportLine=deployment.indexOf('  existing_exports="$(docker inspect ');
assert.ok(exportLine>0);
const block=deployment.slice(deployment.lastIndexOf('\nif ',exportLine)+1,deployment.indexOf('\nfi',exportLine)+3);
const roles=['backend','frontend','inquiry','nginx','postgres','clamav'];
const images=Object.fromEntries(roles.map((role,index)=>[role,'sha256:'+String(index+1).repeat(64)]));
const identity=Object.fromEntries(releaseEnvironmentKeys.map((key,index)=>[key,key.endsWith('_COMMIT')?'a'.repeat(40):key.endsWith('_IMAGE')?images[key.slice('PERFORMANCE_RELEASE_'.length,-'_IMAGE'.length).toLowerCase()]:String((index%8)+1).repeat(64)]));
const containers=()=>roles.map(role=>({Image:images[role],State:{Running:true,Health:{Status:'healthy'}},Config:{Labels:{'com.docker.compose.project':'sabalanerp','com.docker.compose.service':role},Env:role==='backend'?Object.entries(identity).map(([key,value])=>key+'='+value):[]}}));

function execute(rows,{mode='release',capture='1'}={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'capture-existing-release-'));
 try{
  const input=path.join(directory,'containers.json'),docker=path.join(directory,'inspect.cjs');
  fs.writeFileSync(input,JSON.stringify(rows));
  fs.writeFileSync(docker,"const fs=require('node:fs'),assert=require('node:assert/strict');assert.deepEqual(process.argv.slice(2),['inspect','backend','frontend','inquiry','nginx','postgres','clamav']);process.stdout.write(fs.readFileSync(process.env.INSPECTION_INPUT));");
  const environment={...process.env,DEPLOYMENT_MODE:mode,CAPTURE_ONLY:capture,OPERATIONS_ROOT:repository.replaceAll('\\','/'),NODE_BINARY:process.execPath.replaceAll('\\','/'),INSPECTION_INPUT:input,INSPECTION_PROGRAM:docker.replaceAll('\\','/')};
  for(const key of [...releaseEnvironmentKeys,...roles.map(role=>'DEPLOYMENT_'+role.toUpperCase()+'_IMAGE'),'DEPLOYMENT_TARGET_COMMIT'])delete environment[key];
  const script='set -eu\ncompose(){ test "$1" = ps; test "$2" = -q; printf "%s\\n" "$3"; }\ndocker(){ "$NODE_BINARY" "$INSPECTION_PROGRAM" "$@"; }\n'+block+'\n"$NODE_BINARY" -e \'const keys=JSON.parse(process.argv[1]);console.log(JSON.stringify(Object.fromEntries(keys.map(k=>[k,process.env[k]??null]))));\' '+"'"+JSON.stringify([...releaseEnvironmentKeys,'DEPLOYMENT_TARGET_COMMIT',...roles.map(role=>'DEPLOYMENT_'+role.toUpperCase()+'_IMAGE')])+"'";
  return spawnSync(shell,['-c',script],{cwd:repository,env:environment,encoding:'utf8',timeout:15000});
 }finally{for(const name of fs.readdirSync(directory))fs.unlinkSync(path.join(directory,name));fs.rmdirSync(directory);}
}

test('actual capture shell imports complete running release identity without selecting candidate business images',()=>{
 const result=execute(containers());assert.equal(result.status,0,result.stderr);const exported=JSON.parse(result.stdout);
 for(const [key,value]of Object.entries(identity))assert.equal(exported[key],value);
 assert.equal(exported.DEPLOYMENT_TARGET_COMMIT,identity.PERFORMANCE_RELEASE_COMMIT);
 for(const role of roles)assert.equal(exported['DEPLOYMENT_'+role.toUpperCase()+'_IMAGE'],images[role]);
 const regular=execute(containers(),{capture:'0'});assert.equal(regular.status,0,regular.stderr);assert.ok(Object.values(JSON.parse(regular.stdout)).every(value=>value===null));
 const configuration=execute(containers(),{mode:'configuration',capture:'0'});assert.equal(configuration.status,0,configuration.stderr);assert.deepEqual(JSON.parse(configuration.stdout),exported);
});

test('capture shell refuses incomplete, unhealthy or image-inconsistent original release before exporting identity',()=>{
 const cases=[rows=>rows.pop(),rows=>{rows[3].State.Running=false;},rows=>{rows[4].State.Health.Status='unhealthy';},rows=>{rows[0].Config.Env=rows[0].Config.Env.filter(value=>!value.startsWith('PERFORMANCE_RELEASE_SOURCE_HASH='));},rows=>{rows[1].Image='sha256:'+'f'.repeat(64);},rows=>{rows[0].Config.Env=rows[0].Config.Env.map(value=>value.startsWith('PERFORMANCE_RELEASE_COMMIT=')?'PERFORMANCE_RELEASE_COMMIT=invalid':value);}];
 for(const mutate of cases){const rows=containers();mutate(rows);const result=execute(rows);assert.notEqual(result.status,0);assert.equal(result.stdout,'');}
});
