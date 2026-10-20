/** Transport/codec qualification only: deliberately NOT a checkpoint producer. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {originalBackendBaseCommands} from './lib/production-backend-base-process.mjs';
import {createOriginalLocalCheckpointCrypto,readOriginalLocalCheckpointCryptoCompletion} from './lib/original-local-checkpoint-crypto.mjs';
const nonce=randomBytes(16).toString('hex'),operation=randomBytes(32).toString('hex');
const scratch=path.join('D:/sabalanerp-online-qa','checkpoint-crypto-content-'+nonce);fs.mkdirSync(scratch,{mode:0o700});
const directory='/app/online-runtime-acceptance/application-native-'+nonce,base='D:/sabalanerp/docker-compose.local.yml';
const owner=originalBackendBaseCommands(),sha=raw=>createHash('sha256').update(raw).digest('hex');
const parse=raw=>{try{const v=JSON.parse(raw);return Array.isArray(v)?v:[v];}catch{return raw.trim().split(/\r?\n/).map(JSON.parse);}};
const names=['backend','frontend','postgres','inquiry','redis','clamav','backend-candidate','backend-retained','frontend-candidate','frontend-retained'].sort();
const template='{"id":{{json .Id}},"image":{{json .Image}},"startedAt":{{json .State.StartedAt}},"running":{{json .State.Running}},"health":{{if (index .State "Health")}}{{json .State.Health.Status}}{{else}}null{{end}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"project":{{json (index .Config.Labels "com.docker.compose.project")}}}';
const commands=[];
async function run(args,input){const result=await owner.run('docker',args,{input,maximum:1024*1024});commands.push({...result,args});owner.assertSuccessful(result);return result.stdout;}
async function inspect(){const rows=parse(await run(['compose','-f',base,'ps','--all','--format','json']));assert.equal(rows.length,10);assert.deepEqual(rows.map(row=>row.Service).sort(),names);for(const row of rows)assert.equal(row.Project,'sabalanerp-local');const actual=parse(await run(['inspect','--format',template,...rows.map(row=>row.ID??row.Name)]));assert.equal(actual.length,10);for(const row of actual){assert.equal(row.project,'sabalanerp-local');assert.equal(row.running,true);assert.equal(row.health,'healthy');}return actual.sort((a,b)=>a.service.localeCompare(b.service));}
const before=await inspect(),main=before.find(row=>row.service==='backend-retained'),candidate=before.find(row=>row.service==='backend-candidate');
const topology={main:{containerId:main.id,image:main.image},candidate:{containerId:candidate.id,image:candidate.image}};
const report={format:'sabalan-local-crypto-content-qualification/v1',operation,pass:false,scope:'CONTENT_TRANSPORT_ONLY',genuineCheckpointCreated:false,captureAuthorityGranted:false,sqlConnected:false,runtimeStarted:false,productionAdmission:false,before,commands};let executor,failure;
try{
 const roles=['physical-base','coherent-cut','coverage-manifest','inquiry-sqlite','coordination','wal-capture',...Array(9).fill('versioned-file-cut'),'wal-segment'];
 const sources=roles.map((role,index)=>{const raw=Buffer.from('CONTENT TRANSPORT ONLY '+nonce+' '+index+'\n');return{role,name:'test-'+index,path:directory+'/content-'+index,bytes:raw.length,sha256:sha(raw),rawBase64:raw.toString('base64')};});
 const manifest={format:'sabalan-online-checkpoint-plaintext-components/v1',operation,coverageSha256:sources.find(row=>row.role==='coverage-manifest').sha256,sourceCaptureSha256:sources.find(row=>row.role==='coherent-cut').sha256,sources:sources.map(({rawBase64,...row})=>row)};
 const manifestRaw=Buffer.from(JSON.stringify(manifest)+'\n');
 const seed={directory,sources,manifestRawBase64:manifestRaw.toString('base64')};
 const script=`import os,sys,json,base64,hashlib
v=json.load(sys.stdin);root=v['directory'];os.mkdir(root,0o700)
for row in v['sources']:
 raw=base64.b64decode(row['rawBase64'],validate=True);assert len(raw)==row['bytes'] and hashlib.sha256(raw).hexdigest()==row['sha256']
 fd=os.open(row['path'],os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)
 with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
fd=os.open(root+'/plaintext-components.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)
with os.fdopen(fd,'wb') as f:f.write(base64.b64decode(v['manifestRawBase64'],validate=True));f.flush();os.fsync(f.fileno())
print('CONTENT_ONLY_SOURCES_CREATED')`;
 assert.deepEqual(await inspect(),before);assert.equal((await run(['exec','-i',main.id,'python3','-I','-B','-c',script],JSON.stringify(seed))).trim(),'CONTENT_ONLY_SOURCES_CREATED');
 executor=await createOriginalLocalCheckpointCrypto({directory,topology,scratch});
 await assert.rejects(executor.seal({componentManifestFile:directory+'/plaintext-components.json',componentManifestSha256:'0'.repeat(64)}));
 const token=await executor.seal({componentManifestFile:directory+'/plaintext-components.json',componentManifestSha256:sha(manifestRaw)});
 const actual=await readOriginalLocalCheckpointCryptoCompletion(token);assert.equal(actual.result.objects.length,16);assert.equal(actual.result.healthyRecoveryPoint,false);assert.equal(actual.result.productionAdmission,false);assert.equal(actual.result.independentDecryptVerified,false);for(const row of actual.result.objects)assert.equal(row.localDecryptVerified,true);
 report.result={receiptFile:actual.receiptFile,receiptSha256:actual.receiptSha256,runtimeReceipt:actual.runtimeReceipt,objects:actual.result.objects.length,canonicalCrypto:actual.canonicalCrypto,mapping:actual.mapping};
 report.executorClosure=await executor.close();executor=null;report.pass=true;
}catch(error){failure=error;report.failure={name:error.name,message:error.message};}
finally{
 if(executor){try{report.executorClosure=await executor.close();}catch(error){failure??=error;report.executorFailure=error.message;}}
 try{report.after=await inspect();assert.deepEqual(report.after,before);}catch(error){failure??=error;report.finalFailure=error.message;}
 report.originalClosure=await owner.close();report.pass=report.pass&&!failure;fs.writeFileSync(path.join(scratch,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
}
process.stdout.write(JSON.stringify({pass:report.pass,reportFile:path.join(scratch,'receipt.json'),scope:report.scope,objects:report.result?.objects,originalClosure:report.originalClosure,executorClosure:report.executorClosure,failure:report.failure})+'\n');if(!report.pass)process.exitCode=1;
