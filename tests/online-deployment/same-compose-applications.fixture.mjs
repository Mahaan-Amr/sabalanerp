// Modeled ports only: never an existing lease, endpoint or native acceptance.
import assert from 'node:assert/strict';
import {physicalFixture,owned} from './same-compose-physical.fixture.mjs';
import {fixture as inquiryFixture} from './restored-inquiry-carrier-observation.fixture.mjs';
export function applicationFixture(directory){
 const f=physicalFixture(directory),inquiry=inquiryFixture(f.report.sourceDatabase),events=[],state={phase:'ENROLLED',fail:null,active:true};
 const layout=JSON.parse(Buffer.from(f.app.ownedOutputs.layout.rawBase64,'base64')),captured=JSON.parse(Buffer.from(f.app.ownedOutputs.captured.rawBase64,'base64'));
 layout.sqlite.sha256=captured.sqliteSnapshot.sha256=inquiry.expected.restoredSqliteSha256;
 const baseline=owned({format:'model-restored-baseline'}),database=f.report.sourceDatabase;
 const input={format:'sabalan-same-compose-physical-applications-input/v1',operation:f.plan.operation,productionAdmission:false,
  ...Object.fromEntries(['sourceHost','replayHost','rsaHost','sealedManifestSha256','plaintextManifestSha256','cipherInventorySha256','decryption','replay'].map(k=>[k,f.report[k]])),
  ...Object.fromEntries(['images','sourceImages','imageGraphs','imageArchiveReceipts','imageCipherSources','controllerSourceSha256'].map(k=>[k,f.app[k]])),
  imageSources:f.report.images,canonicalReplay:f.plan.canonicalReplay,
  ownedInputs:{layout:owned(layout),captured:owned(captured),coverage:f.app.ownedOutputs.coverage,walClosure:f.app.ownedOutputs.walClosure}};
 const ports={assertActive(){assert.ok(state.active);return true;},async prepare(){events.push('prepare');},inquiryExpected:()=>inquiry.expected,
  broker:{inspect:()=>({phase:state.phase}),async runBaseline(){events.push('baseline');return{...f.report.baseline,result:{manifestSha256:baseline.sha256}};},
   async initialize(){events.push('initialize');return{productionAdmission:false};},async startHttp(){events.push('http');state.phase='HTTP_READY';},
   httpEndpointWitness:()=>({model:true}),async closeHttp(){events.push('close');state.phase='CLOSED';return f.report.backendClosure;},
   async awaitRetainedClosure(){events.push('retained');if(state.fail==='retained')throw Error('held');}},
  async exercise(){events.push('probe');if(state.fail==='probe')throw Error('probe');return{database,authenticated:true,businessVerified:true,filesVerified:true,productionAdmission:false,
   originals:[{role:'frontend',originalPid:43,code:0,signal:null,stdoutEof:true,stderrEof:true,killed:false,observationFault:null,sha256:'c'.repeat(64)},{role:'inquiry',evidence:inquiry.evidence}]};},
  async recheck(){events.push('recheck');if(state.fail==='recheck')throw Error('readback');return{database,sql:{visible:true,sessions:0,prepared:0},filesVerified:true,productionAdmission:false};},
  async readClosedObservations(){events.push('observations');assert.equal(state.phase,'CLOSED');return{applicationHealth:f.report.applicationHealth,ownedOutputs:{restoredBaseline:baseline,namespaceSqlObservation:owned({model:true}),
   ...Object.fromEntries(['backend','frontend','inquiry'].map(role=>['imageArchiveReceipt-'+role,owned({model:true,role})]))}};}};
 return{input,ports,events,state};
}
export function bindExistingPhysicalApplicationPorts(resources){return applicationFixture(resources.directory).ports;}
