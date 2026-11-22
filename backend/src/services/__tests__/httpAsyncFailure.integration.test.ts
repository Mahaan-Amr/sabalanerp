import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync,spawnSync } from 'node:child_process';
import ts from 'typescript';
import test from 'node:test';

test('real expired Prisma transaction cannot crash either HTTP business or recovery middleware',
  {skip:!process.env.ONLINE_DEPLOYMENT_TEST_DATABASE_URL,timeout:60000},()=>{
    const repository=path.resolve(process.cwd(),'..');
    const canonical=process.env.SABALAN_LOCAL_REPOSITORY_ROOT||repository;
    const status=execFileSync('docker',['compose','-f',path.join(canonical,'docker-compose.local.yml'),'ps','--format','json'],{encoding:'utf8'});
    const rows=status.trim().split(/\r?\n/).map(line=>JSON.parse(line));
    for(const service of ['backend','postgres','frontend'])assert.ok(rows.some(row=>row.Project==='sabalanerp-local'&&row.Service===service&&row.State==='running'&&row.Health==='healthy'));
    const url=new URL(process.env.ONLINE_DEPLOYMENT_TEST_DATABASE_URL!);
    assert.ok(['127.0.0.1:55432','localhost:55432'].includes(url.host));assert.equal(url.pathname,'/sabalanerp');
    url.hostname='postgres';url.port='5432';url.searchParams.set('connection_limit','1');url.searchParams.set('pool_timeout','5');
    const files:Record<string,string>={'httpRequestLifecycle.js':ts.transpileModule(fs.readFileSync(path.join(repository,'backend/src/services/httpRequestLifecycle.ts'),'utf8'),
      {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,
      'http-async-failure.fixture.cjs':fs.readFileSync(path.join(repository,'tests/online-deployment/http-async-failure.fixture.cjs'),'utf8')};
    for(const [name,source]of [['system-recovery.js','backend/src/routes/system-recovery.ts'],['systemRecoveryPolicy.js','backend/src/services/systemRecoveryPolicy.ts']]){
      files[name]=ts.transpileModule(fs.readFileSync(path.join(repository,source),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
    }
    files['http-control-completion.fixture.cjs']=fs.readFileSync(path.join(repository,'tests/online-deployment/http-control-completion.fixture.cjs'),'utf8');
    const runner=`const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');let input='';
      process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{const payload=JSON.parse(input);
      const root=fs.mkdtempSync('/tmp/sabalan-http-rejection-qa-');try{
        for(const [name,body]of Object.entries(payload.files)){if(path.basename(name)!==name)throw Error('unsafe fixture');fs.writeFileSync(path.join(root,name),body);}
        const result=cp.spawnSync(process.execPath,['--test','http-async-failure.fixture.cjs','http-control-completion.fixture.cjs'],{cwd:root,encoding:'utf8',timeout:20000,
          env:{...process.env,NODE_PATH:'/app/node_modules',HTTP_FAILURE_TEST_DATABASE_URL:payload.url}});
        process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exitCode=result.status??1;
      }finally{if(path.dirname(root)!=='/tmp'||!path.basename(root).startsWith('sabalan-http-rejection-qa-'))throw Error('unsafe cleanup');fs.rmSync(root,{recursive:true});}});`;
    const result=spawnSync('docker',['exec','-i','sabalanerp-local-backend-1','node','-e',runner],{input:JSON.stringify({files,url:url.toString()}),encoding:'utf8',timeout:30000});
    process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');assert.equal(result.status,0);
  });
