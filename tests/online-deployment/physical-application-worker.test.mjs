import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {physicalFixture,owned} from './same-compose-physical.fixture.mjs';
import Module,{createRequire} from 'node:module';import {sha} from './independent-components-evidence.fixture.mjs';
import {isClosedSerialNegative} from '../../scripts/lib/serial-physical/retained-child.mjs';
import {pathToFileURL} from 'node:url';
import {applicationFixture} from './same-compose-applications.fixture.mjs';
const reference=file=>({file,sha256:sha(fs.readFileSync(file))});
function workerModel(custody,directory){
 const file=path.resolve('scripts/lib/original-physical-application-worker.mjs'),m=new Module(file),require=createRequire(file);
 m.filename=file;m.require=id=>id==='./original-private-evidence-directory.mjs'?{assertOriginalPrivateEvidenceDirectory:(token,dir)=>{assert.equal(token,custody);assert.equal(dir,directory);}}:require(id);
 const esbuild=require('../../backend/node_modules/esbuild');m._compile(esbuild.transformSync(fs.readFileSync(file,'utf8').replaceAll('import.meta.url',JSON.stringify(pathToFileURL(file).href)),{format:'cjs',target:'node22'}).code,file);return m.exports;
}
test('production launcher selects fixed source producer and collector retains its actual finite child over model resource ports',async()=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'source418-fixed-')),directory=path.join(parent,'private');fs.mkdirSync(directory);
 const f=applicationFixture(parent),custody={},api=workerModel(custody,directory),configuration=path.join(parent,'binding.json');
 const binding=reference(fs.realpathSync('tests/online-deployment/same-compose-applications.fixture.mjs'));
 fs.writeFileSync(configuration,JSON.stringify({format:'sabalan-physical-applications-worker-binding/v1',binding,resources:{directory:parent},input:f.input}));
 const prepared={entry:reference(fs.realpathSync('scripts/run-same-compose-physical-applications.mjs')),configuration:reference(configuration),executable:reference(process.execPath),
  sourceFiles:['scripts/lib/same-compose-physical-applications.mjs','scripts/lib/restored-qa/application-lifecycle.mjs','scripts/lib/restored-qa/inquiry-carrier-observation.mjs',binding.file].map(file=>reference(fs.realpathSync(file))),
  assertActive:()=>true,assertDrained:()=>true,evidence:{custody,directory}};
 const material={materialFacts:Object.fromEntries([['captured','coherent-cut'],['coverage','coverage-manifest'],['walClosure','wal-capture']].map(([key,role])=>[role,f.input.ownedInputs[key]]))};
 const token=await api.runOriginalSameComposeApplicationWorker({prepared,plan:{operation:f.input.operation,canonicalReplay:f.input.canonicalReplay},replay:f.input.replay,material});
 const result=api.readOriginalPhysicalApplicationWorker(token),report=JSON.parse(Buffer.from(result.ownedOutputs.report.rawBase64,'base64'));
 assert.equal(report.lifecycle.probe.businessVerified,true);assert.equal(result.originalControllers[0].code,0);assert.equal(result.originalControllers[0].stdoutEof,true);
 assert.equal(result.nativeClosures.length,3);assert.equal(report.restoredIncarnation,undefined);
 await assert.rejects(api.runOriginalSameComposeApplicationWorker({prepared:{...prepared,entry:binding},plan:{operation:f.input.operation,canonicalReplay:f.input.canonicalReplay},replay:f.input.replay,material}));
});
test('finite model application worker owns actual zero exit, both EOFs and drained callbacks; JSON and changed source refuse',async()=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'source418-app-')),input=physicalFixture(parent),directory=path.join(parent,'private');
 fs.mkdirSync(directory);const custody={modeledPrivateDirectory:true};
 const {compileOriginalPhysicalApplicationLaunch,retainOriginalPhysicalApplicationWorker,readOriginalPhysicalApplicationWorker}=workerModel(custody,directory);
 const entry=path.join(parent,'model-worker.mjs'),configuration=path.join(parent,'input.json');
 fs.writeFileSync(entry,"import fs from 'node:fs';process.stdout.write(fs.readFileSync(process.argv[2]));");
 fs.writeFileSync(configuration,JSON.stringify({format:'sabalan-original-physical-applications-output/v1',operation:input.plan.operation,applicationResult:input.app,productionAdmission:false}));
 const launch=compileOriginalPhysicalApplicationLaunch({entry:reference(entry),configuration:reference(configuration),executable:reference(process.execPath)});
 let drains=0;const token=await retainOriginalPhysicalApplicationWorker({launch,operation:input.plan.operation,assertActive:()=>true,assertDrained:()=>{drains++;return true;},evidence:{custody,directory}});
 const result=readOriginalPhysicalApplicationWorker(token),row=result.originalControllers[0];
 assert.ok(row.pid>1);assert.equal(row.code,0);assert.equal(row.stdoutEof,true);assert.equal(row.stderrEof,true);assert.equal(drains,1);
 assert.ok(fs.existsSync(path.join(directory,input.plan.operation+'-physical-applications.receipt')));
 assert.throws(()=>readOriginalPhysicalApplicationWorker(result),/ORIGINAL_PHYSICAL_APPLICATION_WORKER_REQUIRED/);
 await assert.rejects(retainOriginalPhysicalApplicationWorker({launch,operation:input.plan.operation}),/ORIGINAL_PHYSICAL_APPLICATION_LAUNCH_REQUIRED/);
 fs.appendFileSync(configuration,' ');assert.throws(()=>readOriginalPhysicalApplicationWorker(token));
});
test('actual exit-7 application original cannot finish until callbacks drain; durable closed negative remains eligible for restoration',async()=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'source418-negative-')),directory=path.join(parent,'private');fs.mkdirSync(directory);
 const custody={},api=workerModel(custody,directory),entry=path.join(parent,'negative.mjs'),configuration=path.join(parent,'input.json');
 fs.writeFileSync(entry,'process.exitCode=7;');fs.writeFileSync(configuration,'{}');
 const launch=api.compileOriginalPhysicalApplicationLaunch({entry:reference(entry),configuration:reference(configuration),executable:reference(process.execPath)});
 let release,observed,settled=false;const draining=new Promise(resolve=>{release=resolve;}),reached=new Promise(resolve=>{observed=resolve;});
 const original=api.retainOriginalPhysicalApplicationWorker({launch,operation:'b'.repeat(32),assertActive:()=>true,assertDrained:()=>{observed();return draining;},evidence:{custody,directory}});
 original.then(()=>{settled=true;},()=>{settled=true;});await reached;assert.equal(settled,false);release(true);
 await assert.rejects(original,isClosedSerialNegative);
 const receipt=JSON.parse(fs.readFileSync(path.join(directory,'b'.repeat(32)+'-physical-applications.receipt')));
 assert.equal(receipt.code,7);assert.equal(receipt.stdoutEof,true);assert.equal(receipt.stderrEof,true);assert.equal(receipt.observationFault,false);
});
