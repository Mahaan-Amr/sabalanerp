import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import os from'node:os';import path from'node:path';import{spawn}from'node:child_process';import{acquireSerialHostLease}from'../../scripts/lib/serial-physical/host-lease.mjs';
const python='C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe',moduleFile=path.resolve('deploy/scripts/original-image-owner-custody.py');
async function original(code,args,input){const child=spawn(python,['-I','-B','-c',code,...args],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.stdin.end(input);const result=await new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal,pid:child.pid,stdoutEof:child.stdout.readableEnded,stderrEof:child.stderr.readableEnded})));assert.equal(result.signal,null);assert.ok(result.stdoutEof&&result.stderrEof);return{...result,out,err};}
const load="import runpy,sys,json;ns=runpy.run_path(sys.argv[1],run_name='readonly_image_custody');";
test('real parent/birth/image and exclusive test lease; stale or wrong custody refuses naturally',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'image-custody-')),file=path.join(directory,'test-only.lock'),lease=await acquireSerialHostLease(file);let released=false;
 try{
  const observer=await original(load+"print(json.dumps({'root':ns['observe'](int(sys.argv[2])),'lease':ns['observe'](int(sys.argv[3])),'lockFile':sys.argv[4],'lockIdentity':ns['lock_identity'](sys.argv[4])}))",[moduleFile,String(process.pid),String(lease.originalPid),file],'');assert.equal(observer.code,0,observer.err);const expected=JSON.parse(observer.out);
  const check=load+"value=json.loads(sys.stdin.read());custody=ns['ParentCustody'](value);custody.assert_current();custody.close();print('READONLY_CUSTODY_CLOSED')";
  const good=await original(check,[moduleFile],JSON.stringify(expected));assert.equal(good.code,0,good.err);assert.equal(good.out.trim(),'READONLY_CUSTODY_CLOSED');
  for(const change of [v=>v.root.birth100ns='1',v=>v.lease.birth100ns='1',v=>v.lease.image='C:/wrong-image.exe',v=>v.root.pid=lease.originalPid]){const v=structuredClone(expected);change(v);const refused=await original(check,[moduleFile],JSON.stringify(v));assert.notEqual(refused.code,0);assert.ok(!refused.out.includes('READONLY_CUSTODY_CLOSED'));lease.assertHeld();}
  await lease.release();released=true;const gone=await original(check,[moduleFile],JSON.stringify(expected));assert.notEqual(gone.code,0);
 }finally{if(!released)await lease.release();assert.equal(fs.realpathSync(directory),directory);fs.unlinkSync(file);fs.rmdirSync(directory);}
});
