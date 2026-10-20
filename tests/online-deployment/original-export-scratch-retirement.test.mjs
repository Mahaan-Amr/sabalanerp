import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {validateOriginalExportRetirementReceipt} from '../../scripts/lib/original-export-scratch-retirement.mjs';
function fixture(service='frontend'){
 const operation='actual-'+service+'-image-export-'+'a'.repeat(32),root='/root/'+operation,services=Object.fromEntries(['backend','clamav','frontend','inquiry','nginx','postgres'].map((service,i)=>[service,{id:String(i+1).repeat(64),image:'sha256:'+String(i+1).repeat(64),startedAt:'2026-10-20T12:00:00Z'}])),before=Object.entries(services).map(([service,v])=>({service,id:v.id,image:v.image,birth:v.startedAt})),pin=(suffix,sha256)=>({path:root+'/'+service+'.docker.tar'+suffix,sha256,bytes:4096,device:'1',inode:suffix?'3':'2'}),remote={format:'sabalan-actual-production-'+service+'-image-export/v1',passResult:true,allSixIdentitiesUnchanged:true,allOriginalChildrenClosed:true,originalCommands:[{originalPid:123,returncode:0}],before,after:structuredClone(before),sourceImage:services[service].image,image:{id:services[service].image,rootfs:['sha256:'+'b'.repeat(64)]},rawArchive:pin('','c'.repeat(64)),compressedArchive:pin('.gz','d'.repeat(64))},original={code:0,signal:null,naturalChildClosure:true,outputBoundExceeded:false},directory='D:/sabalanerp-online-qa/'+operation;
 return{format:'sabalan-actual-'+service+'-image-export-ssh/v1',operation,directory,passResult:true,originalSsh:{...original,stdout:JSON.stringify(remote)},originalTransfer:original,originalClosure:{allOriginalChildrenClosed:true,interrupted:false},remote,snapshotBaseline:{services},localArchive:{path:directory+'/'+service+'.docker.tar.gz',bytes:4096,sha256:remote.compressedArchive.sha256}};
}
test('only successful original fresh exports identify exact two remote scratch files',()=>{
 for(const service of ['frontend','inquiry']){const receipt=fixture(service),result=validateOriginalExportRetirementReceipt(receipt);assert.equal(result.service,service);assert.equal(result.root,'/root/'+receipt.operation);}
});
test('interrupted, signaled, failed or unrelated paths cannot authorize scratch retirement',()=>{
 for(const change of [v=>v.originalClosure.interrupted=true,v=>v.originalClosure.allOriginalChildrenClosed=false,v=>v.originalSsh.signal='SIGTERM',v=>v.originalTransfer.code=1,v=>v.remote.rawArchive.path='/srv/sabalanerp-recovery/checkpoints/held.tar',v=>v.operation='actual-frontend-image-export-../../checkpoint',v=>v.snapshotBaseline=null,v=>v.localArchive.sha256='f'.repeat(64)]){const receipt=fixture();change(receipt);assert.throws(()=>validateOriginalExportRetirementReceipt(receipt));}
});
test('fixed remote template has valid Python syntax without any command execution',()=>{
 const text=fs.readFileSync(new URL('../../deploy/scripts/retire-original-export-scratch.py',import.meta.url),'utf8');execFileSync('python',['-X','utf8','-B','-c','import ast,sys;ast.parse(sys.stdin.read())'],{input:text});
});
