import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomBytes} from 'node:crypto';
const after=new URL('./readonly-transport-retirement-edge.fixture.mjs',import.meta.url);
const currentSource=await fs.readFile(after,'utf8');
const previousUnsafeWriter="async function writeExclusive(file,value){\n  const text=JSON.stringify(canonical(value)).replace(/[^\\x00-\\x7f]/g,char=>'\\\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));\n  const raw=Buffer.from(text+'\\n');assert.ok(raw.length<=8*1024*1024);\n  const handle=await fs.open(file,'wx',0o600);\n  try{await handle.writeFile(raw);await handle.sync();}finally{await handle.close();}\n  const directory=await fs.open(path.dirname(file),'r');\n  try{await directory.sync();}finally{await directory.close();}return sha(raw);\n}";
const start=currentSource.indexOf('async function writeExclusive('),end=currentSource.indexOf('\n/**',start);
assert.ok(start>=0&&end>start);
const oldSource=currentSource.slice(0,start)+previousUnsafeWriter+currentSource.slice(end);
const compile=source=>new Function('fs','path','assert','createHash','randomBytes',source.slice(source.indexOf('const canonical='),source.indexOf('\n/**'))+';return writeExclusive;');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
// Windows cannot fsync directory handles; only that platform operation is mocked.
// Actual Linux directory durability still requires the canonical runtime test.
const portable={...fs,open:async(...args)=>{const handle=await fs.open(...args);return process.platform==='win32'&&args[1]==='r'?{sync:async()=>{},close:()=>handle.close()}:handle;}};
for(const [label,source,expectedVisible] of [['new',await fs.readFile(after,'utf8'),false],['old negative control',oldSource,true]]){
 test(label+': reader never sees partial final inode',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sabalan-ready-race-')),file=path.join(dir,'ready.json');
  let entered,release;const enteredPromise=new Promise(resolve=>entered=resolve),blocked=new Promise(resolve=>release=resolve);
  const shim={...portable,open:async(...args)=>{const handle=await portable.open(...args);if(args[1]!=='wx')return handle;return{writeFile:async raw=>{await handle.writeFile(raw.subarray(0,10));entered();await blocked;await handle.writeFile(raw.subarray(10));},sync:()=>handle.sync(),close:()=>handle.close()};}};
  const write=compile(source)(shim,path,assert,createHash,randomBytes);let pending;
  try{pending=write(file,{payload:'فارسی'.repeat(5000)});await enteredPromise;const visible=await fs.stat(file).then(()=>true,error=>{assert.equal(error.code,'ENOENT');return false;});assert.equal(visible,expectedVisible);release();await pending;assert.equal(JSON.parse(await fs.readFile(file,'utf8')).payload,'فارسی'.repeat(5000));assert.deepEqual((await fs.readdir(dir)).sort(),['ready.json']);}
  finally{release();if(pending)await pending.catch(()=>{});await fs.rm(dir,{recursive:true,force:true});}
 });
}
test('atomic publication refuses clobber and removes its private temporary',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sabalan-ready-clobber-')),file=path.join(dir,'ready.json');
 try{await fs.writeFile(file,'ORIGINAL');const write=compile(await fs.readFile(after,'utf8'))(portable,path,assert,createHash,randomBytes);await assert.rejects(write(file,{new:true}),{code:'EEXIST'});assert.equal(await fs.readFile(file,'utf8'),'ORIGINAL');assert.deepEqual(await fs.readdir(dir),['ready.json']);}finally{await fs.rm(dir,{recursive:true,force:true});}
});
