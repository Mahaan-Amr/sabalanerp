import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
import ts from 'typescript';
import { createTemporaryConcurrencyDatabase } from './shipmentStatementConcurrency/database';

test('owned Inquiry migration and restart admission on actual existing-project PostgreSQL/SQLite',
  {skip:!process.env.ONLINE_DEPLOYMENT_TEST_DATABASE_URL,timeout:300_000},async()=>{
    const root=path.resolve(process.cwd(),'..');
    const canonical=process.env.SABALAN_LOCAL_REPOSITORY_ROOT || root;
    const verify=()=>{
      const rows=execFileSync('docker',['compose','-f',path.join(canonical,'docker-compose.local.yml'),'ps','--format','json'],{encoding:'utf8'})
        .trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
      for(const service of ['postgres','backend','frontend'])assert.ok(rows.some(row=>row.Project==='sabalanerp-local'
        &&row.Service===service&&row.State==='running'&&row.Health==='healthy'),`canonical ${service} must be healthy`);
    };
    verify();
    const temporary=await createTemporaryConcurrencyDatabase({repositoryRoot:root,
      sourceDatabaseUrl:process.env.ONLINE_DEPLOYMENT_TEST_DATABASE_URL!,migrateEmptySchema:true});
    try{
      const files:Record<string,string>={};
      for(const service of ['inquiryMigrationPlan','deploymentMaintenance','runtimeControlOwnership','recoveryCrypto','deploymentRestoreEvidence'])files[`services/${service}.js`]=ts.transpileModule(
        fs.readFileSync(path.join(root,`backend/src/services/${service}.ts`),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,
          target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
      files['services/inquiryBaseline.json']=fs.readFileSync(path.join(root,'backend/src/services/inquiryBaseline.json'),'utf8');
      files['inquiry-baseline.json']=files['services/inquiryBaseline.json'];
      files['verify-inquiry-database.cjs']=fs.readFileSync(path.join(root,'deploy/scripts/verify-inquiry-database.cjs'),'utf8');
      files['with-backend-control-ownership.sh']=fs.readFileSync(path.join(root,'deploy/scripts/with-backend-control-ownership.sh'),'utf8');
      files['inquiry-migration.fixture.cjs']=fs.readFileSync(path.join(root,'tests/online-deployment/inquiry-migration.fixture.cjs'),'utf8');
      const url=new URL(temporary.databaseUrl);url.hostname='postgres';url.port='5432';
      url.searchParams.set('connection_limit','2');url.searchParams.set('pool_timeout','5');
      const runner=`const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');let input='';
        process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{const payload=JSON.parse(input);
        const root=fs.mkdtempSync('/tmp/sabalan-inquiry-control-qa-');try{
          for(const [name,body] of Object.entries(payload.files)){const file=path.resolve(root,name);if(!file.startsWith(root+'/'))throw Error('fixture escape');
            fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body);}
          const result=cp.spawnSync(process.execPath,['--test','inquiry-migration.fixture.cjs'],{cwd:root,encoding:'utf8',timeout:120000,
            env:{...process.env,NODE_PATH:'/app/node_modules',INQUIRY_MIGRATION_TEST_DATABASE_URL:payload.url}});
          process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exitCode=result.status??1;
        }finally{if(path.dirname(root)!=='/tmp'||!path.basename(root).startsWith('sabalan-inquiry-control-qa-'))throw Error('unsafe fixture cleanup');
          fs.rmSync(root,{recursive:true});}});`;
      verify();
      const result=spawnSync('docker',['exec','-i','sabalanerp-local-backend-1','node','-e',runner],
        {input:JSON.stringify({files,url:url.toString()}),encoding:'utf8',timeout:150_000});
      process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
      assert.equal(result.status,0,'actual isolated migration fixture must pass');
    }finally{await temporary.cleanup();}
  });
