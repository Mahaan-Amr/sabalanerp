/** Real HTTP transport with modeled native-owner boundary; no native admission. */
import test from 'node:test';import assert from 'node:assert/strict';import Module,{createRequire} from 'node:module';import fs from 'node:fs';import path from 'node:path';
const require=createRequire(import.meta.url),esbuild=require('../../backend/node_modules/esbuild');
function load(file,replacements){const name=path.resolve(file),m=new Module(name),r=createRequire(name);m.filename=name;m.require=id=>Object.hasOwn(replacements,id)?replacements[id]:r(id);m._compile(esbuild.transformSync(fs.readFileSync(name,'utf8'),{format:'cjs',target:'node22'}).code,name);return m.exports;}
test('fixed Windows reader shares the original current guard without enrolling/signing or sharing issuer sequence',async()=>{
 const branded=new WeakSet(),events=[],resources=Object.freeze({async assertCurrent(){events.push('current');},async readSeedContext(){events.push('context');return{format:'same-live-context',operation:'a'.repeat(32)};}});branded.add(resources);
 const {createOriginalCompleteReaderPort,retainOriginalCompleteReaderClient}=load('scripts/lib/original-complete-reader-port.mjs',{'./original-complete-resource-ports.mjs':{assertOriginalCompleteResourcePorts:r=>assert.ok(branded.has(r))}});
 await assert.rejects(createOriginalCompleteReaderPort({operation:'a'.repeat(32),passphrase:'Z'.repeat(64),resources:{},port:0}));
 const server=await createOriginalCompleteReaderPort({operation:'a'.repeat(32),passphrase:'Z'.repeat(64),resources,port:0});
 const client=await retainOriginalCompleteReaderClient({operation:'a'.repeat(32),passphrase:'Z'.repeat(64),port:server.endpoint.port,assertOriginalWorkerActive:()=>{}});
 try{await client.assertOriginalCurrent();assert.deepEqual(await client.readSeedContext(),{format:'same-live-context',operation:'a'.repeat(32)});assert.equal(typeof client.issueOriginalRestoredMaterial,'undefined');assert.equal(typeof client.prepareOriginalRestoredLayout,'undefined');assert.equal(events.filter(v=>v==='context').length,1);}finally{const c=client.close();assert.equal(c.allOriginalHttpReadersClosed,true);const s=await server.close();assert.equal(s.fault,null);assert.equal(s.authenticationKeyRetired,true);assert.ok(s.readers.every(r=>r.closed));}
});

test('signed pressure refusal blocks only new work; actual CURRENT and reader closure still succeed',async()=>{
 const resources={async assertCurrent(){},async observeMemoryAdmission(){return{admitted:false};}};
 const {createOriginalCompleteReaderPort,retainOriginalCompleteReaderClient}=load('scripts/lib/original-complete-reader-port.mjs',{'./original-complete-resource-ports.mjs':{assertOriginalCompleteResourcePorts:r=>assert.equal(r,resources)}});
 const server=await createOriginalCompleteReaderPort({operation:'a'.repeat(32),passphrase:'Z'.repeat(64),resources,port:0}),client=await retainOriginalCompleteReaderClient({operation:'a'.repeat(32),passphrase:'Z'.repeat(64),port:server.endpoint.port,assertOriginalWorkerActive(){}});
 try{await assert.rejects(client.assertMemoryWorkAdmission(),/QA_MEMORY_PRESSURE_REFUSED/);await client.assertOriginalCurrent();}
 finally{assert.equal(client.close().failed,false);const c=await server.close();assert.equal(c.fault,null);assert.ok(c.readers.every(r=>r.closed));assert.deepEqual(c.requests.map(r=>r.kind),['WORK_ADMISSION','CURRENT']);}
});
