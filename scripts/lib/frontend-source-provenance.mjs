/** Authored Git identity and the distinct bytes actually read by the compiler. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {compareCommittedRecipeBytes} from './committed-recipe-inputs.mjs';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
/** Only Next's two known selector edits may be restored, including a failed partial build. */
export function qualifyFrontendGeneratedSelectors(original,generated,dist,{allowPartial=false}={}){
 assert.match(dist,/^\.next-[a-zA-Z0-9_-]+$/);
 const names=['frontend/tsconfig.json','frontend/next-env.d.ts'];
 for(const name of names)assert.ok(Buffer.isBuffer(original[name])&&Buffer.isBuffer(generated[name]));
 const before=JSON.parse(original[names[0]]),after=JSON.parse(generated[names[0]]),includes=before.include;
 assert.ok(Array.isArray(includes)&&!includes.includes(dist+'/types/**/*.ts'));
 const expected={...before,include:[...includes,dist+'/types/**/*.ts']};
 const configUnchanged=JSON.stringify(after)===JSON.stringify(before);
 if(!(allowPartial&&configUnchanged)){
  const actualIncludes=after.include;delete after.include;const expectedIncludes=expected.include;delete expected.include;
  assert.deepEqual(after,expected,'UNREVIEWED_NEXT_CONFIG_CHANGE');assert.ok(Array.isArray(actualIncludes));
  assert.deepEqual([...actualIncludes].sort(),expectedIncludes.sort(),'UNREVIEWED_NEXT_INCLUDE_CHANGE');
 }
 const beforeEnv=original[names[1]].toString(),afterEnv=generated[names[1]].toString();
 assert.ok(beforeEnv.includes('./.next-build/types/routes.d.ts'));
 assert.ok(afterEnv===beforeEnv.replace('./.next-build/types/routes.d.ts','./'+dist+'/types/routes.d.ts')||(allowPartial&&afterEnv===beforeEnv),'UNREVIEWED_NEXT_ENV_CHANGE');
 return true;
}
export const frontendSourceRoots=['frontend','packages/contract-product-graph','packages/partner-sales-contracts'];
export const frontendRecipeFiles=['scripts/build-current-frontend-from-commit-local.mjs','scripts/lib/frontend-source-provenance.mjs','scripts/lib/committed-recipe-inputs.mjs','scripts/lib/production-backend-base-process.mjs','scripts/lib/production-backend-base-local-guard.mjs','scripts/replace-application-native-candidate-local.mjs','scripts/prepare-current-frontend-bundle-local.mjs','scripts/build-current-frontend-image-local.mjs','scripts/lib/image-inspection-identity.mjs','scripts/lib/production-frontend-base-artifacts.mjs','scripts/lib/private-docker-image-archive.mjs','deploy/scripts/production-frontend-snapshot.mjs','scripts/lib/frozen-ui-repackaging.mjs','tests/online-deployment/retained-ui-bundle.fixture.mjs','tests/online-deployment/Dockerfile.retained-ui'];
const git=(repository,args,input)=>execFileSync('git',args,{cwd:repository,input,maxBuffer:128*1024**2});
function working(file){
 const named=fs.lstatSync(file,{bigint:true});assert.ok(named.isFile()&&!named.isSymbolicLink()&&named.nlink===1n&&named.size<=128n*1024n**2n);
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK),key=s=>['ino','size','mtimeNs','ctimeNs','mode','nlink'].map(k=>String(s[k])).join(':');
 try{const before=fs.fstatSync(fd,{bigint:true});assert.equal(key(before),key(named));if(process.platform!=='win32')assert.equal(before.dev,named.dev);const bytes=fs.readFileSync(fd);assert.equal(key(before),key(fs.fstatSync(fd,{bigint:true})));assert.equal(key(named),key(fs.lstatSync(file,{bigint:true})));return bytes;}finally{fs.closeSync(fd);}
}
export function readFrontendSourceCommit(repository,commit,files){
 assert.match(commit,/^[a-f0-9]{40}$/);assert.ok(Array.isArray(files)&&files.length>0&&files.length<=5000&&new Set(files).size===files.length);
 for(const file of files)assert.ok(!path.isAbsolute(file)&&!/[\r\n\\]/.test(file)&&file.split('/').every(p=>p&&p!=='.'&&p!=='..'));
 const output=git(repository,['cat-file','--batch'],Buffer.from(files.map(file=>commit+':'+file+'\n').join('')));let offset=0;const inputs={};
 for(const file of files){const newline=output.indexOf(10,offset);assert.ok(newline>=offset);const header=output.subarray(offset,newline).toString('ascii').match(/^([a-f0-9]{40}) blob ([0-9]+)$/);assert.ok(header,'COMMITTED_FRONTEND_BLOB_MISSING:'+file);const count=Number(header[2]);assert.ok(count<=64*1024**2);const blob=output.subarray(newline+1,newline+1+count);assert.equal(blob.length,count);assert.equal(output[newline+1+count],10);offset=newline+count+2;
  const bytes=working(path.join(repository,file));if(!/\.(?:[cm]?js|jsx|ts|tsx|json|css|svg|txt|md|html|yml|yaml|py)$/.test(file)&&!['Dockerfile','Dockerfile.retained-ui','.gitignore','.gitattributes','.dockerignore','.npmrc'].includes(path.posix.basename(file)))assert.deepEqual(bytes,blob,'BINARY_FRONTEND_SOURCE_CHANGED:'+file);
  inputs[file]=compareCommittedRecipeBytes(bytes,blob);
 }assert.equal(offset,output.length);return inputs;
}
export function assertFrontendSourceHead(repository,commit){assert.equal(git(repository,['rev-parse','HEAD']).toString().trim(),commit,'FRONTEND_BUILD_HEAD_CHANGED');}
export function captureFrontendSourceProvenance(repository,commit){
 assertFrontendSourceHead(repository,commit);
 assert.equal(git(repository,['ls-files','--others','--exclude-standard','--',...frontendSourceRoots]).length,0,'UNCOMMITTED_FRONTEND_SOURCE');
 const files=git(repository,['ls-tree','-r','--name-only',commit,'--',...frontendSourceRoots]).toString().trim().split('\n').filter(Boolean);
 const inputs=readFrontendSourceCommit(repository,commit,[...new Set([...files,...frontendRecipeFiles])].sort()),proof={format:'sabalan-committed-frontend-source/v1',sourceCommit:commit,inputs};assertCurrentAuthoredSet(repository,proof);return proof;
}
function assertCurrentAuthoredSet(repository,proof){
 const authored=Object.keys(proof.inputs).filter(file=>frontendSourceRoots.some(root=>file.startsWith(root+'/'))).sort();
 assert.deepEqual(git(repository,['ls-files','--cached','--',...frontendSourceRoots]).toString().trim().split('\n').filter(Boolean).sort(),authored,'FRONTEND_AUTHORED_FILE_SET_CHANGED');
 let count=0;for(const prefix of ['frontend/src','frontend/public','packages/contract-product-graph/src','packages/partner-sales-contracts/src']){
  function visit(relative){const file=path.join(repository,relative),value=fs.lstatSync(file);assert.ok(!value.isSymbolicLink(),'FRONTEND_AUTHORED_ALIAS');if(value.isDirectory()){for(const name of fs.readdirSync(file))visit(relative+'/'+name);}else{assert.ok(++count<=5000&&value.isFile()&&Object.hasOwn(proof.inputs,relative),'UNCOMMITTED_FRONTEND_COMPILER_INPUT:'+relative);}}
  visit(prefix);
 }
}
export function revalidateFrontendSourceProvenance(repository,proof){
 assert.equal(proof.format,'sabalan-committed-frontend-source/v1');assertCurrentAuthoredSet(repository,proof);assert.deepEqual(readFrontendSourceCommit(repository,proof.sourceCommit,Object.keys(proof.inputs)),proof.inputs,'FRONTEND_BUILD_SOURCE_CHANGED');
 assert.equal(git(repository,['ls-files','--others','--exclude-standard','--',...frontendSourceRoots]).length,0,'UNCOMMITTED_FRONTEND_SOURCE');
}
export function frontendCompilerInputs(repository){
 const files=new Set([fs.realpathSync(process.execPath)]),versions={};
 for(const directory of ['frontend','packages/partner-sales-contracts','packages/contract-product-graph']){
  const require=createRequire(path.join(repository,directory,'package.json'));for(const name of ['typescript',...(directory==='frontend'?['next']:[])]){
   const packageFile=fs.realpathSync(require.resolve(name+'/package.json')),metadata=JSON.parse(fs.readFileSync(packageFile));versions[directory+':'+name]=metadata.version;files.add(packageFile);if(name==='typescript')files.add(fs.realpathSync(require.resolve(name)));
  }
 }return{versions,files:Object.fromEntries([...files].sort().map(file=>[file,sha(working(file))]))};
}
export function frontendPackageOutputs(repository){
 const output={};let total=0;for(const prefix of ['packages/contract-product-graph/dist','packages/partner-sales-contracts/dist']){
  function visit(relative){const file=path.join(repository,relative),value=fs.lstatSync(file);assert.ok(!value.isSymbolicLink());if(value.isDirectory()){for(const name of fs.readdirSync(file).sort())visit(relative+'/'+name);}else{const bytes=working(file);total+=bytes.length;assert.ok(total<=128*1024**2&&Object.keys(output).length<10000);output[relative]={bytes:bytes.length,sha256:sha(bytes)};}}
  visit(prefix);
 }return output;
}
