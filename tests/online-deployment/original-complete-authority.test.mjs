import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module,{createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {completeFixture,raw} from './original-complete-integration.fixture.mjs';
import {completeOwnedBytes as ref} from '../../scripts/lib/original-complete-join.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),require=createRequire(import.meta.url),esbuild=require('../../backend/node_modules/esbuild');
const python=path.resolve('C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe');
async function setup({badAck=false}={}){
 const f=await completeFixture(),root=fs.mkdtempSync(path.join(os.tmpdir(),'complete-authority-')),audit=path.join(root,'audit');
 const files={worker:path.join(root,'worker-source.cjs'),controller:path.join(root,'controller-source.mjs'),callback:path.join(root,'callback-source.mjs'),owner:path.join(root,'owner.py')};
 for(const role of ['worker','controller','callback'])fs.writeFileSync(files[role],'// source-owned modeled '+role+'\n');
 const pin=file=>({file,sha256:sha(fs.readFileSync(file))});
 const w=JSON.parse(Buffer.from(f.capture.workerOriginal.rawBase64,'base64'));
 w.workerSourceSha256=pin(files.worker).sha256;w.controllerSourceSha256=pin(files.controller).sha256;
 f.capture.workerOriginal=ref(raw(w));f.result.protectedFinancialQualification.binding.workerSourceSha256=w.workerSourceSha256;f.result.protectedFinancialQualification.binding.controllerSourceSha256=w.controllerSourceSha256;
 if(badAck)f.capture.ack.callbackDrained=false;
 const py=`import json,sys,pathlib,hashlib,datetime\nroot=pathlib.Path(${JSON.stringify(audit)})\nop=${JSON.stringify(f.identity.operation)}\nprint(json.dumps(dict(format='sabalan-r9-master-private-credential-ready/v1',operation=op,credentialsRead=False,productionAdmission=False)),flush=True)\nframe=json.loads(sys.stdin.buffer.read());assert frame['operation']==op and frame['credential']=='unit-ephemeral-input'\nroot.mkdir()\ncapture=json.loads(${JSON.stringify(JSON.stringify(f.capture))})\ncapture['workerClosedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()\ncapture['capturedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()\nresult=json.loads(${JSON.stringify(JSON.stringify(f.result))})\ncapture_raw=(json.dumps(capture,separators=(',',':'))+'\\n').encode()\ncapture_file=root/'complete-capture.json';capture_file.write_bytes(capture_raw)\nresult['completeCapture']=dict(file=str(capture_file),sha256=hashlib.sha256(capture_raw).hexdigest())\nresult['cleanupStartedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()\nresult_raw=(json.dumps(result,separators=(',',':'))+'\\n').encode();result_file=root/'owner-result.json';result_file.write_bytes(result_raw)\nprint(json.dumps(dict(file=str(result_file),sha256=hashlib.sha256(result_raw).hexdigest(),strictCompleteValidationSucceeded=True,outerOriginalClosurePending=True,productionAdmission=False)),flush=True)\n`;
 fs.writeFileSync(files.owner,py);
 const config={format:'sabalan-original-existing-compose-complete-input/v1',productionAdmission:false,project:'sabalanerp-local',
  operation:f.identity.operation,targetCommit:f.identity.sourceCommit,sources:Object.fromEntries(Object.entries(files).map(([role,file])=>[role,pin(file)])),python:pin(python),auditDirectory:audit};
 const configurationFile=path.join(root,'configuration.json');fs.writeFileSync(configurationFile,raw(config));
 const selected={...config,configuration:pin(configurationFile)},localToken={};
 const file=path.resolve('scripts/lib/original-existing-compose-complete.mjs'),m=new Module(file);m.filename=file;
 const nativeRequire=createRequire(file);m.require=id=>({
  './application-native-role-coordinator.mjs':{readOriginalRoleQualificationCompletion:t=>{assert.equal(t,localToken);return{originalControllers:[{code:0,signal:null}]};}},
  './original-online-evidence-reader.mjs':{originalOnlineEvidenceReader:()=>f.k},
  './original-complete-source-binding.mjs':{readSourceOwnedCompleteBinding:()=>({value:selected,revalidate:()=>{assert.equal(pin(configurationFile).sha256,selected.configuration.sha256);}})},
 }[id]??nativeRequire(id));
 m._compile(esbuild.transformSync(fs.readFileSync(file,'utf8'),{format:'cjs',target:'node22'}).code,file);
 return {root,audit,config,selected,localToken,configurationFile,configurationSha256:selected.configuration.sha256,...m.exports};
}
test('same finite original plus canonical join earns a distinct private token; JSON/clone and later changed output refuse',async()=>{
 const f=await setup();try{
  const token=await f.runOriginalExistingComposeComplete({...f,localCompletion:f.localToken,acquireCredential:async()=> 'unit-ephemeral-input'});
  assert.equal(f.isOriginalExistingComposeComplete(token),true);const record=f.readOriginalExistingComposeComplete(token);
  assert.equal(record.format,'sabalan-original-existing-compose-complete/v1');assert.equal(record.outerOriginalClosurePending,false);
  for(const fake of [record,{},structuredClone(token)])assert.throws(()=>f.readOriginalExistingComposeComplete(fake),/COMPOSE_COMPLETE_REQUIRED/);
  fs.appendFileSync(path.join(f.audit,'complete-capture.json'),' ');assert.throws(()=>f.readOriginalExistingComposeComplete(token));
 }finally{assert.equal(fs.realpathSync(f.root),path.resolve(f.root));fs.rmSync(f.root,{recursive:true,force:true});}
});
test('negative ACK and replacement configuration never earn COMPLETE authority',async()=>{
 for(const badAck of [true,false]){const f=await setup({badAck});try{
  if(!badAck)fs.appendFileSync(f.configurationFile,' ');
  let acquired=0;await assert.rejects(f.runOriginalExistingComposeComplete({...f,localCompletion:f.localToken,acquireCredential:async()=>{acquired++;return 'unit-ephemeral-input';}}));
  assert.equal(acquired,badAck?1:0);
 }finally{assert.equal(fs.realpathSync(f.root),path.resolve(f.root));fs.rmSync(f.root,{recursive:true,force:true});}}
});
