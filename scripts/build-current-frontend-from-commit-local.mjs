/** Fresh canonical compiler execution; no image/service publication. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {originalBackendBaseCommands} from './lib/production-backend-base-process.mjs';
import {validateCandidatePreflight} from './replace-application-native-candidate-local.mjs';
import {backendBaseLocalGuards} from './lib/production-backend-base-local-guard.mjs';
import {captureFrontendSourceProvenance,assertFrontendSourceHead,revalidateFrontendSourceProvenance,frontendCompilerInputs,frontendPackageOutputs,frontendSourceRoots,qualifyFrontendGeneratedSelectors} from './lib/frontend-source-provenance.mjs';
const repository=path.resolve(import.meta.dirname,'..'),frontend=path.join(repository,'frontend'),qa=path.resolve('D:/sabalanerp-online-qa');
const args=process.argv.slice(2);assert.equal(args.length,4);assert.equal(args[0],'--source-commit');assert.equal(args[2],'--preflight');const preflightFile=fs.realpathSync(args[3]),preflightRaw=fs.readFileSync(preflightFile);validateCandidatePreflight(JSON.parse(preflightRaw));const sourceCommit=args[1];assert.match(sourceCommit,/^[a-f0-9]{40}$/);assert.equal(process.platform,'win32');
const provenance=captureFrontendSourceProvenance(repository,sourceCommit),compilerInputs=frontendCompilerInputs(repository),operation=randomBytes(8).toString('hex'),buildId='erp_online_committed_'+operation,dist='.next-online-committed-'+operation;
const prefix=path.join(repository,'reports/qa/frontend-final-build-'+operation),physicalWorkspace=path.join(qa,'frontend-build-workspace-'+operation),physicalTarget=path.join(physicalWorkspace,'dist'),logicalTarget=path.join(frontend,dist);
assert.equal(fs.realpathSync(qa),qa);assert.ok(!fs.existsSync(physicalWorkspace)&&!fs.existsSync(logicalTarget));fs.mkdirSync(physicalWorkspace);fs.mkdirSync(physicalTarget);
const dependencyRoot=fs.realpathSync(path.join(frontend,'node_modules')),dependencyLink=path.join(physicalWorkspace,'node_modules');fs.symlinkSync(dependencyRoot,dependencyLink,'junction');fs.symlinkSync(physicalTarget,logicalTarget,'junction');
const target=fs.statSync(physicalTarget,{bigint:true}),sha=bytes=>createHash('sha256').update(bytes).digest('hex'),owner=originalBackendBaseCommands(),guard=backendBaseLocalGuards(owner),canonicalBefore=await guard.protectedIdentities();
const sources=Object.fromEntries(Object.entries(provenance.inputs).filter(([file])=>frontendSourceRoots.some(root=>file.startsWith(root+'/'))).map(([file,row])=>[file,row.working.sha256]));
const names=['frontend/tsconfig.json','frontend/next-env.d.ts'],original=Object.fromEntries(names.map(name=>[name,fs.readFileSync(path.join(repository,name))]));
const record={format:'sabalan-final-frontend-build/v1',operation,sourceCommit,sourceProvenance:provenance,compilerInputs,buildId,dist,pass:false,productionAdmission:false,startedAt:new Date().toISOString(),sources,canonicalBefore,physicalTarget,logicalTarget,dependencyRoot,dependencyLink,targetIdentity:{device:String(target.dev),inode:String(target.ino)},publicBuildEnvironment:{NEXT_PUBLIC_API_URL:'/api',NEXT_PUBLIC_SOCKET_URL:'',BACKEND_API_ORIGIN:''},preflight:{file:preflightFile,sha256:sha(preflightRaw)},runnerSha256:sha(fs.readFileSync(import.meta.filename))};
let reportPublished=false;const publish=()=>{const fd=fs.openSync(prefix+'.json',reportPublished?'r+':'wx');try{const raw=JSON.stringify(record,null,2)+'\n';fs.writeFileSync(fd,raw);fs.ftruncateSync(fd,Buffer.byteLength(raw));fs.fsyncSync(fd);reportPublished=true;}finally{fs.closeSync(fd);}};publish();
function ownedTargets(){assert.equal(fs.realpathSync(logicalTarget),physicalTarget);assert.equal(fs.realpathSync(dependencyLink),dependencyRoot);const current=fs.statSync(physicalTarget,{bigint:true});assert.equal(current.dev,target.dev);assert.equal(current.ino,target.ino);}
function compilerStable(){assert.deepEqual(frontendCompilerInputs(repository),compilerInputs);}
const npm=fs.realpathSync(path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'));assert.ok(fs.lstatSync(npm).isFile());record.npmSha256=sha(fs.readFileSync(npm));
for(const [index,name]of names.entries())fs.writeFileSync(prefix+(index===0?'.tsconfig-before.txt':'.next-env-before.txt'),original[name],{flag:'wx'});
function restoreKnownSelectors(generated,allowPartial){
 qualifyFrontendGeneratedSelectors(original,generated,dist,{allowPartial});
 const cleanup={format:'sabalan-reviewed-generated-config-cleanup/v1',pass:false,sourceCommit,originalBuildReport:path.basename(prefix+'.json'),authoredCanonicalSelectorsRestored:false,buildReexecuted:false,productionAdmission:false,failedBuild:allowPartial,files:{}};
 for(const name of names){const file=path.join(repository,name);assert.deepEqual(fs.readFileSync(file),generated[name]);fs.writeFileSync(file,original[name]);assert.deepEqual(fs.readFileSync(file),original[name]);cleanup.files[name]={beforeSha256:sha(generated[name]),afterSha256:sha(original[name]),generatedRawBase64:generated[name].toString('base64'),canonicalRawBase64:original[name].toString('base64')};}
 cleanup.authoredCanonicalSelectorsRestored=true;cleanup.pass=true;const cleanupFile='frontend-final-build-generated-cleanup-'+operation+'.json';fs.writeFileSync(path.join(repository,'reports/qa',cleanupFile),JSON.stringify(cleanup,null,2)+'\n',{flag:'wx'});record.cleanupReceipt=cleanupFile;
}
const baseEnvironment={...process.env,PATH:path.dirname(process.execPath)+';'+process.env.PATH};
try{
 ownedTargets();validateCandidatePreflight(JSON.parse(fs.readFileSync(preflightFile)));assert.deepEqual(fs.readFileSync(preflightFile),preflightRaw);compilerStable();revalidateFrontendSourceProvenance(repository,provenance);
 const packageBuild=await owner.run(process.execPath,[npm,'--prefix','packages/partner-sales-contracts','run','build'],{cwd:repository,env:baseEnvironment,maximum:8*1024**2});record.packageBuild={original:packageBuild};publish();owner.assertSuccessful(packageBuild);
 record.packageBuild.outputs=frontendPackageOutputs(repository);compilerStable();revalidateFrontendSourceProvenance(repository,provenance);
 const fromOutput=createRequire(path.join(physicalTarget,'server/pages/_document.js')),fromFrontend=createRequire(path.join(frontend,'package.json'));record.moduleResolution=Object.fromEntries(['react/jsx-runtime','next/package.json'].map(name=>{const actual=fromOutput.resolve(name);assert.equal(actual,fromFrontend.resolve(name));return[name,actual];}));
 const beforeConfig=JSON.parse(original[names[0]]);assert.ok(!beforeConfig.include.includes(dist+'/types/**/*.ts'));assert.ok(original[names[1]].toString().includes('./.next-build/types/routes.d.ts'));
 validateCandidatePreflight(JSON.parse(fs.readFileSync(preflightFile)));assert.deepEqual(fs.readFileSync(preflightFile),preflightRaw);
 const result=await owner.run(process.execPath,[npm,'run','build'],{cwd:frontend,env:{...baseEnvironment,NEXT_DIST_DIR:dist,SABALAN_BROWSER_BUILD_ID:buildId,NEXT_DEPLOYMENT_ID:buildId,...record.publicBuildEnvironment},maximum:8*1024**2});
 Object.assign(record,{pid:result.originalPid,code:result.code,signal:result.signal,naturalChildClosure:result.naturalChildClosure,compiler:result});publish();owner.assertSuccessful(result);ownedTargets();
 const generated=Object.fromEntries(names.map(name=>[name,fs.readFileSync(path.join(repository,name))]));
 for(const [index,name]of names.entries())fs.writeFileSync(prefix+(index===0?'.tsconfig-after.txt':'.next-env-after.txt'),generated[name],{flag:'wx'});
 restoreKnownSelectors(generated,false);
 assertFrontendSourceHead(repository,sourceCommit);revalidateFrontendSourceProvenance(repository,provenance);compilerStable();assert.deepEqual(frontendPackageOutputs(repository),record.packageBuild.outputs);
 record.codeSourcesUnchanged=true;record.expectedGeneratedNextEnvOnly=true;record.expectedGeneratedTsconfigOnly=true;record.tsconfigBeforeSha256=sha(original[names[0]]);record.tsconfigAfterSha256=sha(generated[names[0]]);record.nextEnvAfterSha256=sha(generated[names[1]]);
 record.artifact=JSON.parse(fs.readFileSync(path.join(physicalTarget,'browser-build-identity.json')));record.nativeBuildId=fs.readFileSync(path.join(physicalTarget,'BUILD_ID'),'utf8').trim();assert.equal(record.artifact.browserBuildId,buildId);assert.equal(record.nativeBuildId,buildId);
 record.canonicalAfter=await guard.protectedIdentities();assert.deepEqual(record.canonicalAfter,canonicalBefore);record.canonicalUnchanged=true;record.pass=true;
}catch(error){record.failure=String(error.message).slice(0,1000);}finally{record.originalClosure=await owner.close();if(record.originalClosure.interrupted||!record.originalClosure.allOriginalChildrenClosed){record.pass=false;record.failure??='ORIGINAL_CONTROLLER_NOT_NORMALLY_CLOSED';}
 if(!record.cleanupReceipt){try{const generated=Object.fromEntries(names.map(name=>[name,fs.readFileSync(path.join(repository,name))]));for(const [index,name]of names.entries())fs.writeFileSync(prefix+(index===0?'.tsconfig-failed.txt':'.next-env-failed.txt'),generated[name],{flag:'wx'});restoreKnownSelectors(generated,true);record.failureSelectorCleanup='KNOWN_SELECTORS_RESTORED';}catch(error){record.pass=false;record.failureSelectorCleanup='BLOCKED_UNREVIEWED_OR_CHANGED_SELECTORS';record.selectorCleanupFailure=String(error.message).slice(0,1000);}}
 record.finishedAt=new Date().toISOString();publish();console.log(JSON.stringify({pass:record.pass,operation,buildId,sourceCommit,report:prefix+'.json',cleanupReceipt:record.cleanupReceipt,originalClosure:record.originalClosure}));if(!record.pass)process.exitCode=1;}
