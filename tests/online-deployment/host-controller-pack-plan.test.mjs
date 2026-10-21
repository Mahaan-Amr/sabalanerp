import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const run=args=>spawnSync(process.execPath,['scripts/build-online-controller-host-pack.mjs',...args],{cwd:repository,encoding:'utf8'});

test('host shell projection preserves source bytes separately and supplies executable Linux bytes',()=>{
 const result=spawnSync(process.execPath,['--input-type=module','-e',`import assert from 'node:assert/strict';
 import {projectHostShellSource as project} from './scripts/build-online-controller-host-pack.mjs';
 const shell=Buffer.from('#!/bin/sh\\r\\nset -eu\\r\\n');const source=Buffer.from(shell);
 assert.equal(project('deploy/scripts/start.sh',shell).toString(),'#!/bin/sh\\nset -eu\\n');assert.deepEqual(shell,source);
 const nonShell=Buffer.from('original\\r\\nbytes');assert.equal(project('helper.py',nonShell),nonShell);
 const linux=Buffer.from('#!/bin/sh\\n');assert.deepEqual(project('start.sh',linux),linux);
 assert.throws(()=>project('start.sh',Buffer.from('bad\\rline')),/Bare CR/);
 assert.throws(()=>project('start.sh',Buffer.from([255])),/UTF-8/);
 `],{cwd:repository,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
});
test('host pack defaults to a nonmutating plan with separate generated-client dependency and no admission claim',()=>{
 const result=run([]);assert.equal(result.status,0);const plan=JSON.parse(result.stdout);
 assert.equal(plan.mutated,false);assert.equal(plan.productionAdmission,false);assert.equal(plan.requiresReviewedOperationsCheckout,true);
 assert.equal(plan.kernel,'deploy/scripts/online-release-host-kernel.cjs');
 assert.equal(plan.client,'deploy/scripts/online-release-host-dependencies/node_modules/@prisma/client');
 for(const file of ['deploy/scripts/prebuilt-release-plan.mjs','deploy/scripts/storage-preflight.sh','deploy/scripts/storage-preflight.mjs','scripts/deployment-capacity.mjs'])assert.ok(plan.hostFiles.includes(file),'Missing protected release host port: '+file);
 assert.ok(!plan.hostFiles.some(file=>file.includes('private-key')||file.includes('.env')));
});
test('host pack refuses shared-checkout output or relative authority paths before any build or client read',()=>{
 const forbidden=run(['--build','--output',path.join(repository,'must-not-create-host-pack'),'--linux-generation-receipt',path.join(repository,'not-a-receipt.json'),'--native-owner-elf-receipt',path.join(repository,'not-an-elf-receipt.json')]);
 assert.notEqual(forbidden.status,0);assert.match(forbidden.stderr,/Never package into the shared checkout/);
 const relative=run(['--build','--output','relative-output','--linux-generation-receipt','relative.json','--native-owner-elf-receipt','relative-elf.json']);
 assert.notEqual(relative.status,0);assert.match(relative.stderr,/Absolute private paths required/);
});

test('host pack explicitly carries the original server owner and its fixed service unit without starting either',()=>{
 const result=run(['--inspect']);assert.equal(result.status,0,result.stderr);const plan=JSON.parse(result.stdout);
 for(const file of ['deploy/scripts/online-owner-service.py','deploy/systemd/sabalan-online-owner.service','deploy/scripts/online-production-gates.mjs','deploy/scripts/online-client-terminal-observation.py','deploy/scripts/online-owner-install-guard.mjs']){
  assert.equal(plan.hostFiles.filter(value=>value===file).length,1,'Exact server-owner package entry required: '+file);
  assert.ok(fs.statSync(path.join(repository,file)).isFile(),'Missing original-owner source: '+file);
 }
 assert.equal(plan.mutated,false);assert.equal(plan.productionAdmission,false);assert.equal(plan.requiresReviewedOperationsCheckout,true);
});

test('incident reconciliation packages its subprocess verifier, pure kernel and generated-client dependency together',()=>{
 const result=run(['--inspect']);assert.equal(result.status,0,result.stderr);const plan=JSON.parse(result.stdout);
 const owner='deploy/scripts/reconcile-premutation-capture.mjs',verifier='deploy/scripts/verify-premutation-configuration-repair.mjs',kernel='deploy/scripts/canonical-previous-release-configuration.mjs';
 for(const file of [owner,verifier,kernel,'deploy/scripts/capture-only-release.mjs','deploy/scripts/legacy-backend-signal.py'])assert.ok(plan.hostFiles.includes(file),'Missing incident/legacy runtime module: '+file);
 const ownerSource=fs.readFileSync(path.join(repository,owner),'utf8'),verifierSource=fs.readFileSync(path.join(repository,verifier),'utf8');
 assert.ok(ownerSource.includes("'verify-premutation-configuration-repair.mjs'"),'Subprocess sibling must be explicitly packaged');
 assert.ok(ownerSource.includes("require('./online-release-host-dependencies/node_modules/@prisma/client')"));
 assert.ok(verifierSource.includes("from './canonical-previous-release-configuration.mjs'"));
 for(const source of [ownerSource,verifierSource])for(const match of source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g))if(match[1].startsWith('.')){const file=path.posix.normalize(path.posix.join('deploy/scripts',match[1]));assert.ok(plan.hostFiles.includes(file),'Incident import absent from pack: '+file);assert.ok(fs.statSync(path.join(repository,file)).isFile());}
 assert.equal(plan.productionAdmission,false,'Packaging grants no incident execution authority');
});
