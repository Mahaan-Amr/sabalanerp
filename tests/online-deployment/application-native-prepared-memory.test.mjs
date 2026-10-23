import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createRequire} from 'node:module';
import {expectedQaCandidateMemory} from '../../scripts/lib/application-native-qa-profile.mjs';
import {validateOriginalPreparedMemoryObservation} from '../../scripts/lib/application-native-prepared-memory.mjs';

const id='a'.repeat(64),maximum=1536*1024**2,floor=384*1024**2;
function closed(changes={}){return{containerId:id,argv:['exec',id,'/bin/cat','/sys/fs/cgroup/memory.current','/sys/fs/cgroup/memory.max'],originalPid:123,code:0,signal:null,naturalChildClosure:true,stdoutEof:true,stderrEof:true,spawnError:null,streamErrors:[],outputBoundExceeded:false,stdout:`${maximum-floor}\n${maximum}\n`,stderr:'',...changes};}

test('fresh post-child exact1536/384 boundary passes without credit',()=>{
 const result=validateOriginalPreparedMemoryObservation(closed());assert.equal(result.memoryMaximum,maximum);assert.equal(result.actualFreeBytes,floor);assert.equal(result.cacheCreditUsed,false);assert.equal(result.observerMemoryIncluded,true);
});
test('different memory cap cannot replace the1536 policy',()=>{assert.throws(()=>validateOriginalPreparedMemoryObservation(closed({stdout:`1\n${maximum+1}\n`})),/NATIVE_PREPARED_MEMORY_CAP_CHANGED/);});
test('requires exactly two bounded safe integer lines',()=>{
 for(const stdout of ['1\n','1\nmax\n','1\n2\n3\n','-1\n805306368\n','1.5\n805306368\n','9007199254740993\n805306368\n','1\r\n805306368\r\n'])assert.throws(()=>validateOriginalPreparedMemoryObservation(closed({stdout})));
});
test('failed/signalled/pending/nonEOF/stream-failed original children never pass',()=>{
 for(const changes of [{code:1},{signal:'SIGTERM'},{naturalChildClosure:false},{stdoutEof:false},{stderrEof:false},{spawnError:'ENOENT'},{streamErrors:[{stream:'stdout',code:'EIO'}]},{outputBoundExceeded:true},{stderr:'unexpected'}])assert.throws(()=>validateOriginalPreparedMemoryObservation(closed(changes)));
});
test('one byte below384 actualfree refuses',()=>{assert.throws(()=>validateOriginalPreparedMemoryObservation(closed({stdout:`${maximum-floor+1}\n${maximum}\n`})),/NATIVE_PREPARED_ACTUAL_MEMORY_FLOOR_REFUSED/);});
test('historical Python statistics or wrong command cannot provide fresh proof',()=>{
 assert.throws(()=>validateOriginalPreparedMemoryObservation({memoryCurrent:1,memoryMaximum:maximum,cacheCreditUsed:false}));assert.throws(()=>validateOriginalPreparedMemoryObservation(closed({argv:['exec',id,'python3','historical.py']})));
});

// Execute the complete helper with only its original spawn boundary replaced;
// no Docker command, service, native memory observation or admission is made.
function originalChildFixture(){
 const source=fs.readFileSync(new URL('../../scripts/lib/application-native-prepared-memory.mjs',import.meta.url),'utf8');
 const ts=createRequire(path.resolve('backend/package.json'))('typescript');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const child=new EventEmitter();child.pid=321;child.stdout=new PassThrough();child.stderr=new PassThrough();let before=0,spawned=0,observation;
 const exports={};vm.runInNewContext(compiled,{exports,Buffer,require(name){if(name==='./application-native-qa-profile.mjs')return{expectedQaCandidateMemory};if(name==='node:assert/strict')return{default:assert};if(name==='node:child_process')return{spawn(executable,argv,options){assert.equal(before,1);assert.equal(executable,'docker');assert.deepEqual(JSON.parse(JSON.stringify(argv)),closed().argv);assert.deepEqual(JSON.parse(JSON.stringify(options)),{stdio:['ignore','pipe','pipe']});spawned++;return child;}};throw Error('Unexpected module');}});
 const promise=exports.observeOriginalPreparedMemory({containerId:id,beforeDocker(){before++;},onObservation(value){observation=value;}});return{child,promise,get observation(){return observation;},get spawned(){return spawned;}};
}
test('actual helper waits bothEOF and originalclose before fresh proof',async()=>{
 const f=originalChildFixture();let settled=false;f.promise.then(()=>{settled=true;});assert.equal(f.spawned,1);f.child.stdout.end(closed().stdout);f.child.stderr.end();await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);assert.equal(f.observation,undefined);f.child.emit('close',0,null);const result=await f.promise;assert.equal(result.actualFreeBytes,floor);assert.equal(f.observation.naturalChildClosure,true);
});
test('actual helper records original failedclose before refusing',async()=>{
 const f=originalChildFixture();const refused=assert.rejects(f.promise,/PREPARED_MEMORY_CHILD_FAILED/);f.child.stdout.end();f.child.stderr.end('cat failure');await new Promise(resolve=>setImmediate(resolve));assert.equal(f.observation,undefined);f.child.emit('close',1,null);await refused;assert.equal(f.observation.code,1);
});
test('oversized output is drained through originalclose and refuses',async()=>{
 const f=originalChildFixture();const refused=assert.rejects(f.promise,/PREPARED_MEMORY_OUTPUT_BOUND/);f.child.stdout.end(Buffer.alloc(129,49));f.child.stderr.end();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.observation,undefined);f.child.emit('close',0,null);await refused;assert.equal(f.observation.outputBoundExceeded,true);
});
