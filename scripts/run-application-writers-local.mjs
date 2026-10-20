import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';import {createRequire} from 'node:module';import {execFileSync,spawn} from 'node:child_process';
import {collectApplicationPrismaArtifacts} from './lib/application-native-prisma-artifacts.mjs';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),esbuild=require('../backend/node_modules/esbuild');
const selected=process.argv.find(v=>v.startsWith('--case='))?.slice(7);
assert.ok(['digest-support','performance-rollback','performance-all','all-writers'].includes(selected));
const sha=b=>createHash('sha256').update(b).digest('hex'),sources={};
const capture=n=>{const b=fs.readFileSync(path.join(root,n));if(sources[n])assert.equal(sources[n],sha(b));sources[n]=sha(b);return b;};
function inspect(){const raw=execFileSync('docker',['compose','-f','D:/sabalanerp/docker-compose.local.yml','ps','--format','json'],{encoding:'utf8'});let rows;
 try{const value=JSON.parse(raw);rows=Array.isArray(value)?value:[value];}catch{rows=raw.trim().split(/\r?\n/).map(JSON.parse);}
 const names=['backend','frontend','postgres','inquiry','backend-candidate','backend-retained'].map(service=>{const r=rows.find(v=>v.Service===service);assert.ok(r?.Project==='sabalanerp-local'&&r.State==='running'&&r.Health==='healthy');return r.Name;});
 return JSON.parse(execFileSync('docker',['inspect',...names],{encoding:'utf8'}));}
const identity=values=>Object.fromEntries(values.map(v=>[v.Config.Labels['com.docker.compose.service'],{id:v.Id,image:v.Image,startedAt:v.State.StartedAt}]));
const before=inspect(),candidate=before.find(v=>v.Config.Labels['com.docker.compose.service']==='backend-candidate'),retained=before.find(v=>v.Config.Labels['com.docker.compose.service']==='backend-retained');
capture('scripts/run-application-writers-local.mjs');
const plugin={name:'captured-writer-inputs',setup(build){build.onLoad({filter:/.*/,namespace:'file'},args=>{const n=path.relative(root,args.path).split(path.sep).join('/');assert.ok(!n.startsWith('../')&&!path.isAbsolute(n));
 return {contents:capture(n),loader:{'.ts':'ts','.js':'js','.mjs':'js','.json':'json'}[path.extname(n)],resolveDir:path.dirname(args.path)};});}};
const options={absWorkingDir:root,bundle:true,platform:'node',packages:'external',format:'cjs',target:'node22',write:false,logLevel:'silent',plugins:[plugin]};
const built=await esbuild.build({...options,entryPoints:['tests/online-deployment/application-native-writers.worker.ts']});
// One physical module graph: helpers and genuine contexts/registries must never
// acquire duplicate bundle-local singleton or instanceof identities.
const files={'application-writers.cjs':Buffer.from(built.outputFiles[0].contents)};
Object.assign(files,collectApplicationPrismaArtifacts({repositoryRoot:root,captureSource:capture}));
for(const n of ['backend-runtime-owner.py','online-runtime-owner.py','online-runtime-scope.py','online-capture-admission.py'])files[n]=capture('deploy/scripts/'+n);
files['fixture.py']=capture('tests/online-deployment/application-native.fixture.py');
files['hr-file-expansion.sql']=capture('backend/prisma/migrations/20261019020000_hr_versioned_file_cleanup/migration.sql');
const assets=['brand/sabalan-logo.jpg','yekan-bakh/YekanBakh-Regular.woff2','yekan-bakh/YekanBakh-SemiBold.woff2','yekan-bakh/YekanBakh-Bold.woff2'];
files['print-assets.json']=Buffer.from(JSON.stringify(assets.map((target,i)=>{const b=capture('backend/public/'+target),file='print-asset-'+i;files[file]=b;return{target,file,sha256:sha(b),bytes:b.length};}))+'\n');
const receipt=capture('reports/qa/application-prisma-615024e205e40ee7182d46599f73f778.json'),qualified=JSON.parse(receipt);assert.equal(qualified.pass,true);
assert.equal(qualified.result.generated.schemaSha256,sha(capture('backend/prisma/schema.prisma')));inspect();
const proof=execFileSync('docker',['exec',candidate.Id,'cat',qualified.directory+'/generated-prisma-proof.json']);assert.deepEqual(JSON.parse(proof),qualified.result.generated);
files['qualified-prisma-receipt.json']=receipt;files['qualified-prisma-capsule.json']=Buffer.from(JSON.stringify({sourceRoot:qualified.directory,receiptSha256:sha(receipt),proofSha256:sha(proof)})+'\n');
files['config.json']=Buffer.from(JSON.stringify({sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),image:retained.Image,
  bundleSha256:sha(files['application-writers.cjs']),selected})+'\n');
const operation=randomBytes(16).toString('hex'),directory='/app/online-runtime-acceptance/application-native-'+operation;
const stage=`const fs=require('fs'),path=require('path');process.umask(0o077);const root=${JSON.stringify(directory)};fs.mkdirSync(root,{mode:0o700});for(const[n,v]of Object.entries(JSON.parse(fs.readFileSync(0,'utf8')))){if(path.basename(n)!==n)throw Error('UNSAFE_FILE');const fd=fs.openSync(path.join(root,n),'wx',0o400);try{fs.writeFileSync(fd,Buffer.from(v,'base64'));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}const fd=fs.openSync(root,'r');fs.fsyncSync(fd);fs.closeSync(fd);`;
inspect();execFileSync('docker',['exec','-i',candidate.Id,'node','-e',stage],{input:JSON.stringify(Object.fromEntries(Object.entries(files).map(([n,b])=>[n,b.toString('base64')])))});
const report={format:'sabalan-application-writers-local/v1',operation,selected,directory,before:identity(before),sources,pass:false,productionAdmission:false};
const reportPath=path.join(root,'reports/qa','application-writers-'+operation+'.json'),save=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');save();
async function run(container,mode){inspect();return new Promise((resolve,reject)=>{const p=spawn('docker',['exec','--env','APPLICATION_NATIVE_WRITER_CASE='+selected,container.Id,'python3','-I','-B',directory+'/fixture.py',directory,mode],{stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.on('error',reject);p.on('close',(code,signal)=>resolve({code,signal,stdout,stderr}));});}
report.prepare=await run(candidate,'prepare');save();assert.equal(report.prepare.code,0);
report.execution=await run(retained,'exercise-writers');save();
assert.deepEqual(identity(inspect()),report.before);report.identitiesUnchanged=true;
for(const[n,h]of Object.entries(sources))assert.equal(sha(fs.readFileSync(path.join(root,n))),h,n);report.sourcesUnchanged=true;save();
if(report.execution.stdout.trim()){report.result=JSON.parse(report.execution.stdout);save();}
assert.equal(report.execution.signal,null);assert.equal(report.execution.code,0);assert.equal(report.result.passResult,true);report.pass=true;save();console.log(JSON.stringify({pass:true,reportPath}));
