import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {verifyHistoricalInquirySources} from '../../scripts/lib/application-native-inquiry-artifacts.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const root=path.resolve(import.meta.dirname,'../..');
function archive(rows){
  const blocks=[];
  for(const {name,body=Buffer.alloc(0),type='0'}of rows){
    const header=Buffer.alloc(512);header.write(name,0,100,'utf8');
    header.write('0000644\0',100);header.write('0000000\0',108);header.write('0000000\0',116);
    header.write(body.length.toString(8).padStart(11,'0')+'\0',124);
    header.fill(32,148,156);header.write(type,156);header.write('ustar\0',257);
    const checksum=header.reduce((a,b)=>a+b,0);header.write(checksum.toString(8).padStart(6,'0')+'\0 ',148);
    blocks.push(header,body,Buffer.alloc((512-body.length%512)%512));
  }
  return gzipSync(Buffer.concat([...blocks,Buffer.alloc(1024)]));
}
const body=Buffer.from('historical business source\r\n'),hashes={'app/actions.ts':sha(body)};
function verify(bytes,selected=hashes){return verifyHistoricalInquirySources(bytes,sha(bytes),selected);}

test('all 54 genuine original build inputs match their original immutable archive',()=>{
  const build=JSON.parse(fs.readFileSync(path.join(root,'reports/qa/sabalan-inquiry-build-6845a85e262d24f606a8ee9eca510173.json')));
  const receipt=JSON.parse(fs.readFileSync(path.join(root,'reports/qa/inquiry-native-next-image-20261018.json'))).imageReceipt;
  const original=fs.readFileSync(path.join(receipt.directory,'inquiry-build.tar.gz'));
  assert.equal(Object.keys(build.sourceHashes).length,54);
  assert.deepEqual(verifyHistoricalInquirySources(original,receipt.archiveSha256,build.sourceHashes),{archiveSha256:receipt.archiveSha256,sourceCount:54});
});
test('historical input remains distinct from a newer checkout and tolerates unselected archive links',()=>{
  const bytes=archive([{name:'app/actions.ts',body},{name:'.next/node_modules/client',type:'2'}]);
  assert.equal(verify(bytes).sourceCount,1);
  assert.throws(()=>verify(bytes,{'app/actions.ts':sha(Buffer.from('new checkout'))}));
});
test('whole archive corruption is rejected before source selection',()=>{
  const bytes=archive([{name:'app/actions.ts',body}]),changed=Buffer.from(bytes);changed[20]^=1;
  assert.throws(()=>verifyHistoricalInquirySources(changed,sha(bytes),hashes));
});
test('duplicate source entries cannot substitute verified bytes',()=>{
  assert.throws(()=>verify(archive([{name:'app/actions.ts',body},{name:'./app/actions.ts',body}])));
});
test('traversing or absolute archive entries are refused even when not selected',()=>{
  for(const name of ['../escape','/escape','app/../escape','C:/escape','app\\escape']){
    assert.throws(()=>verify(archive([{name:'app/actions.ts',body},{name,body}])));
  }
});
test('source links and missing sources never count as captured input bytes',()=>{
  assert.throws(()=>verify(archive([{name:'app/actions.ts',type:'2'}])));
  assert.throws(()=>verify(archive([{name:'different.ts',body}])));
});
test('changed source bytes fail even with a valid new gzip and tar checksum',()=>{
  assert.throws(()=>verify(archive([{name:'app/actions.ts',body:Buffer.from('changed')}])));
});
