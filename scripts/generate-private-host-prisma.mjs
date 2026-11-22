import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {originalBackendBaseCommands} from './lib/production-backend-base-process.mjs';
import {stableBackendBaseFile,freshBothHostBackendBasePreflight} from './lib/production-backend-base-artifacts.mjs';

// Official code generation only. Never overwrite the application's installed
// client, construct PrismaClient, open SQL, install dependencies or start Docker.
const repository=path.resolve(import.meta.dirname,'..');
const [mode='--inspect',preflightFile]=process.argv.slice(2);
assert.ok(['--inspect','--generate'].includes(mode));
assert.equal(process.argv.length,mode==='--inspect'?3:4);
const require=createRequire(import.meta.url),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const schemaFile=path.join(repository,'backend/prisma/schema.prisma');
const schema=fs.readFileSync(schemaFile),text=schema.toString('utf8');
const expected='generator client {\n  provider      = "prisma-client-js"\n  binaryTargets = ["native", "debian-openssl-3.0.x"]\n}';
const blocks=[...text.matchAll(/^generator client \{[\s\S]*?^\}/gm)];
assert.equal(blocks.length,1);assert.equal(blocks[0][0].replace(/\r/g,''),expected);
const models=[...text.matchAll(/^model\s+(\w+)\s*\{/gm)].map(match=>match[1]);
for(const model of ['OnlineRealtimeBatch','OnlineRealtimeCommand','OnlineHrInvalidationIntent'])assert.ok(models.includes(model));
const cli=path.join(repository,'backend/node_modules/prisma/build/index.js');
const generator=path.join(repository,'backend/node_modules/@prisma/client/generator-build/index.js');
const schemaEngine=path.join(repository,'backend/node_modules/@prisma/engines/schema-engine-windows.exe');
const linuxEngine=path.join(repository,'backend/node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node');
const commandOwner=path.join(repository,'scripts/lib/production-backend-base-process.mjs');
assert.equal(process.platform,'win32');
assert.equal(require(path.join(repository,'backend/node_modules/prisma/package.json')).version,'5.22.0');
assert.equal(require(path.join(repository,'backend/node_modules/@prisma/client/package.json')).version,'5.22.0');
function inventory(directory){const entries={};
 const visit=(folder,prefix='')=>{for(const name of fs.readdirSync(folder).sort()){
  const file=path.join(folder,name),relative=prefix+name,stat=fs.lstatSync(file);assert.ok(!stat.isSymbolicLink());
  if(stat.isDirectory())visit(file,relative+'/');else entries[relative]=stableBackendBaseFile(file);
 }};visit(directory);return entries;
}
const installed=path.join(repository,'backend/node_modules/.prisma/client');
const inputs={schema:stableBackendBaseFile(schemaFile),cli:stableBackendBaseFile(cli),generator:stableBackendBaseFile(generator),
 schemaEngine:stableBackendBaseFile(schemaEngine),linuxEngine:stableBackendBaseFile(linuxEngine),
 commandOwner:stableBackendBaseFile(commandOwner),helper:stableBackendBaseFile(import.meta.filename)};
if(mode==='--inspect'){
 console.log(JSON.stringify({mode,models:models.length,inputs,generationExecuted:false,sharedClientModified:false,
  dockerExecuted:false,databaseConnected:false,productionAdmission:false}));
}else{
 const preflight=freshBothHostBackendBasePreflight(repository,preflightFile);
 // This pure compiler owns no application/database work. Bound each compiler
 // heap instead of reserving an unmeasured 2 GiB for a 0.5 MiB schema. Runtime
 // and native actor admission limits are separate and remain unchanged.
 const capacity={availableMemoryBytes:os.freemem(),requiredMemoryBytes:768*1024**2,compilerHeapMiB:768};
 assert.ok(capacity.availableMemoryBytes>=capacity.requiredMemoryBytes,'PRIVATE_CODEGEN_HOST_MEMORY_REFUSED');
 const space=fs.statfsSync('D:/',{bigint:true});assert.ok(space.bavail*space.bsize>=512n*1024n**2n,'PRIVATE_CODEGEN_DISK_REFUSED');
 const before=inventory(installed),operation='private-host-prisma-'+randomBytes(16).toString('hex');
 const root=path.resolve('D:/sabalanerp-online-qa',operation);fs.mkdirSync(root,{mode:0o700});
 const output=path.join(root,'client'),privateSchema=path.join(root,'schema.prisma');
 const replacement='generator client {\n  provider = '+JSON.stringify('node '+generator.replaceAll('\\','/'))
  +'\n  binaryTargets = ["debian-openssl-3.0.x"]\n  output = '+JSON.stringify(output.replaceAll('\\','/'))+'\n}';
 const transformed=text.slice(0,blocks[0].index)+replacement+text.slice(blocks[0].index+blocks[0][0].length);
 fs.writeFileSync(privateSchema,transformed,{flag:'wx',mode:0o600});
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:operation,private:true}),{flag:'wx',mode:0o600});
 assert.equal(fs.existsSync(path.join(root,'.env')),false);
 const commands=originalBackendBaseCommands();
 const report={format:'sabalan-private-official-host-prisma-generation/v1',operation,root,output,inputs,preflight,capacity,
  sourceSchemaSha256:sha(schema),transformedSchemaSha256:sha(Buffer.from(transformed)),generatorOnlyTransform:true,
  pass:false,sharedClientModified:false,databaseConnected:false,dockerExecuted:false,productionAdmission:false};
 const save=suffix=>{const file=path.join(repository,'reports/qa',operation+suffix+'.json');const fd=fs.openSync(file,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(report,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}return file;};
 save('-intent');let failure;
 // Minimal environment avoids inheriting credentials or application URLs.
 const environment={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:root,TMP:root,HOME:root,USERPROFILE:root,
  NODE_OPTIONS:'--max-old-space-size=768',PRISMA_GENERATE_SKIP_AUTOINSTALL:'1',CHECKPOINT_DISABLE:'1',PRISMA_HIDE_UPDATE_MESSAGE:'1',
  PRISMA_QUERY_ENGINE_LIBRARY:linuxEngine,PRISMA_SCHEMA_ENGINE_BINARY:schemaEngine,
  DATABASE_URL:'postgresql://127.0.0.1:1/private_codegen_not_connected'};
 try{
  // The owner retains its original child until actual close, without timeout
  // termination. The helper's explicit cwd/env never touch shared .env files.
  report.generation=await commands.run(process.execPath,[cli,'generate','--schema',privateSchema],{cwd:root,env:environment});
  commands.assertSuccessful(report.generation);
  const generated=require(output);
  assert.equal(generated.Prisma.prismaVersion.client,'5.22.0');
  assert.equal(generated.Prisma.prismaVersion.engine,'605197351a3c8bdd595af2d2a9bc3025bca48ea2');
  assert.deepEqual(generated.Prisma.dmmf.datamodel.models.map(model=>model.name).sort(),[...models].sort());
  assert.equal(stableBackendBaseFile(path.join(output,path.basename(linuxEngine))).sha256,inputs.linuxEngine.sha256);
  report.generated={version:generated.Prisma.prismaVersion,models:models.length,dmmfSha256:sha(Buffer.from(JSON.stringify(generated.Prisma.dmmf)))};
  report.outputs=inventory(output);
  for(const [name,file]of Object.entries({schema:schemaFile,cli,generator,schemaEngine,linuxEngine,commandOwner,helper:import.meta.filename}))assert.deepEqual(stableBackendBaseFile(file),inputs[name]);
  assert.deepEqual(inventory(installed),before);report.sharedClientUnchanged=true;report.pass=true;
 }catch(error){failure=error;report.error=error instanceof Error?error.message:'PRIVATE_HOST_GENERATION_UNPROVEN';}
 finally{report.originalChildren=await commands.close();if(report.originalChildren.interrupted){report.pass=false;failure??=Error('ORIGINAL_CONTROLLER_INTERRUPTED');}}
 const receipt=save('');console.log(JSON.stringify({receipt,pass:report.pass,output,models:models.length,productionAdmission:false}));if(failure)throw failure;
}
