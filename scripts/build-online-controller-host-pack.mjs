/** Build an augmentation for the SAME reviewed operations checkout. This is
 * packaging only: never start SQL, applications, Docker, signers or deploys. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire,builtinModules} from 'node:module';
import {createHash} from 'node:crypto';
import {collectHostPrismaArtifacts} from './lib/application-native-host-prisma-artifacts.mjs';
import {stableBackendBaseFile} from './lib/production-backend-base-artifacts.mjs';
import {collectNativeProcessOwnerElfArtifacts} from './lib/native-process-owner-elf-artifacts.mjs';

const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const entry='backend/src/scripts/online-release-host-kernel.ts';
const hostFiles=['deploy/scripts/online-release-controller.mjs','deploy/scripts/online-release-controller-cli.mjs',
 'deploy/scripts/online-release-launcher.py','deploy/scripts/online-owner-service.py','deploy/systemd/sabalan-online-owner.service',
 'deploy/scripts/online-production-gates.mjs','deploy/scripts/online-client-terminal-observation.py','deploy/scripts/online-owner-install-guard.mjs',
 'deploy/scripts/browser-routing-store.mjs','deploy/scripts/browser-release-routing.mjs',
 'deploy/scripts/online-bootstrap-boundary.mjs','deploy/scripts/install-online-controller-trust.mjs','deploy/scripts/deploy.sh','deploy/scripts/capture-only-release.mjs','deploy/scripts/prebuilt-release-plan.mjs',
 'deploy/scripts/legacy-backend-signal.py',
 'deploy/scripts/canonical-previous-release-configuration.mjs','deploy/scripts/verify-premutation-configuration-repair.mjs','deploy/scripts/reconcile-premutation-capture.mjs',
 'deploy/scripts/storage-preflight.sh','deploy/scripts/storage-preflight.mjs','scripts/deployment-capacity.mjs',
 'deploy/scripts/backup-preflight-client.sh','deploy/scripts/backup-preflight-root.sh','deploy/scripts/backup-retention-root.sh','deploy/scripts/backup-retention-host.mjs','deploy/scripts/backup-retention-ssh-owner.mjs','deploy/scripts/provision-backup-host.sh',
 'deploy/scripts/online-release-carriers.mjs','deploy/scripts/online-carrier-root-coverage.mjs','deploy/scripts/online-legacy-browser-descriptor.mjs',
 'deploy/scripts/online-inquiry-carrier.mjs','deploy/scripts/inquiry-compiled-browser.cjs','deploy/scripts/online-inquiry-owner.py',
 'deploy/scripts/online-inquiry-inner-controller.py',
 'deploy/scripts/online-checkpoint-finalization.mjs','deploy/scripts/online-checkpoint-producer.py',
 'deploy/scripts/continuous-online-wal-owner.py','deploy/scripts/continuous-online-wal-state.py',
 'deploy/scripts/online-checkpoint-coverage.py','deploy/scripts/online-checkpoint-inventory.py',
 'deploy/scripts/capture-coordination-history.py','deploy/scripts/capture-postgres-base.py',
 'deploy/scripts/receive-postgres-wal.py','deploy/scripts/seal-postgres-wal.cjs','deploy/scripts/seal-online-checkpoint.cjs',
 'deploy/scripts/online-checkpoint-host-crypto.cjs',
 'deploy/scripts/capture-coherent-components.py','deploy/scripts/coherent-versioned-file-cuts.py',
 'deploy/scripts/native-versioned-file-sealer.py','deploy/scripts/recovery-versioned-files.py',
 'deploy/scripts/recovery-file-generations.py','deploy/scripts/recovery-database-freeze.py',
 'deploy/scripts/online-runtime-scope.py','deploy/scripts/online-runtime-owner.py',
 'deploy/scripts/online-backend-boundary.py','deploy/scripts/online-inquiry-boundary.py',
 'deploy/scripts/retire-protected-online-legacy-records.py','deploy/scripts/with-backend-control-ownership.sh',
 'deploy/scripts/protected-bootstrap-owner.py','deploy/scripts/protected-bootstrap-state.py','scripts/postgres-recovery-coverage.mjs',
 'deploy/scripts/protected-dispatch-root-prepare.py','deploy/scripts/protected-file-adoption-owner.py','deploy/scripts/protected-file-adoption-state.py',
 'docker-compose.online.yml','docker-compose.online-storage.yml','deploy/nginx/online-app.conf.template','deploy/trust/online-qualification-public-key.pem'];
const sha=value=>createHash('sha256').update(value).digest('hex');
export function projectHostShellSource(relative,bytes){
 if(!relative.endsWith('.sh'))return bytes;
 const text=bytes.toString('utf8');assert.ok(Buffer.from(text).equals(bytes),'Host shell must be UTF-8');
 const projected=Buffer.from(text.replaceAll('\r\n','\n'));
 assert.ok(!projected.includes(13),'Bare CR in host shell source');return projected;
}
const args=process.argv.slice(2),build=args[0]==='--build';
if(!build){
 assert.ok(args.length===0||(args.length===1&&args[0]==='--inspect'),'Unsupported inspect arguments');
 console.log(JSON.stringify({format:'sabalan-online-host-pack-plan/v1',entry,hostFiles,
  kernel:'deploy/scripts/online-release-host-kernel.cjs',
  client:'deploy/scripts/online-release-host-dependencies/node_modules/@prisma/client',
  requires:'--build --output <fresh absolute external directory> --linux-generation-receipt <verified extraction receipt> --native-owner-elf-receipt <actual qualified ELF receipt>',
  requiresReviewedOperationsCheckout:true,productionAdmission:false,mutated:false}));
}else{
 assert.equal(args.length,7);assert.equal(args[1],'--output');assert.equal(args[3],'--linux-generation-receipt');assert.equal(args[5],'--native-owner-elf-receipt');
 const output=path.resolve(args[2]),linuxGenerationReceipt=path.resolve(args[4]);
 const nativeOwnerElfReceipt=path.resolve(args[6]);
 assert.ok(path.isAbsolute(args[2])&&path.isAbsolute(args[4])&&path.isAbsolute(args[6]),'Absolute private paths required');
 const relative=path.relative(repository,output);
 assert.ok(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative),'Never package into the shared checkout');
 assert.ok(!fs.existsSync(output),'Fresh output directory required');
 assert.ok(os.freemem()>=1024*1024**2,'HOST_PACK_FREE_MEMORY_REFUSED');
 const sources=new Map(),external=new Map();
 function read(file,inventory,maximum=256*1024**2){
  file=path.resolve(file);const before=stableBackendBaseFile(file,maximum),bytes=fs.readFileSync(file);
  assert.deepEqual(stableBackendBaseFile(file,maximum),before);assert.equal(sha(bytes),before.sha256);
  const prior=inventory.get(file);if(prior)assert.deepEqual(before,prior);
  else inventory.set(file,before);
  return bytes;
 }
 const captureSource=relative=>{
  const file=path.resolve(repository,relative),within=path.relative(repository,file);
  assert.ok(within&&!within.startsWith('..'+path.sep)&&!path.isAbsolute(within));
  return read(file,sources);
 };
 const captureExternalSource=file=>read(file,external);
 captureSource('scripts/build-online-controller-host-pack.mjs');
 captureSource('scripts/lib/application-native-host-prisma-artifacts.mjs');
 captureSource('scripts/lib/private-linux-prisma-receipt.mjs');
 captureSource('scripts/lib/production-backend-base-artifacts.mjs');
 captureSource('scripts/lib/prisma-schema-tokens.mjs');
 captureSource('scripts/lib/native-process-owner-elf-artifacts.mjs');
 captureSource('scripts/lib/original-online-evidence-assembler.mjs');
 captureSource('scripts/lib/original-online-evidence-reader.mjs');
 const nativeOwner=collectNativeProcessOwnerElfArtifacts({receiptFile:nativeOwnerElfReceipt,captureSource});
 for(const [file,pin]of Object.entries(nativeOwner.externalSources)){
  const bytes=captureExternalSource(file);assert.equal(bytes.length,pin.bytes);assert.equal(sha(bytes),pin.sha256);
 }
 const client=collectHostPrismaArtifacts({repositoryRoot:repository,captureSource,linuxGenerationReceipt,captureExternalSource});
 const clientProof=JSON.parse(client['host-prisma-artifact.json']);
 assert.equal(clientProof.format,'sabalan-official-linux-prisma-artifact/v1');assert.equal(clientProof.linuxGenerated,true);
 const schema=captureSource('backend/prisma/schema.prisma');
 const modelNames=[...schema.toString('utf8').matchAll(/^model\s+(\w+)\s*\{/gm)].map(match=>match[1]);
 assert.ok(modelNames.length>0&&new Set(modelNames).size===modelNames.length,'Exact source model inventory required');
 assert.equal(clientProof.models,modelNames.length);assert.equal(clientProof.sourceSchemaSha256,sha(schema));
 const migrations=fs.readdirSync(path.join(repository,'backend/prisma/migrations'),{withFileTypes:true})
  .filter(value=>value.isDirectory()).map(value=>value.name).sort();
 assert.ok(migrations.length>0&&new Set(migrations).size===migrations.length,'Current migration closure required');
 captureSource('backend/prisma/migrations/migration_lock.toml');
 for(const name of migrations)captureSource('backend/prisma/migrations/'+name+'/migration.sql');
 // Include the actual literal local module closure. Python/data helpers remain
 // explicit above; the generated kernel is supplied by this pack below.
 const originals=new Map(),pending=[...hostFiles];
 for(let index=0;index<pending.length;index++){
  const file=pending[index];if(originals.has(file))continue;
  const raw=captureSource(file);originals.set(file,raw);
  if(!/\.(?:mjs|cjs|js)$/.test(file))continue;
  const text=raw.toString('utf8'),references=[];
  for(const expression of [/(?:\bimport|\bexport)\s[^;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g])
   for(const match of text.matchAll(expression))if(match[1].startsWith('.'))references.push(match[1]);
  for(const reference of references){
   const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(file),reference));
   assert.ok(!resolved.startsWith('../')&&!path.posix.isAbsolute(resolved),'Host module escapes reviewed checkout');
   if(['deploy/scripts/online-release-host-kernel.cjs','deploy/scripts/online-release-host-crypto.cjs'].includes(resolved))continue;
   if(resolved==='deploy/scripts/online-release-host-dependencies/node_modules/@prisma/client'){
    // This exact directory is materialized below from the independently
    // verified current-schema client, rather than read from the checkout.
    for(const name of ['index.js','package.json'])assert.ok(clientProof.entries.some(item=>item.target===name),'Qualified generated host client missing '+name);
    continue;
   }
   assert.ok(/\.(?:mjs|cjs|js|json)$/.test(resolved),'Explicit host module extension required: '+file+' -> '+reference);
   if(!originals.has(resolved))pending.push(resolved);
  }
 }
 captureSource(entry);
 const require=createRequire(path.join(repository,'backend/package.json')),esbuild=require('esbuild');
 captureSource('backend/node_modules/esbuild/package.json');
 const result=await esbuild.build({absWorkingDir:repository,entryPoints:[entry],bundle:true,platform:'node',target:'node22',format:'cjs',
  write:false,metafile:true,sourcemap:false,external:['@prisma/client'],logLevel:'silent',
  plugins:[{name:'fixed-source-pins',setup(builder){builder.onLoad({filter:/\.(?:ts|js|mjs|json)$/},async({path:file})=>{
   const relative=path.relative(repository,file).replaceAll('\\','/');
   assert.ok(relative.startsWith('backend/src/')&&!relative.includes('/node_modules/'),'Host kernel must use repository source only');
   assert.ok(!['backend/src/lib/prisma.ts','backend/src/application.ts','backend/src/index.ts','backend/src/online.ts'].includes(relative),
    'Host kernel cannot construct an application or second pool');
   const contents=captureSource(relative).toString('utf8'),extension=path.extname(file);
   return{contents,loader:extension==='.ts'?'ts':extension==='.json'?'json':'js'};
  });}}]});
 assert.equal(result.outputFiles.length,1);const kernel=result.outputFiles[0].contents;
 const cryptoEntry='backend/src/services/recoveryCrypto.ts';
 const cryptoBundle=await esbuild.build({absWorkingDir:repository,entryPoints:[cryptoEntry],bundle:true,platform:'node',target:'node22',format:'cjs',
  write:false,metafile:true,sourcemap:false,logLevel:'silent',plugins:[{name:'canonical-pure-crypto-source',setup(builder){builder.onLoad({filter:/.*/,namespace:'file'},({path:file})=>{
   const relative=path.relative(repository,file).replaceAll('\\','/');assert.equal(relative,cryptoEntry,'Pure crypto must not import a runtime application graph');return{contents:captureSource(relative).toString(),loader:'ts'};
  });}}]});
 assert.equal(cryptoBundle.outputFiles.length,1);assert.deepEqual(Object.keys(cryptoBundle.metafile.inputs),[cryptoEntry]);
 const cryptoKernel=Buffer.from(cryptoBundle.outputFiles[0].contents);
 const retentionEntry='backend/src/scripts/backup-checkpoint-retention.ts';
 const retentionBundle=await esbuild.build({absWorkingDir:repository,entryPoints:[retentionEntry],bundle:true,platform:'node',target:'node18',format:'cjs',
  write:false,metafile:true,sourcemap:false,logLevel:'silent',plugins:[{name:'canonical-remote-retention-source',setup(builder){builder.onLoad({filter:/.*/,namespace:'file'},({path:file})=>{
   const relative=path.relative(repository,file).replaceAll('\\','/');
   assert.ok(relative===retentionEntry||relative.startsWith('backend/src/services/'),'Remote retention must use repository policy sources only');
   assert.ok(!relative.includes('/node_modules/'),'Remote retention cannot package application dependencies');
   const extension=path.extname(file);assert.ok(['.ts','.js','.json'].includes(extension));
   return{contents:captureSource(relative).toString('utf8'),loader:extension==='.ts'?'ts':extension==='.json'?'json':'js'};
  });}}]});
 assert.equal(retentionBundle.outputFiles.length,1);
 const retentionKernel=Buffer.from(retentionBundle.outputFiles[0].contents);
 const builtins=new Set(builtinModules.flatMap(name=>[name,'node:'+name]));
 for(const definition of Object.values(result.metafile.outputs))for(const imported of definition.imports){
  assert.ok(imported.external&&builtins.has(imported.path),'Unpackaged host dependency: '+imported.path);
 }
 for(const definition of Object.values(cryptoBundle.metafile.outputs))for(const imported of definition.imports)assert.ok(imported.external&&builtins.has(imported.path),'Noncanonical crypto dependency: '+imported.path);
 for(const definition of Object.values(retentionBundle.metafile.outputs))for(const imported of definition.imports)assert.ok(imported.external&&builtins.has(imported.path),'Noncanonical retention dependency: '+imported.path);
 nativeOwner.revalidate();
 for(const [file,pin] of [...sources,...external])assert.deepEqual(stableBackendBaseFile(file),pin,'Source changed during packaging: '+file);
 fs.mkdirSync(output,{mode:0o700});const outputs={};
 function write(relative,bytes,mode=0o600){
  assert.ok(!relative.split('/').some(part=>part==='.'||part==='..')&&!path.isAbsolute(relative));
  const file=path.join(output,...relative.split('/'));fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const fd=fs.openSync(file,'wx',mode);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.chmodSync(file,mode);
  const observed=stableBackendBaseFile(file);assert.equal(observed.bytes,bytes.length);assert.equal(observed.sha256,sha(bytes));outputs[relative]=observed;
 }
 const shellSourceProjections={};
 for(const [file,bytes] of originals){
  const projected=projectHostShellSource(file,bytes);
  if(file.endsWith('.sh'))shellSourceProjections[file]={sourceSha256:sha(bytes),outputSha256:sha(projected),sourceBytes:bytes.length,outputBytes:projected.length,transform:projected.equals(bytes)?'NONE':'SHELL_CRLF_TO_LF'};
  write(file,projected);
 }
 write('deploy/scripts/online-release-host-kernel.cjs',Buffer.from(kernel));
 write('deploy/scripts/online-release-host-crypto.cjs',cryptoKernel);
 write('host-crypto-metafile.json',Buffer.from(JSON.stringify(cryptoBundle.metafile)+'\n'));
 write('deploy/scripts/backup-checkpoint-retention.cjs',retentionKernel);
 write('backup-retention-metafile.json',Buffer.from(JSON.stringify(retentionBundle.metafile)+'\n'));
 write('deploy/scripts/native-process-owner',nativeOwner.files['native-process-owner'],0o500);
 write('native-process-owner-artifact.json',Buffer.from(JSON.stringify(nativeOwner.proof)+'\n'));
 for(const item of clientProof.entries){
  assert.ok(typeof item.target==='string'&&/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?$/.test(item.target));
  const bytes=client[item.file];assert.equal(bytes.length,item.bytes);assert.equal(sha(bytes),item.sha256);
  write('deploy/scripts/online-release-host-dependencies/node_modules/@prisma/client/'+item.target,bytes);
 }
 write('host-prisma-artifact.json',client['host-prisma-artifact.json']);
 write('host-kernel-metafile.json',Buffer.from(JSON.stringify(result.metafile)+'\n'));
 const receipt={format:'sabalan-online-controller-host-pack/v1',packagingComplete:true,hostControllerPackOnly:true,
  productionAdmission:false,databaseConnected:false,runtimeStarted:false,requiresReviewedOperationsCheckout:true,
  sourceSchemaSha256:clientProof.sourceSchemaSha256,models:modelNames.length,migrations:migrations.length,
  clientGeneration:clientProof.privateLinuxGeneration,esbuildVersion:esbuild.version,nativeProcessOwner:nativeOwner.proof,
  canonicalHostCrypto:{sourceFile:cryptoEntry,sourceSha256:sha(captureSource(cryptoEntry)),bundleSha256:sha(cryptoKernel),inputs:[cryptoEntry],runtimeApplicationGraphIncluded:false},
  canonicalRemoteRetention:{sourceFile:retentionEntry,sourceSha256:sha(captureSource(retentionEntry)),bundleSha256:sha(retentionKernel),inputs:Object.keys(retentionBundle.metafile.inputs).sort(),runtimeApplicationGraphIncluded:false},
  requiredLinuxModes:{'deploy/scripts/native-process-owner':'0500'},
  sources:Object.fromEntries([...sources].map(([file,pin])=>[path.relative(repository,file).replaceAll('\\','/'),pin])),
  externalInputs:Object.fromEntries(external),shellSourceProjections,outputs};
 nativeOwner.revalidate();
 for(const [file,pin] of [...sources,...external])assert.deepEqual(stableBackendBaseFile(file),pin,'Source changed after packaging: '+file);
 write('host-pack-receipt.json',Buffer.from(JSON.stringify(receipt)+'\n'));
 console.log(JSON.stringify({output,receipt:path.join(output,'host-pack-receipt.json'),files:Object.keys(outputs).length,
  models:modelNames.length,migrations:migrations.length,productionAdmission:false}));
}
