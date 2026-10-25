import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import vm from 'node:vm';import ts from 'typescript';
/** Actual reader function under an explicit Linux metadata shim. Real named
 * files/descriptors/hardlinks are used; no key, SQL, lease or admission exists. */
const source=fs.readFileSync(path.join(__dirname,'../../scripts/deployment-owned-migrations.ts'),'utf8'),tree=ts.createSourceFile('caller.ts',source,ts.ScriptTarget.Latest,true);
const node=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='readProtectedFinancialPrerequisite')!;assert.ok(node);const body=node.getText(tree);
function load(root:string,parentMode:bigint,fileMode:bigint,legacy=false){
 let opens=0;const stats=(st:fs.BigIntStats,isParent:boolean)=>Object.assign(Object.create(Object.getPrototypeOf(st)),st,{dev:1n,uid:0n,mode:isParent?0o40000n|parentMode:0o100000n|fileMode});
 const fakeFs={...fs,lstatSync:(f:string,_o:unknown)=>stats(fs.lstatSync(f,{bigint:true}),f===root),fstatSync:(fd:number,_o:unknown)=>stats(fs.fstatSync(fd,{bigint:true}),false),openSync:(...args:any[])=>{opens++;return (fs.openSync as any)(...args);}};
 let text=body;if(legacy){assert.equal(text.split('(parent.mode&0o022n)').length-1,1);text=text.replace('(parent.mode&0o022n)','(parent.mode&0o077n)');}
 const code=ts.transpileModule(text+';globalThis.reader=readProtectedFinancialPrerequisite',{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
 const context:any={fs:fakeFs,path,process:{env:{RECOVERY_COORDINATION_DIR:root},getuid:()=>0},Buffer,fail:(c:string)=>{throw Error(c);},canonical:(v:any):any=>Array.isArray(v)?v.map(context.canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,context.canonical(v[k])])):v};vm.runInNewContext(code,context);return {read:context.reader,opens:()=>opens};
}
test('canonical existing0755 coordination parent accepts only private0400 descriptor; old077 policy is RED',()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'financial-prerequisite-unit-'))),owner={deploymentId:'deployment_unit',releaseId:'release_unit'},file=path.join(root,owner.deploymentId+'-protected-financial-qualification.json');
 fs.writeFileSync(file,JSON.stringify({format:'sabalan-protected-financial-migration-prerequisite/v2',evidenceDirectory:path.join(root,'private-evidence'),sourceSha256:'a'.repeat(64),binding:{synthetic:true},checkpointSha256:'b'.repeat(64),targetImage:'sha256:'+'c'.repeat(64)}));
 try{assert.throws(()=>load(root,0o755n,0o400n,true).read(owner));for(const mode of [0o700n,0o755n]){const v=load(root,mode,0o400n).read(owner);assert.equal(v.descriptor.format,'sabalan-protected-financial-migration-prerequisite/v2');v.revalidate();}
  for(const mode of [0o775n,0o777n]){const v=load(root,mode,0o400n);assert.throws(()=>v.read(owner));assert.equal(v.opens(),0);}
  assert.throws(()=>load(root,0o755n,0o600n).read(owner));const link=path.join(root,'hardlink.json');fs.linkSync(file,link);try{assert.throws(()=>load(root,0o755n,0o400n).read(owner));}finally{fs.unlinkSync(link);}
 }finally{fs.unlinkSync(file);fs.rmdirSync(root);}
});
