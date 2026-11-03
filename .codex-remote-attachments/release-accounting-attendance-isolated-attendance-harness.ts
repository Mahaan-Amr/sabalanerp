import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createTemporaryConcurrencyDatabase} from '../src/services/__tests__/shipmentStatementConcurrency/database';
(async()=>{
const root=path.resolve(process.cwd());
const dir=path.join(root,'backend','.qa-attendance-release-20261020');
const source='postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?connection_limit=4&pool_timeout=10';
let temporary:Awaited<ReturnType<typeof createTemporaryConcurrencyDatabase>>|undefined;
try{
 temporary=await createTemporaryConcurrencyDatabase({repositoryRoot:root,sourceDatabaseUrl:source,migrateEmptySchema:true});
 fs.mkdirSync(dir,{recursive:false});
 const files=['attendanceDevice.integration.test.ts','attendanceCorrection.integration.test.ts','attendanceDeviceHttp.integration.test.ts','hrPersonnelIdentity.integration.test.ts'];
 const targets=files.map(name=>{
  const original=path.join(root,'backend/src/services/__tests__',name);
  let code=fs.readFileSync(original,'utf8');
  // Keep an exact localhost-only target guard, redirected to the isolated migrated database.
  code=code.replaceAll('@127.0.0.1:55432/sabalanerp?',`@127.0.0.1:55432/${temporary!.databaseName}?`);
  code=code.replace(/from (['"])(\.[^'"]+)\1/g,(_,q,relative)=>`from ${q}${path.resolve(path.dirname(original),relative).replaceAll('\\','/')}${q}`);
  code=code.replace(/import\((['"])(\.[^'"]+)\1\)/g,(_,q,relative)=>`import(${JSON.stringify(pathToFileURL(path.resolve(path.dirname(original),relative)+'.ts').href)})`);
  const target=path.join(dir,name);fs.writeFileSync(target,code);return target;
 });
 const run=spawnSync(process.execPath,[path.join(root,'backend/node_modules/tsx/dist/cli.mjs'),'--test','--test-concurrency=1',...targets],{cwd:path.join(root,'backend'),stdio:'inherit',env:{...process.env,DATABASE_URL:temporary.databaseUrl,JWT_SECRET:'local-release-test-only-not-production-secret'}});
 process.exitCode=run.status??1;
}finally{
 if(temporary)await temporary.cleanup();
 if(path.resolve(dir)===path.join(root,'backend','.qa-attendance-release-20261020'))fs.rmSync(dir,{recursive:true,force:true});
}

})().catch(error=>{console.error(error);process.exitCode=1});


