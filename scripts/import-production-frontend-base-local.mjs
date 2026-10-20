import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {imageInspectionIdentity} from './lib/image-inspection-identity.mjs';
import {qualifiedProductionFrontendArchive,stableFrontendBaseFile} from './lib/production-frontend-base-artifacts.mjs';

const repository=path.resolve(import.meta.dirname,'..'), mode=process.argv[2]??'--inspect';
assert.ok(process.argv.length<=3 && ['--inspect','--load','--qualify-source-index'].includes(mode));
const source=qualifiedProductionFrontendArchive(repository);
if(mode==='--inspect') console.log(JSON.stringify({source,dockerExecuted:false,productionAdmission:false}));
else {
  const operation=randomBytes(16).toString('hex'), root=path.resolve('D:/sabalanerp-online-qa/production-frontend-base-local-'+operation);
  const evidence=path.join(repository,'reports/qa/production-frontend-base-local-'+operation);
  fs.mkdirSync(root,{mode:0o700});
  const report={format:'sabalan-production-frontend-base-local/v1',operation,phase:'INTENT',pass:false,source,
    root,productionAdmission:false,serviceStarted:false,helperFile:stableFrontendBaseFile(import.meta.filename)};
  const publish=(suffix,value)=>{const fd=fs.openSync(evidence+suffix+'.json','wx',0o600);
    try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
  publish('-intent',report);
  const services=['backend','frontend','postgres','inquiry','backend-candidate','backend-retained','frontend-candidate','frontend-retained'];
  const compose=['compose','-f','D:/sabalanerp/docker-compose.local.yml'];
  function status(){const r=spawnSync('docker',[...compose,'ps','--format','json'],{encoding:'utf8',maxBuffer:8*1024**2});
    assert.equal(r.status,0);let rows;try{const p=JSON.parse(r.stdout);rows=Array.isArray(p)?p:[p];}
    catch{rows=r.stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line));}
    for(const service of services)assert.ok(rows.some(row=>row.Project==='sabalanerp-local'&&row.Service===service&&row.State==='running'&&row.Health==='healthy'));
    return rows;}
  function docker(args){status();const r=spawnSync('docker',args,{encoding:'utf8',maxBuffer:8*1024**2});assert.equal(r.status,0);return r.stdout;}
  function protectedIdentities(){const rows=status();return Object.fromEntries(services.map(service=>{
    const row=JSON.parse(docker(['inspect','--format','{"id":{{json .Id}},"image":{{json .Image}},"startedAt":{{json .State.StartedAt}},"service":{{json (index .Config.Labels "com.docker.compose.service")}}}',rows.find(v=>v.Service===service).Name]));
    assert.equal(row.service,service);return[service,row];}));}
  let failure;
  try {
    report.servicesBefore=protectedIdentities();
    if(mode==='--qualify-source-index'){
      const name='production-frontend-base-local-bee8adabf607c7e5eba735f328612750.json';
      const file=path.join(repository,'reports/qa',name), receiptFile=stableFrontendBaseFile(file,4*1024**2);
      const prior=JSON.parse(fs.readFileSync(file));
      assert.equal(prior.phase,'FAILED_HELD');assert.equal(prior.pass,false);assert.equal(prior.image,undefined);
      assert.equal(prior.load.code,0);assert.equal(prior.load.signal,null);assert.equal(prior.load.naturalChildClosure,true);
      assert.equal(prior.protectedServicesUnchanged,true);assert.deepEqual(prior.source,source);
      assert.deepEqual(prior.servicesAfter,prior.servicesBefore);
      assert.deepEqual(stableFrontendBaseFile(prior.load.stdoutPath,16*1024**2),prior.load.stdoutFile);
      assert.deepEqual(stableFrontendBaseFile(prior.load.stderrPath,16*1024**2),prior.load.stderrFile);
      Object.assign(report,{format:'sabalan-production-frontend-engine-base-local/v1',load:prior.load,
        originalFailedImportReceipt:name,originalFailedImportReceiptFile:receiptFile,
        originalRequestedConfigIdentityFailed:true,sourceConfigIdentity:source.configIdentity,
        engineImageIdentity:source.sourceIndex,noNewLoadExecuted:true});
    }else{
    const stdoutPath=path.join(root,'load.stdout'),stderrPath=path.join(root,'load.stderr');
    const out=fs.openSync(stdoutPath,'wx',0o600),err=fs.openSync(stderrPath,'wx',0o600);let load;
    try{status();load=await new Promise(resolve=>{const child=spawn('docker',['load','--input',source.archive],{stdio:['ignore',out,err]});
      let spawnError;child.once('error',e=>{spawnError=e.code??'LOAD_SPAWN_FAILED';});
      child.once('close',(code,signal)=>resolve({code,signal,spawnError,naturalChildClosure:typeof code==='number'&&signal===null}));});}
    finally{fs.fsyncSync(out);fs.fsyncSync(err);fs.closeSync(out);fs.closeSync(err);}
    report.load={...load,stdoutPath,stderrPath,stdoutFile:stableFrontendBaseFile(stdoutPath,16*1024**2),stderrFile:stableFrontendBaseFile(stderrPath,16*1024**2)};
    publish('-load-result',report.load);
    }
    assert.deepEqual(qualifiedProductionFrontendArchive(repository),source);
    report.servicesAfter=protectedIdentities();assert.deepEqual(report.servicesAfter,report.servicesBefore);
    report.protectedServicesUnchanged=true;
    assert.equal(report.load.code,0);assert.equal(report.load.signal,null);assert.equal(report.load.spawnError,undefined);
    const expectedImage=mode==='--qualify-source-index'?source.sourceIndex:source.configIdentity;
    report.image=imageInspectionIdentity(JSON.parse(docker(['image','inspect',expectedImage])));
    assert.equal(report.image.id,expectedImage);assert.deepEqual(report.image.layers,source.layers);
    assert.deepEqual(Object.keys(report.image.volumes??{}),[]);
    assert.deepEqual(stableFrontendBaseFile(import.meta.filename),report.helperFile);
    Object.assign(report,{phase:'COMPLETE',pass:true});
  }catch(error){failure=error;Object.assign(report,{phase:'FAILED_HELD',pass:false,error:error instanceof Error?error.message:'BASE_IMPORT_FAILED'});}
  publish('',report);console.log(JSON.stringify({evidence:evidence+'.json',phase:report.phase,pass:report.pass,image:report.image?.id??null,productionAdmission:false}));
  if(failure)throw failure;
}
