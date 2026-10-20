'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex');
const crossFields=['ino','size','mtimeNs','ctimeNs','mode','nlink',...(process.platform==='win32'?[]:['dev'])];
function readInquiryCompiledBrowser(root='/app'){
  assert.equal(fs.realpathSync(root),root);const files=[];let total=0;
  function visit(relative){
    if(relative==='.next/cache')return;
    const file=path.join(root,relative),before=fs.lstatSync(file,{bigint:true});assert.ok(!before.isSymbolicLink());
    if(before.isDirectory()){
      const names=fs.readdirSync(file).sort();assert.ok(names.length<=20000);
      for(const name of names)visit(path.posix.join(relative,name));
      assert.deepEqual(fs.readdirSync(file).sort(),names);
      const after=fs.lstatSync(file,{bigint:true});for(const key of ['dev','ino','mtimeNs','ctimeNs','mode'])assert.equal(after[key],before[key]);return;
    }
    assert.ok(before.isFile()&&before.nlink===1n&&before.size<=BigInt(256*1024**2-total));
    const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);let raw;
    try{
      const opened=fs.fstatSync(fd,{bigint:true});for(const key of crossFields)assert.equal(opened[key],before[key]);
      raw=fs.readFileSync(fd);total+=raw.length;assert.ok(files.length<20000&&total<=256*1024**2);
      const after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(file,{bigint:true});
      assert.equal(after.dev,opened.dev);
      for(const key of crossFields){assert.equal(after[key],before[key]);assert.equal(named[key],before[key]);}
    }finally{fs.closeSync(fd);}
    files.push({path:relative,bytes:raw.length,sha256:sha(raw)});
  }
  visit('.next');if(fs.existsSync(path.join(root,'public')))visit('public');
  for(const file of ['package.json','next.config.ts'])visit(file);
  const frameworkBuildId=fs.readFileSync(path.join(root,'.next/BUILD_ID'),'utf8').trim();assert.match(frameworkBuildId,/^[A-Za-z0-9_-]{1,128}$/);
  const config=JSON.parse(fs.readFileSync(path.join(root,'.next/required-server-files.json'),'utf8')).config;
  const deploymentId=config.deploymentId||null;
  if(deploymentId){assert.match(deploymentId,/^[a-z][a-z0-9_-]{7,95}$/);assert.equal(config.env?.NEXT_PUBLIC_INQUIRY_BUILD_ID,deploymentId);}
  else assert.ok(!config.env?.NEXT_PUBLIC_INQUIRY_BUILD_ID);
  const actions=JSON.parse(fs.readFileSync(path.join(root,'.next/server/server-reference-manifest.json'),'utf8'));
  const actionIds=[...new Set([...Object.keys(actions.node||{}),...Object.keys(actions.edge||{})])].sort();
  assert.ok(actionIds.every(value=>/^(?:[a-f0-9]{40}|[a-f0-9]{42})$/.test(value)));
  const assets=files.filter(file=>file.path.startsWith('.next/static/')).map(file=>({...file,path:'/_next/static/'+file.path.slice('.next/static/'.length)}));
  const id=deploymentId||'inquiry_legacy_'+sha(Buffer.from(frameworkBuildId));
  const manifest={format:'sabalan-inquiry-compiled-browser/v1',id,frameworkBuildId,deploymentId,files,actionIds,assets};
  return {manifest,manifestSha256:sha(Buffer.from(JSON.stringify(manifest))),id,frameworkBuildId,deploymentId,actionIds,assets};
}
module.exports={readInquiryCompiledBrowser};
if(require.main===module)process.stdout.write(JSON.stringify(readInquiryCompiledBrowser(process.argv[2]||'/app'))+'\n');
