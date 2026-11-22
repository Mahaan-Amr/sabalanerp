'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex');
const crossFields=['ino','size','mtimeNs','ctimeNs','mode','nlink',...(process.platform==='win32'?[]:['dev'])];
function readInquiryCompiledBrowser(root='/app'){
  assert.equal(fs.realpathSync(root),root);const files=[],links=[],linkCustody=[];let total=0;
  function stableLink(row){
    const after=fs.lstatSync(row.file,{bigint:true}),target=fs.lstatSync(row.resolved,{bigint:true});
    for(const key of crossFields){assert.equal(after[key],row.before[key]);assert.equal(target[key],row.targetBefore[key]);}
    assert.equal(fs.readlinkSync(row.file),row.link);assert.equal(fs.realpathSync(row.file),row.resolved);assert.equal(fs.realpathSync(row.resolved),row.resolved);
  }
  function visit(relative){
    if(relative==='.next/cache')return;
    const file=path.join(root,relative),before=fs.lstatSync(file,{bigint:true});
    if(before.isSymbolicLink()){
      // Next may retain an internal Prisma dependency link. Record the link
      // itself; dependency bytes remain bound by the immutable image graph.
      assert.ok(relative.startsWith('.next/node_modules/')&&before.nlink===1n&&links.length<20000,'INQUIRY_DEPENDENCY_LINK_LOCATION');
      const link=fs.readlinkSync(file);assert.ok(link&&link.length<=4096&&!path.isAbsolute(link)&&!link.includes('\\')&&!link.includes('\0'),'INQUIRY_DEPENDENCY_LINK_TARGET');
      const resolved=path.resolve(path.dirname(file),link),resolvedPath=path.relative(root,resolved).split(path.sep).join('/');
      assert.ok(resolvedPath.startsWith('node_modules/')&&!resolvedPath.split('/').some(part=>!part||part==='.'||part==='..'),'INQUIRY_DEPENDENCY_LINK_ESCAPE');
      assert.equal(fs.realpathSync(resolved),resolved,'INQUIRY_DEPENDENCY_LINK_CHAIN');
      const targetBefore=fs.lstatSync(resolved,{bigint:true});assert.ok(targetBefore.isDirectory()||targetBefore.isFile(),'INQUIRY_DEPENDENCY_LINK_TYPE');
      const row={file,before,link,resolved,targetBefore};stableLink(row);linkCustody.push(row);
      links.push({path:relative,type:'symlink',target:link,resolvedPath,targetType:targetBefore.isDirectory()?'directory':'file'});return;
    }
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
  for(const row of linkCustody)stableLink(row);
  const manifest={format:'sabalan-inquiry-compiled-browser/v1',id,frameworkBuildId,deploymentId,files,...(links.length?{links}:{}),actionIds,assets};
  return {manifest,manifestSha256:sha(Buffer.from(JSON.stringify(manifest))),id,frameworkBuildId,deploymentId,actionIds,assets};
}
function inquiryRuntimeBuildEnvironment(compiled,environment=process.env){
  const selected=compiled.deploymentId;
  assert.ok(selected===null||typeof selected==='string'&&/^[a-z][a-z0-9_-]{7,95}$/.test(selected),'INQUIRY_COMPILED_DEPLOYMENT_ID_REQUIRED');
  if(selected!==null)assert.equal(compiled.id,selected,'INQUIRY_COMPILED_DEPLOYMENT_ID_REQUIRED');
  const keys=['SABALAN_INQUIRY_BUILD_ID','NEXT_PUBLIC_INQUIRY_BUILD_ID','NEXT_DEPLOYMENT_ID'];
  for(const key of keys){const value=environment[key];assert.ok(value===undefined||(selected===null?value==='':value===selected),'INQUIRY_RUNTIME_BUILD_ID_CONFLICT');}
  return Object.fromEntries(selected===null?[]:keys.map(key=>[key,selected]));
}
module.exports={readInquiryCompiledBrowser,inquiryRuntimeBuildEnvironment};
if(require.main===module){
  const runtime=process.argv[2]==='--runtime-environment'||process.argv[2]==='--runtime-exports',compiled=readInquiryCompiledBrowser(process.argv[runtime?3:2]||'/app');
  if(!runtime)process.stdout.write(JSON.stringify(compiled)+'\n');
  else{const environment=inquiryRuntimeBuildEnvironment(compiled);if(process.argv[2]==='--runtime-exports')process.stdout.write(['SABALAN_INQUIRY_BUILD_ID','NEXT_PUBLIC_INQUIRY_BUILD_ID','NEXT_DEPLOYMENT_ID'].map(key=>environment[key]===undefined?'unset '+key:'export '+key+"='"+environment[key]+"'").join('\n')+'\n');else process.stdout.write(JSON.stringify({deploymentId:compiled.deploymentId,id:compiled.id,manifestSha256:compiled.manifestSha256,environment})+'\n');}
}
