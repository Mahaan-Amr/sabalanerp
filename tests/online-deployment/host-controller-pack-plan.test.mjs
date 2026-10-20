import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const run=args=>spawnSync(process.execPath,['scripts/build-online-controller-host-pack.mjs',...args],{cwd:repository,encoding:'utf8'});
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
