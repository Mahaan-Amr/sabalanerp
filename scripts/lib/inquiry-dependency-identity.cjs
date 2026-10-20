'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex');
function inquiryDependencyIdentity(root){
  root=fs.realpathSync(root);const rows=[];let bytes=0,count=0;
  function visit(relative){
    const file=path.join(root,relative),before=fs.lstatSync(file,{bigint:true});
    assert.ok(++count<=250000,'INQUIRY_DEPENDENCY_COUNT_BOUND');
    if(before.isSymbolicLink()){
      const resolved=fs.realpathSync(file);assert.ok(resolved.startsWith(root+path.sep),'INQUIRY_EXTERNAL_DEPENDENCY_ALIAS');
      const target=fs.readlinkSync(file);assert.ok(!path.isAbsolute(target),'INQUIRY_ABSOLUTE_DEPENDENCY_ALIAS');
      rows.push({path:relative.replaceAll('\\','/'),type:'symlink',target});
    }else if(before.isDirectory()){
      rows.push({path:relative.replaceAll('\\','/'),type:'directory'});
      for(const name of fs.readdirSync(file).sort())visit(path.join(relative,name));
    }else{
      assert.ok(before.isFile()&&before.nlink===1n,'INQUIRY_SPECIAL_DEPENDENCY_FILE');
      bytes+=Number(before.size);assert.ok(bytes<=2*1024**3,'INQUIRY_DEPENDENCY_BYTES_BOUND');
      const content=fs.readFileSync(file);
      rows.push({path:relative.replaceAll('\\','/'),type:'file',bytes:content.length,executable:Boolean(before.mode&0o111n),sha256:sha(content)});
    }
    const after=fs.lstatSync(file,{bigint:true});
    for(const key of ['dev','ino','size','mtimeNs','ctimeNs','mode','nlink'])assert.equal(after[key],before[key],'INQUIRY_DEPENDENCY_CHANGED');
  }
  visit('');return {format:'sabalan-inquiry-dependency-tree/v1',files:count,bytes,sha256:sha(Buffer.from(JSON.stringify(rows)))};
}
module.exports={inquiryDependencyIdentity};
if(require.main===module){
  assert.equal(process.argv.length,3);process.stdout.write(JSON.stringify(inquiryDependencyIdentity(process.argv[2]))+'\n');
}
