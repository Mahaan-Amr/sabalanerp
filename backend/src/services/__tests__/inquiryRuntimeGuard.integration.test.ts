import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
import ts from 'typescript';

test('Inquiry recovery admission is fail-closed on the existing Linux runtime filesystem',
  { skip: !process.env.SABALAN_LOCAL_REPOSITORY_ROOT, timeout: 30000 }, () => {
    const repository = path.resolve(process.cwd(), '..');
    const canonical = process.env.SABALAN_LOCAL_REPOSITORY_ROOT!;
    const status = execFileSync('docker', ['compose', '-f', path.join(canonical, 'docker-compose.local.yml'), 'ps', '--format', 'json'], { encoding: 'utf8' });
    const rows = status.trim().split(/\r?\n/).map(line => JSON.parse(line));
    for (const service of ['backend', 'postgres']) {
      assert.ok(rows.some(row => row.Project === 'sabalanerp-local' && row.Service === service
        && row.State === 'running' && row.Health === 'healthy'), `Canonical ${service} must be healthy`);
    }
    const files = Object.fromEntries(['lib/recovery.ts', 'tests/recovery-admission.test.cjs']
      .map(name => [name, fs.readFileSync(path.join(repository, 'apps/sabalan-inquiry', name), 'utf8')]));
    files['lib/recovery.js'] = ts.transpileModule(files['lib/recovery.ts'], {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    const runner = `const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');let input='';
      process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{const files=JSON.parse(input);
        const root=fs.mkdtempSync('/tmp/sabalan-inquiry-guard-qa-');try{
          for(const [name,body]of Object.entries(files)){
            if(!['lib/recovery.ts','lib/recovery.js','tests/recovery-admission.test.cjs'].includes(name))throw Error('unsafe fixture');
            const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,body);
          }
          const result=cp.spawnSync(process.execPath,['--test','tests/recovery-admission.test.cjs'],{cwd:root,encoding:'utf8',timeout:15000,
            env:{...process.env,INQUIRY_GUARD_QA_COMPILED:path.join(root,'lib/recovery.js')}});
          process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exitCode=result.status??1;
        }finally{if(path.dirname(root)!=='/tmp'||!path.basename(root).startsWith('sabalan-inquiry-guard-qa-'))throw Error('unsafe cleanup');
          fs.rmSync(root,{recursive:true});}});`;
    const result = spawnSync('docker', ['exec', '-i', 'sabalanerp-local-backend-1', 'node', '-e', runner], {
      input: JSON.stringify(files), encoding: 'utf8', timeout: 20000,
    });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    assert.equal(result.status, 0);
  });

test('Inquiry account authority uses the real existing SQLite/Prisma runtime with isolated fixture data',
  { skip: !process.env.SABALAN_LOCAL_REPOSITORY_ROOT, timeout: 30000 }, () => {
    const repository = path.resolve(process.cwd(), '..');
    const canonical = process.env.SABALAN_LOCAL_REPOSITORY_ROOT!;
    const status = execFileSync('docker', ['compose', '-f', path.join(canonical, 'docker-compose.local.yml'), 'ps', '--format', 'json'], { encoding: 'utf8' });
    const rows = status.trim().split(/\r?\n/).map(line => JSON.parse(line));
    for (const service of ['backend', 'postgres', 'inquiry']) {
      assert.ok(rows.some(row => row.Project === 'sabalanerp-local' && row.Service === service
        && row.State === 'running' && row.Health === 'healthy'), `Canonical ${service} must be healthy`);
    }
    const files = {
      'inquiry-auth.js': ts.transpileModule(fs.readFileSync(path.join(repository, 'apps/sabalan-inquiry/lib/auth.ts'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
      }).outputText,
      'inquiry-baseline.json': fs.readFileSync(path.join(repository, 'backend/src/services/inquiryBaseline.json'), 'utf8'),
      'inquiry-auth-database.fixture.cjs': fs.readFileSync(path.join(repository, 'tests/online-deployment/inquiry-auth-database.fixture.cjs'), 'utf8'),
    };
    const runner = `const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');let input='';
      process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{const files=JSON.parse(input);
        const root=fs.mkdtempSync('/tmp/sabalan-inquiry-auth-qa-');try{
          for(const [name,body]of Object.entries(files)){
            if(path.basename(name)!==name)throw Error('unsafe fixture');fs.writeFileSync(path.join(root,name),body);
          }
          const result=cp.spawnSync(process.execPath,['--test','inquiry-auth-database.fixture.cjs'],{cwd:root,encoding:'utf8',timeout:15000,
            env:{...process.env,NODE_PATH:'/app/node_modules'}});
          process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exitCode=result.status??1;
        }finally{if(path.dirname(root)!=='/tmp'||!path.basename(root).startsWith('sabalan-inquiry-auth-qa-'))throw Error('unsafe cleanup');
          fs.rmSync(root,{recursive:true});}});`;
    const result = spawnSync('docker', ['exec', '-i', 'sabalanerp-local-inquiry-1', 'node', '-e', runner], {
      input: JSON.stringify(files), encoding: 'utf8', timeout: 20000,
    });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    assert.equal(result.status, 0);
  });
