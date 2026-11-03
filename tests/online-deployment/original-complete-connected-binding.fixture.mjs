/** Connected original-controller system-boundary model. Never native evidence. */
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {prepareOriginalPrivateEvidenceDirectory} from '../../scripts/lib/original-private-evidence-directory.mjs';
import {originalCompleteDirectoryTransport,originalCompleteApplicationExchange} from '../../scripts/lib/original-complete-file-exchange.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function makeBinding(root,mode){
 const f=JSON.parse(fs.readFileSync(path.join(root,'modeled-input.json'))),events=[],directory=path.join(root,'evidence'),custody=await prepareOriginalPrivateEvidenceDirectory(directory);
 const transport=originalCompleteDirectoryTransport(root);let current=true,readers=0,closed=false,authentications=0;
 const assertActive=()=>assert.equal(current,true),appRaw=Buffer.from(f.appRaw,'base64');
 const stdout=[],stderr=[];const save=(name,raw)=>{const file=path.join(directory,name);fs.writeFileSync(file,raw,{flag:'wx',mode:0o400});return{file,sha256:sha(raw)};};
 const binding={operation:f.identity.operation,targetCommit:f.identity.sourceCommit,releaseId:'modeled-only',executable:process.execPath,argv:[path.join(root,'worker.cjs')],environment:process.env,
  authenticate:async()=>{assert.equal(++authentications,1);assertActive();},observeOriginalRaw(stream,raw){(stream==='stdout'?stdout:stderr).push(Buffer.from(raw));},
  persistOriginalChildClosure(row){events.push('worker-closed');const out=Buffer.concat(stdout),err=Buffer.concat(stderr);assert.equal(sha(out),row.stdoutSha256);assert.equal(out.length,row.stdoutBytes);assert.equal(sha(err),row.stderrSha256);save('docker-original.stdout.raw',out);save('docker-original.stderr.raw',err);return save('docker-original-closed.json',Buffer.from(JSON.stringify(row)+'\n'));},
  authorityForOriginalCallback:()=>({modeled:true}),
  financialArtifactsForOriginal(row,closure){assert.deepEqual(JSON.parse(fs.readFileSync(closure.file)),row);assert.equal(path.basename(closure.file),'docker-original-closed.json');assert.equal(sha(fs.readFileSync(path.join(directory,'docker-original.stdout.raw'))),row.stdoutSha256);assert.equal(sha(fs.readFileSync(path.join(directory,'docker-original.stderr.raw'))),row.stderrSha256);events.push('financial-material');const artifact=Buffer.from('modeled-financial-only'),pin=sha(artifact);globalThis.__testMaterialMutation=()=>{artifact[0]^=1;};return{binding:{modeled:true},artifacts:{source:artifact},revalidate(){assertActive();assert.equal(sha(artifact),pin);}};},
  loadPinnedFinancialVerifier:async()=>()=>{events.push('financial-verified');if(mode==='changed-artifact')globalThis.__testMaterialMutation();},
  persistFinancialQualification(raw,b,artifacts){assert.equal(Buffer.isBuffer(artifacts.certificate),true);events.push('financial-persisted');return save('protected-financial.json',raw);},
  complete:{
   bindOriginalInitial:async frame=>assert.equal(typeof frame.passphrase,'string'),
   operation:f.identity.operation,targetCommit:f.identity.sourceCommit,releaseId:'modeled-only',evidenceDirectory:directory,evidenceCustody:custody,workerSourceSha256:'8'.repeat(64),controllerSourceSha256:'9'.repeat(64),
   assertActive,revalidate:assertActive,
   originalObservationPorts:async()=>({inquiry:{async reader(work){events.push('borrow');readers++;try{return await work();}finally{readers--;events.push('release');}},async observeReady(){return{modeled:true};},async stop(){assert.equal(readers,0);events.push('stop');},async awaitRetainedClosure(){events.push('inquiry-closed');},async closedRecords(){const{retirement,...rest}=f.inquiry.evidence;return rest;},async retire(){events.push('retire');},async retirementRecord(){return f.inquiry.evidence.retirement;},observationBinding:()=>f.inquiry.expected},frontend:{async observe(){events.push('frontend');return{original:f.frontend,healthRaw:Buffer.from(f.healthRaw,'base64'),authenticated:true,businessVerified:true,filesVerified:true};}}}),
   async startFixedExchange(observe){const{serveOriginalCompleteFileRequest}=await import('../../scripts/lib/original-complete-file-exchange.mjs');return serveOriginalCompleteFileRequest(transport,observe,assertActive);},
   async captureOriginalApplication(reference,{workerCompletion}){events.push('capture-read');const{captureOriginalCompleteApplication}=await import('../../scripts/lib/original-complete-material-reader.mjs');return captureOriginalCompleteApplication({workerCompletion,operation:f.identity.operation,readOriginalApplication:async()=>appRaw,assertActive});},
   async buildOriginalSeed(raw,{workerCompletion,counterpart,finalized}){assert.ok(raw.equals(appRaw));assert.equal(finalized.protectedFinancialQualification.binding.modeled,true);events.push('seed');return f.seed;},
   async awaitOriginalReaderClosure(){assert.equal(readers,0);assert.equal(closed,false);closed=true;events.push('material-readers-closed');save('connection-events.json',Buffer.from(JSON.stringify(events)+'\n'));if(mode==='close-failure')throw Error('TEST_READER_CLOSE_FAILURE');return{allOriginalChildrenClosed:true,interrupted:mode==='interrupted-reader',failed:false};},
  },
 };
 // Test-only fixed issuer invokes this while the genuine HR ticket is active.
 binding.exercise=async request=>{const{completeCallbackRequest}=await import('../../scripts/lib/original-complete-callback.mjs');const descriptor=completeCallbackRequest({...f.identity,session:request.session},request.manifest);await originalCompleteApplicationExchange(transport)({descriptor,endpoint:{url:'http://modeled-private'},database:request.targetDatabase,manifest:request.manifest,assertActive});};
 globalThis.__testCompleteBinding=binding;return binding;
}
