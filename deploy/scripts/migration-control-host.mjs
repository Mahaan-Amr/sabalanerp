/** Fixed host-owned migration control path. No caller-supplied command is run. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {originalBackendBaseCommands} from '../../scripts/lib/production-backend-base-process.mjs';
import {inspectOriginalDeploymentHostLock} from './prebuilt-release-plan.mjs';
import {inspectMaintenanceMigrationImage, executeInspectedMigrationControl} from './migration-control-inspection.mjs';
import {productionImageStore, sanitizeProductionImageInspection, productionInspectionSha256, assertProductionImageInspection} from './production-image-execution-binding.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const needed=key=>{const v=process.env[key];assert.ok(v&&v.length<=4096,'MIGRATION_HOST_ENV_UNPROVEN');return v;};
const imagePattern=/^sha256:[a-f0-9]{64}$/;
const ownerPattern=/^[A-Za-z0-9_-]{8,160}$/;
function inputContext(){
 const repository=fs.realpathSync(needed('DEPLOYMENT_REPO_ROOT'));
 assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);assert.equal(process.cwd(),repository);
 const id=needed('DEPLOYMENT_ID'),image=needed('DEPLOYMENT_TARGET_BACKEND_IMAGE');assert.match(id,ownerPattern);assert.match(image,imagePattern);
 const lock=inspectOriginalDeploymentHostLock(repository);
 const env=fs.realpathSync(needed('DEPLOYMENT_MIGRATION_ENV_FILE'));
 const compose=fs.realpathSync(path.join(repository,'docker-compose.prod.yml'));
 return {repository,id,image,lock,env,compose,archive:path.join(lock.directory,`migration-control-${id}.docker.tar`)};
}
function childOk(value){assert.equal(value.code,0,'MIGRATION_HOST_CHILD_UNPROVEN');assert.equal(value.signal,null);assert.equal(value.spawnError,undefined);assert.equal(value.streamError,undefined);assert.equal(value.outputBoundExceeded,false);}
async function saveOriginalArchive(id,fd,cwd){
 let interrupted=false,exceeded=false,bytes=0,spawnError,streamError;
 const signal=()=>{interrupted=true;};process.on('SIGINT',signal);process.on('SIGTERM',signal);
 try{
  const child=spawn('docker',['image','save',id],{cwd,stdio:['ignore',fd,'pipe']});
  child.stderr.on('data',chunk=>{bytes+=chunk.length;if(bytes>1024*1024)exceeded=true;});
  child.stderr.on('error',()=>{streamError=true;});child.on('error',()=>{spawnError=true;});
  const result=await new Promise(resolve=>child.on('close',(code,signal)=>resolve({code,signal})));
  assert.equal(interrupted,false,'MIGRATION_ARCHIVE_INTERRUPTED');assert.equal(spawnError,undefined);assert.equal(streamError,undefined);assert.equal(exceeded,false);
  assert.equal(result.code,0,'MIGRATION_ARCHIVE_SAVE_UNPROVEN');assert.equal(result.signal,null);
 }finally{process.removeListener('SIGINT',signal);process.removeListener('SIGTERM',signal);}
}

/** Writes only a new private retained archive; failed/partial output is kept. */
export async function prepareNormalMigrationArchive(context, image, store, save=saveOriginalArchive){
 assert.equal(image.Id,context.image);assert.ok(Number.isSafeInteger(image.Size)&&image.Size>0);
 const stat=fs.statfsSync(context.lock.directory,{bigint:true});
 assert.ok(stat.bavail*stat.bsize>=BigInt(image.Size)*2n+1024n**3n,'MIGRATION_ARCHIVE_CAPACITY_UNPROVEN');
 const flags=fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW;
 const fd=fs.openSync(context.archive,flags,0o600);
 try{
  const original=fs.fstatSync(fd,{bigint:true});assert.ok(original.isFile()&&original.uid===0n&&original.nlink===1n);
  await save(context.image,fd,context.repository);fs.fsyncSync(fd);
  const held=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(context.archive,{bigint:true});
  assert.equal(held.dev,original.dev);assert.equal(held.ino,original.ino);assert.equal(named.dev,held.dev);assert.equal(named.ino,held.ino);
  fs.fchmodSync(fd,0o400);fs.fsyncSync(fd);
 }finally{fs.closeSync(fd);}
 const dir=fs.openSync(context.lock.directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
 inspectOriginalDeploymentHostLock(context.repository);
 return inspectMaintenanceMigrationImage({archive:context.archive,image,store});
}

function readPrivate(file,expected){
 const real=fs.realpathSync(file);assert.equal(real,file);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const before=fs.fstatSync(fd,{bigint:true});assert.ok(before.isFile()&&before.uid===0n&&before.nlink===1n&&(before.mode&0o777n)===0o400n&&before.size>0n&&before.size<=8n*1024n**2n);
  const bytes=fs.readFileSync(fd),after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(file,{bigint:true});
  for(const key of ['dev','ino','size','mtimeNs','ctimeNs']){assert.equal(before[key],after[key]);assert.equal(before[key],named[key]);}assert.equal(sha(bytes),expected);return JSON.parse(bytes.toString('utf8'));
 }finally{fs.closeSync(fd);}
}

/** Fixed host command sequence; injected command owner is used by offline tests only. */
export async function runFixedMigrationKeeper({context,graph,binding,prefix,command,original,recordDirectory=context.lock.directory}){
  const projection=path.posix.join(context.lock.directory,`migration-projection-${context.id}.json`);
  assert.equal(needed('DEPLOYMENT_MIGRATION_PROJECTION_SOURCE'),projection);assert.ok(!/[,:\n]/.test(projection));
  process.env.DEPLOYMENT_BACKEND_IMAGE=context.image;
  process.env.BACKEND_DB_CONNECTION_LIMIT='2';process.env.DATABASE_APPLICATION_NAME='sabalanerp-deployment';
  const resolved=JSON.parse(await command([...prefix,'config','--format','json']));
  const keeperCommand=['-I','-B','-c','import time; time.sleep(2147483647)'];
  process.env.BACKEND_RUNTIME_ROLE='control';process.env.DEPLOYMENT_CONTROL_IMAGE=context.image;
  const passed=['BACKEND_RUNTIME_ROLE','DEPLOYMENT_ID','DEPLOYMENT_RELEASE_ID','DEPLOYMENT_TARGET_COMMIT','DEPLOYMENT_LEASE_TOKEN','DEPLOYMENT_OWNER','DEPLOYMENT_PHASE','DEPLOYMENT_CONTROL_IMAGE'];
  for(const key of passed)needed(key);
  const args=[...prefix,'run','--detach','--no-deps','--entrypoint','/usr/bin/python3','--label',`io.sabalan.deployment.id=${context.id}`];
  for(const key of passed)args.push('-e',key);
  args.push('--volume',`${projection}:/run/deployment-migration-projection.json:ro`,'deployment',...keeperCommand);
  const id=(await command(args)).trim();assert.match(id,/^[a-f0-9]{64}$/);
  // This retained receipt is evidence, not projection or migration authority.
  // Production uses the existing lock directory; an isolated host test can
  // retain its receipt on the host without remapping the Linux projection.
  const record=path.join(recordDirectory,`migration-control-${context.id}.json`),fd=fs.openSync(record,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,JSON.stringify({format:'sabalan-migration-control-host/v1',id,image:context.image,state:'RETAINED',productionAdmission:false})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const observe=async()=>{
   const containers=JSON.parse(await command(['inspect',id])),images=JSON.parse(await command(['image','inspect',context.image]));
   assert.equal(containers.length,1);assert.equal(images.length,1);
   return {container:containers[0],image:images[0],binding,graph,resolved,expectedId:id,expectedImage:context.image,projectionSource:projection,keeperCommand};
  };
  const execute=async target=>{
   const seconds=Number(needed('DEPLOYMENT_MIGRATION_DEADLINE_SECONDS'));assert.ok(Number.isSafeInteger(seconds)&&seconds>0&&seconds<=900);
   let exceeded=false;const timer=setTimeout(()=>{exceeded=true;},seconds*1000);
   let result;try{result=await original.run('docker',['exec',target,'sh','scripts/with-backend-control-ownership.sh','node','dist/scripts/deployment-owned-migrations.js'],{cwd:context.repository,maximum:1024*1024});}finally{clearTimeout(timer);}
   return {exitCode:result.code,signal:result.signal,stdoutClosed:!exceeded&&!result.streamError&&!result.outputBoundExceeded&&!result.spawnError&&!original.interrupted,stderrClosed:!exceeded&&!result.streamError&&!result.outputBoundExceeded&&!result.spawnError&&!original.interrupted};
  };
  await executeInspectedMigrationControl({observe,execute});
  console.log(JSON.stringify({migrationControl:'EXEC_COMPLETED_KEEPER_RETAINED',id}));
}

async function main(){
 assert.equal(process.argv.length,3);assert.ok(['prepare','run'].includes(process.argv[2]));
 const context=inputContext(),original=originalBackendBaseCommands();
 const online=process.env.DEPLOYMENT_ONLINE_BOOTSTRAP_REQUEST_FD?['-f',path.join(context.repository,'docker-compose.online.yml'),'-f',path.join(context.repository,'docker-compose.online-storage.yml')]:[];
 const prefix=['compose','--env-file',context.env,'-f',context.compose,...online];
 const command=async args=>{const r=await original.run('docker',args,{cwd:context.repository,maximum:8*1024*1024});original.assertSuccessful(r);return r.stdout;};
 const inspectImage=async()=>{const rows=JSON.parse(await command(['image','inspect',context.image]));assert.equal(rows.length,1);return rows[0];};
 try{
  const store=productionImageStore(JSON.parse(await command(['info','--format','{{json .}}'])));
  if(process.argv[2]==='prepare'){
   const image=await inspectImage();
   assert.equal(image.Config?.Labels?.['io.sabalan.performance.source-commit'],needed('DEPLOYMENT_TARGET_COMMIT'));
   assert.equal(image.Config?.Labels?.['io.sabalan.performance.source-hash'],needed('PERFORMANCE_RELEASE_SOURCE_HASH'));
   await prepareNormalMigrationArchive(context,image,store);return;
  }
  const image=await inspectImage();let graph,binding;
  assert.equal(image.Config?.Labels?.['io.sabalan.performance.source-commit'],needed('DEPLOYMENT_TARGET_COMMIT'));
  assert.equal(image.Config?.Labels?.['io.sabalan.performance.source-hash'],needed('PERFORMANCE_RELEASE_SOURCE_HASH'));
  if(process.env.DEPLOYMENT_MIGRATION_PREBUILT_PLAN){
   const plan=readPrivate(needed('DEPLOYMENT_MIGRATION_PREBUILT_PLAN'),needed('DEPLOYMENT_MIGRATION_PREBUILT_SHA256'));
   assert.equal(plan.format,'sabalan-prebuilt-protected-release-plan/v1');assert.equal(plan.applicationCommit,needed('DEPLOYMENT_TARGET_COMMIT'));
   assert.equal(plan.images.backend.image,context.image);assert.equal(plan.imageStore??'classic',store);graph=plan.images.backend.archiveGraph;
   const nativeInspection=sanitizeProductionImageInspection(image);
   binding={format:'sabalan-production-image-execution-binding/v1',role:'backend',store,graph,executionImageId:context.image,nativeInspection,inspectionSha256:productionInspectionSha256(nativeInspection)};
   assertProductionImageInspection(binding,image,graph);
  }else{
   const stat=fs.lstatSync(context.archive,{bigint:true});assert.ok(stat.isFile()&&stat.uid===0n&&stat.nlink===1n&&(stat.mode&0o777n)===0o400n);
   ({graph,binding}=inspectMaintenanceMigrationImage({archive:context.archive,image,store}));
  }
  await runFixedMigrationKeeper({context,graph,binding,prefix,command,original});
 }finally{await original.close();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{process.stderr.write('MIGRATION_CONTROL_HOST_UNPROVEN\n');process.exitCode=1;});
