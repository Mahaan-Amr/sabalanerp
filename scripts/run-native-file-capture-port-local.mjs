import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {createRequire} from 'node:module';

const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),esbuild=require('../backend/node_modules/esbuild');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function inspect(){
  const raw=execFileSync('docker',['compose','-f','D:/sabalanerp/docker-compose.local.yml','ps','--format','json'],{encoding:'utf8'});
  let rows;try{const parsed=JSON.parse(raw);rows=Array.isArray(parsed)?parsed:[parsed];}catch{rows=raw.trim().split(/\r?\n/).map(line=>JSON.parse(line));}
  const services=['backend','frontend','postgres','inquiry','backend-candidate','backend-retained'];
  const names=services.map(service=>{const row=rows.find(row=>row.Project==='sabalanerp-local'&&row.Service===service&&row.State==='running'&&row.Health==='healthy');assert.ok(row,service);return row.Name;});
  const values=JSON.parse(execFileSync('docker',['inspect',...names],{encoding:'utf8'}));
  assert.ok(values.every(value=>value.Config.Labels['com.docker.compose.project']==='sabalanerp-local'));
  const candidate=values.find(value=>value.Config.Labels['com.docker.compose.service']==='backend-candidate');
  assert.ok(candidate.Config.Env.includes('BACKEND_RUNTIME_ROLE=candidate'));
  assert.ok(candidate.Mounts.some(mount=>mount.Type==='volume'&&mount.RW&&mount.Name==='sabalanerp-local_online_runtime_acceptance'
    &&mount.Destination==='/app/online-runtime-acceptance'));
  return Object.fromEntries(values.map(value=>[value.Config.Labels['com.docker.compose.service'],
    {id:value.Id,image:value.Image,startedAt:value.State.StartedAt}]));
}
const before=inspect(),sources={};
const capture=name=>{const bytes=fs.readFileSync(path.join(root,name));sources[name]=sha(bytes);return bytes;};
capture('scripts/run-native-file-capture-port-local.mjs');
const bundled=await esbuild.build({absWorkingDir:root,entryPoints:['backend/src/services/__tests__/nativeFileCapturePort.test.ts'],
  bundle:true,platform:'node',packages:'external',format:'cjs',target:'node22',write:false,
  plugins:[{name:'capture-inputs',setup(build){build.onLoad({filter:/.*/,namespace:'file'},args=>{
    const name=path.relative(root,args.path).split(path.sep).join('/');assert.ok(!name.startsWith('../'));
    return {contents:capture(name),loader:path.extname(name).slice(1),resolveDir:path.dirname(args.path)};
  });}}]});
const files={'port.test.cjs':Buffer.from(bundled.outputFiles[0].contents),
  'fixture.py':capture('tests/online-deployment/native-versioned-file-sealer.fixture.py'),
  'census.fixture.py':capture('tests/online-deployment/coherent-census-namespace.fixture.py'),
  'online-backend-boundary.py':capture('deploy/scripts/online-backend-boundary.py'),
  'native-versioned-file-sealer.py':capture('deploy/scripts/native-versioned-file-sealer.py')};
const directory='/app/online-runtime-acceptance/native-file-capture-port-'+randomBytes(16).toString('hex');
const bootstrap=`const fs=require('fs'),path=require('path');process.umask(0o077);const root=${JSON.stringify(directory)};fs.mkdirSync(root,{mode:0o700});
for(const [name,data]of Object.entries(JSON.parse(fs.readFileSync(0,'utf8')))){const file=path.join(root,name);const fd=fs.openSync(file,'wx',0o400);try{fs.writeFileSync(fd,Buffer.from(data,'base64'));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
const fd=fs.openSync(root,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}`;
inspect();execFileSync('docker',['exec','-i',before['backend-candidate'].id,'node','-e',bootstrap],
  {input:JSON.stringify(Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,bytes.toString('base64')])))});
const report={format:'sabalan-native-file-capture-port/v1',pass:false,positiveCaptureProven:false,productionAdmission:false,
  workingRoot:directory,before,sources,bundleSha256:sha(files['port.test.cjs'])};
const reportPath=path.join(root,'reports/qa',path.basename(directory)+'.json'),save=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');save();
async function run(args){inspect();return await new Promise((resolve,reject)=>{const child=spawn('docker',['exec',before['backend-candidate'].id,...args],{stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',bytes=>{stdout+=bytes;});child.stderr.on('data',bytes=>{stderr+=bytes;});child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal,stdout,stderr}));});}
report.port=await run(['node','--test',directory+'/port.test.cjs']);save();
report.program=await run(['python3','-I','-B',directory+'/fixture.py',directory]);save();
report.census=await run(['python3','-I','-B',directory+'/census.fixture.py',directory]);save();
assert.deepEqual(inspect(),before);report.identitiesUnchanged=true;
for(const[name,expected]of Object.entries(sources))assert.equal(sha(fs.readFileSync(path.join(root,name))),expected,name);
report.sourcesUnchanged=true;
report.pass=report.port.code===0&&report.port.signal===null&&/# tests 2\r?\n/.test(report.port.stdout)
  &&/# fail 0\r?\n/.test(report.port.stdout)&&report.program.code===0&&report.program.signal===null
  &&/Ran 8 tests/.test(report.program.stderr)&&/\nOK\s*$/.test(report.program.stderr)
  &&report.census.code===0&&report.census.signal===null&&/Ran 4 tests/.test(report.census.stderr)&&/\nOK\s*$/.test(report.census.stderr);save();
console.log(JSON.stringify({pass:report.pass,reportPath}));assert.equal(report.pass,true);
