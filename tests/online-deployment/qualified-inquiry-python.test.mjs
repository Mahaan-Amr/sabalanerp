import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {decodeQualifiedPythonArchive,readQualifiedInquiryPython} from '../../scripts/lib/qualified-inquiry-python.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
function archive(rows){
 const blocks=[];
 for(const [name,body,type='0']of rows){const header=Buffer.alloc(512);header.write(name);header.write('0000644\0',100);header.write(body.length.toString(8).padStart(11,'0')+'\0',124);header[156]=type.charCodeAt();header.fill(32,148,156);const sum=header.reduce((a,b)=>a+b,0);header.write(sum.toString(8).padStart(6,'0')+'\0 ',148);blocks.push(header,body,Buffer.alloc((512-body.length%512)%512));}
 return gzipSync(Buffer.concat([...blocks,Buffer.alloc(1024)]));
}
test('offline reader binds regular materialized aliases and zero-byte files exactly',()=>{
 const body=Buffer.from('interpreter'),empty=Buffer.alloc(0),inventory={files:{'/usr/bin/python3.11':{bytes:body.length,sha256:sha(body)},'/usr/lib/empty.py':{bytes:0,sha256:sha(empty)}},links:{'/usr/bin/python3':'python3.11'}};
 const decoded=decodeQualifiedPythonArchive(archive([['usr/bin/python3.11',body],['usr/bin/python3',body],['usr/lib/empty.py',empty]]),inventory);assert.equal(decoded.size,3);assert.deepEqual(decoded.get('usr/bin/python3'),body);
});
test('offline reader refuses traversal, links, duplicate, missing and altered payloads',()=>{
 const body=Buffer.from('python'),inventory={files:{'/usr/bin/python3.11':{bytes:body.length,sha256:sha(body)}},links:{}};
 for(const rows of [[['../outside',body]],[['usr/bin/python3.11',body,'2']],[['usr/bin/python3.11',body],['usr/bin/python3.11',body]],[],[['usr/bin/python3.11',Buffer.from('change')]]])assert.throws(()=>decodeQualifiedPythonArchive(archive(rows),inventory));
});
test('existing qualified source retains negative extraction result and separately verified qualification',()=>{
 const value=readQualifiedInquiryPython();assert.equal(value.proof.extractionOriginalPass,false);assert.equal(value.proof.qualificationPass,true);assert.equal(value.content.size,1198);assert.equal(value.proof.sourceImage,'sha256:3da35cf09d7da919cab2d0e1c7b3dcdf98951529668d03488b99b6003c6d6751');assert.equal(value.proof.productionAdmission,false);
});
