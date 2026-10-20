import fs from 'node:fs';import vm from 'node:vm';import {EventEmitter} from 'node:events';import {createRequire} from 'node:module';import {generateKeyPairSync,sign} from 'node:crypto';import assert from 'node:assert/strict';
const require=createRequire(new URL('../../backend/package.json',import.meta.url)),ts=require('typescript');
function compiled(name){return ts.transpileModule(fs.readFileSync(new URL(name,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;}
function evaluate(source,imports,extra={}){const module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports,require:n=>Object.hasOwn(imports,n)?imports[n]:require(n),Buffer,console,...extra});return module.exports;}
const control=evaluate(compiled('./online-private-qualification-control.fixture.ts'),{});
const {privateKey,publicKey}=generateKeyPairSync('ed25519'),pem=Buffer.from(publicKey.export({type:'spki',format:'pem'})),der=publicKey.export({type:'spki',format:'der'});
const session='1'.repeat(64),actorId='2'.repeat(64),scopeSha256='3'.repeat(64);
function wire(sequence,command){const value={format:control.PRIVATE_QUALIFICATION_CONTROL_FORMAT,session,actorId,scopeSha256,sequence,command};value.signature=sign(null,Buffer.from([value.format,session,actorId,scopeSha256,String(sequence),command].join('\0')),privateKey).toString('base64');return Buffer.from(JSON.stringify(value)+'\n');}
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function run(overflow){
 const input=new EventEmitter();input.destroy=()=>{input.destroyed=true;};const events=[],timers=new Set();
 const process={env:{NODE_ENV:'test',SMS_IR_API_KEY:'',SMS_IR_ENVIRONMENT:'production',SMS_IR_API_URL:'http://127.0.0.1:1',WEB_PUSH_VAPID_PUBLIC_KEY:'',WEB_PUSH_VAPID_PRIVATE_KEY:'',WEB_PUSH_VAPID_SUBJECT:'',TAXPAYER_DELIVERY_BROKER_ENDPOINT:'',HR_HIRING_E2E:'false',HR_HIRING_SMS_ADAPTER:'disabled',HTTP_PROXY:'',HTTPS_PROXY:'',ALL_PROXY:'',http_proxy:'',https_proxy:'',all_proxy:'',NO_PROXY:'127.0.0.1,localhost',no_proxy:'127.0.0.1,localhost'},platform:'linux',argv:['node','worker',der.toString('base64'),session,actorId],stdin:input,stdout:{write:line=>{events.push(JSON.parse(line.slice('SABALAN_PRIVATE_QUALIFICATION '.length)));return true;}}};
 const entry=Buffer.from('installed image entry'),keyPath='/run/sabalan-online/qualification-controller-public-key.pem',entryPath='/app/dist/onlinePrivateQualification.js';
 let nextFd=1;const descriptors=new Map();
 const stat=(bytes,mode)=>({dev:1n,ino:BigInt(mode),size:BigInt(bytes.length),mtimeNs:1n,ctimeNs:1n,uid:0n,mode:BigInt(mode),nlink:1n,isFile:()=>true});
 const tuple=name=>name===keyPath?{bytes:pem,mode:0o444}:name===entryPath?{bytes:entry,mode:0o644}:assert.fail(name);
 const fakeFs={constants:fs.constants,realpathSync:name=>name,openSync:name=>{const fd=nextFd++;descriptors.set(fd,{...tuple(name),offset:0});return fd;},closeSync:fd=>descriptors.delete(fd),fstatSync:fd=>{const d=descriptors.get(fd);return stat(d.bytes,d.mode);},lstatSync:name=>{const d=tuple(name);return stat(d.bytes,d.mode);},readSync:(fd,out,offset,length)=>{const d=descriptors.get(fd),count=Math.min(length,d.bytes.length-d.offset);d.bytes.copy(out,offset,d.offset,d.offset+count);d.offset+=count;return count;}};
 let shutdownResolve;let prepared=0,closed=0;const shutdownGate=new Promise(resolve=>shutdownResolve=resolve);
 const runtime={identity:{scopeSha256},async prepareDrain(){prepared++;},async shutdown(){closed++;if(overflow)await shutdownGate;}};
 const wrapper=evaluate(compiled('./online-private-qualification-native.worker.ts'),{'node:fs':fakeFs,'node:module':{createRequire:()=>name=>{assert.equal(name,entryPath);return {mainPrivateQualificationRuntime:async()=>runtime};}},'./online-private-qualification-control.fixture':control},{process,setInterval:callback=>{timers.add(callback);return callback;},clearInterval:timer=>timers.delete(timer)});
 for(const [name,value] of Object.entries(wrapper.PRIVATE_PROVIDER_ENV)){
  assert.throws(()=>wrapper.assertPrivateProviderEnvironment({...process.env,[name]:value===''?'inherited-secret':'unsafe'}),/PRIVATE_WORKER_PROVIDER_ENV_REFUSED/);
 }
 await wrapper.main();assert.equal(events[0].event,'READY');
 input.emit('data',wire(1,'PRIVATE_PREPARE_DRAIN'));await turn();assert.equal(prepared,1);assert.equal(events.at(-1).event,'PREPARED');
 input.emit('data',wire(2,'PRIVATE_SHUTDOWN'));await turn();assert.equal(closed,1);
 if(overflow){input.emit('data',Buffer.alloc(8193));assert.equal(events.at(-1).event,'HELD');shutdownResolve();await turn();assert.equal(events.some(e=>e.event==='CLOSED'),false);assert.equal(timers.size,1);assert.notEqual(input.destroyed,true);}
 else{assert.equal(events.at(-1).event,'CLOSED');assert.equal(input.destroyed,true);assert.equal(timers.size,0);}
}
await run(false);await run(true);console.log(JSON.stringify({scope:'source-interface only; mocked filesystem/image entry, real control signatures; no native/runtime grant',cases:2,pass:true}));
