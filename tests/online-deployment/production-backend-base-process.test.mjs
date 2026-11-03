import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {originalBackendBaseCommands} from '../../scripts/lib/production-backend-base-process.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');

test('closed originals keep exact returned bytes while redundant stream chunks are released',t=>{
 const module=new URL('../../scripts/lib/production-backend-base-process.mjs',import.meta.url).href;
 // GC is fixture-only, never a runtime resource action or admission gate.
 const source=`import assert from'node:assert/strict';import{originalBackendBaseCommands}from${JSON.stringify(module)};const owner=originalBackendBaseCommands(),results=[];global.gc();const before=process.memoryUsage().arrayBuffers;for(let i=0;i<8;i++){const r=await owner.run(process.execPath,['-e',"process.stdout.write(Buffer.alloc(524288,65));process.stderr.write(Buffer.alloc(524288,66));"]);owner.assertSuccessful(r);assert.equal(r.stdout.length,524288);assert.equal(r.stderr.length,524288);assert.equal(r.stdout,'A'.repeat(524288));assert.equal(r.stderr,'B'.repeat(524288));assert.ok(r.stdoutEof&&r.stderrEof);results.push(r);}global.gc();global.gc();const after=process.memoryUsage().arrayBuffers;const closure=await owner.close();assert.equal(closure.childCount,8);process.stdout.write(JSON.stringify({before,after,retainedArrayBufferBytes:after-before,resultBytes:results.reduce((n,r)=>n+r.stdout.length+r.stderr.length,0),closure}));`;
 const result=spawnSync(process.execPath,['--expose-gc','--input-type=module','-e',source],{encoding:'utf8',windowsHide:true,maxBuffer:65536});assert.equal(result.status,0,result.stderr);assert.equal(result.signal,null);const actual=JSON.parse(result.stdout);t.diagnostic(JSON.stringify(actual));assert.equal(actual.resultBytes,8*1048576);assert.ok(actual.retainedArrayBufferBytes<1048576,JSON.stringify(actual));assert.equal(actual.closure.allOriginalChildrenClosed,true);assert.equal(actual.closure.interrupted,false);
});

test('nonzero and bounded-output originals retain their negative result and both EOFs',async()=>{
 const owner=originalBackendBaseCommands();try{
  const failed=await owner.run(process.execPath,['-e',"process.stdout.write('exact-out');process.stderr.write('exact-err');process.exitCode=7;"]);assert.equal(failed.code,7);assert.equal(failed.stdout,'exact-out');assert.equal(digest(failed.stderr),digest('exact-err'));assert.ok(failed.stdoutEof&&failed.stderrEof&&failed.naturalChildClosure);assert.throws(()=>owner.assertSuccessful(failed));
  const bounded=await owner.run(process.execPath,['-e','process.stdout.write(Buffer.alloc(65536,67));'],{maximum:1024});assert.equal(bounded.outputBoundExceeded,true);assert.ok(bounded.stdoutEof&&bounded.stderrEof);assert.throws(()=>owner.assertSuccessful(bounded));
 }finally{const closed=await owner.close();assert.equal(closed.childCount,2);assert.equal(closed.allOriginalChildrenClosed,true);}
});

test('failed spawn evidence remains negative and its original pipes close',async()=>{
 const owner=originalBackendBaseCommands();try{const r=await owner.run('C:/sabalan-nonexistent-owned-fixture.exe',[]);assert.ok(r.spawnError);assert.throws(()=>owner.assertSuccessful(r));assert.equal(r.originalPid,null);assert.notEqual(r.code,0);}finally{assert.equal((await owner.close()).allOriginalChildrenClosed,true);}
});


test('an owned child that terminates itself remains negative with exact prior output',async()=>{
 const owner=originalBackendBaseCommands();try{const r=await owner.run(process.execPath,['-e',"process.stdout.write('before-cut',()=>process.kill(process.pid,'SIGTERM'));"]);assert.equal(r.stdout,'before-cut');assert.ok(r.stdoutEof&&r.stderrEof);assert.ok(r.code!==0||r.signal!==null);assert.throws(()=>owner.assertSuccessful(r));}finally{assert.equal((await owner.close()).allOriginalChildrenClosed,true);}
});

test('controller cancellation stays sticky even when its original child closes successfully',async()=>{
 const owner=originalBackendBaseCommands();try{const pending=owner.run(process.execPath,['-e',"process.stdout.write('closed')"]);process.emit('SIGINT');const r=await pending;assert.equal(r.code,0);assert.ok(r.stdoutEof&&r.stderrEof);assert.throws(()=>owner.assertSuccessful(r),/ORIGINAL_CONTROLLER_INTERRUPTED/);}finally{const closed=await owner.close();assert.equal(closed.allOriginalChildrenClosed,true);assert.equal(closed.interrupted,true);}
});
