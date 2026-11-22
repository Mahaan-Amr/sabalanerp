import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {BrowserOperationJournal} from '../../deploy/scripts/browser-operation-journal.mjs';

const operation={registryIdentity:'a'.repeat(64),generation:1,buildId:'inquiry_current',slotId:'slot_inquiry_current',
  image:`sha256:${'b'.repeat(64)}`,manifestSha256:'c'.repeat(64),method:'POST'};
async function fixture(work){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sabalan-browser-journal-'));
  try {const journal=new BrowserOperationJournal({directory,instanceId:'1'.repeat(64)});await journal.initialize();await work(journal,directory);}
  finally {assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('sabalan-browser-journal-'));await fs.rm(directory,{recursive:true,force:true});}
}

test('durable intent survives replacement instances; completion is owned, hash-linked and immutable',async()=>fixture(async(journal,directory)=>{
  const id=await journal.begin({...operation,body:'MUST_NOT_BE_STORED',path:'/private-record?secret=NO'});
  const raw=await fs.readFile(path.join(directory,`${id}.intent.json`),'utf8');
  assert.equal(raw.includes('MUST_NOT_BE_STORED'),false);assert.equal(raw.includes('private-record'),false);
  const replacement=new BrowserOperationJournal({directory,instanceId:'2'.repeat(64)});await replacement.initialize();
  assert.equal((await replacement.pending())[0].id,id);
  await assert.rejects(()=>replacement.complete(id,'UPSTREAM_ENDED'),/NOT_OWNED/);
  await journal.complete(id,'UPSTREAM_ENDED');await journal.complete(id,'UPSTREAM_ENDED');
  assert.deepEqual(await replacement.pending(),[]);
  await assert.rejects(()=>journal.complete(id,'NOT_FORWARDED'),/COMPLETION_CONFLICT/);
  const value=JSON.parse(raw);value.generation=2;
  await fs.writeFile(path.join(directory,`${id}.intent.json`),JSON.stringify(value));
  await assert.rejects(()=>replacement.pending(),/COMPLETION_INVALID/);
}));

test('unknown, torn, orphan and unsafe evidence cannot become an empty journal',async()=>{
  await fixture(async(journal,directory)=>{
    await fs.writeFile(path.join(directory,'unknown-file'),'pending evidence',{mode:0o600});
    await assert.rejects(()=>journal.pending(),/INVENTORY_INVALID/);
  });
  await fixture(async(journal,directory)=>{
    const id=await journal.begin(operation);
    await fs.writeFile(path.join(directory,`${id}.intent.json`),'torn');
    await assert.rejects(()=>journal.pending(),/RECORD_INVALID/);
  });
  await fixture(async(journal,directory)=>{
    const id=await journal.begin(operation);await journal.complete(id,'UPSTREAM_ENDED');
    await fs.unlink(path.join(directory,`${id}.intent.json`));
    await assert.rejects(()=>journal.pending(),/ORPHAN_COMPLETION/);
  });
});

test('Linux journal refuses foreign permissions, hardlinks and symlink records',{skip:process.platform!=='linux'},async()=>{
  await fixture(async(journal,directory)=>{
    const id=await journal.begin(operation),file=path.join(directory,`${id}.intent.json`);
    await fs.chmod(file,0o644);await assert.rejects(()=>journal.pending(),/RECORD_UNSAFE/);await fs.chmod(file,0o600);
    const linked=path.join(directory,`${'d'.repeat(32)}.intent.json`);await fs.link(file,linked);
    await assert.rejects(()=>journal.pending(),/RECORD_UNSAFE/);await fs.unlink(linked);
    await fs.symlink(file,linked);await assert.rejects(()=>journal.pending(),/INVENTORY_INVALID/);await fs.unlink(linked);
    await fs.chmod(directory,0o755);await assert.rejects(()=>journal.pending(),/DIRECTORY_UNSAFE/);await fs.chmod(directory,0o700);
  });
});

test('a real killed writer leaves durable intent visible to a new instance',{skip:process.platform!=='linux',timeout:30000},async()=>fixture(async(journal,directory)=>{
  const moduleUrl=new URL('../../deploy/scripts/browser-operation-journal.mjs',import.meta.url).href;
  const source=`import {BrowserOperationJournal} from ${JSON.stringify(moduleUrl)};
    const journal=new BrowserOperationJournal({directory:${JSON.stringify(directory)},instanceId:'4'.repeat(64)});
    await journal.initialize();console.log(await journal.begin(${JSON.stringify(operation)}));setInterval(()=>{},1000);`;
  const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['ignore','pipe','pipe']});
  const lines=createInterface({input:child.stdout});
  try {
    const [id]=await once(lines,'line');assert.match(id,/^[a-f0-9]{32}$/);
    const exited=once(child,'exit');child.kill('SIGKILL');const [code,signal]=await exited;
    assert.equal(code,null);assert.equal(signal,'SIGKILL');
    const replacement=new BrowserOperationJournal({directory,instanceId:'5'.repeat(64)});await replacement.initialize();
    const pending=await replacement.pending();assert.equal(pending.length,1);assert.equal(pending[0].id,id);
    await assert.rejects(()=>replacement.complete(id,'UPSTREAM_ENDED'),/NOT_OWNED/);
  } finally {lines.close();if(child.exitCode===null && child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}}
}));


test('missing or replaced roots cannot be silently reinitialized',async()=>fixture(async(journal,directory)=>{
  const absent=path.join(directory,'absent');
  const missing=new BrowserOperationJournal({directory:absent,instanceId:'6'.repeat(64)});
  await assert.rejects(()=>missing.initialize(),{code:'ENOENT'});
  await assert.rejects(()=>fs.stat(absent),{code:'ENOENT'});
  const uninitialized=new BrowserOperationJournal({directory,instanceId:'7'.repeat(64)});
  await assert.rejects(()=>uninitialized.begin(operation),/NOT_INITIALIZED/);
  await assert.rejects(()=>uninitialized.pending(),/NOT_INITIALIZED/);
  const sibling=directory+'-preserved';
  await fs.rename(directory,sibling);
  try {
    await fs.mkdir(directory,{mode:0o700});
    await assert.rejects(()=>journal.begin(operation),/DIRECTORY_REPLACED/);
    await assert.rejects(()=>journal.pending(),/DIRECTORY_REPLACED/);
  } finally {
    await fs.rmdir(directory);await fs.rename(sibling,directory);
  }
}));
