import assert from 'node:assert/strict';
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {compileProtectedBootstrapSource} from '../protectedBootstrapMigrations';
import {candidateNeedsPreflight,exactCandidateMigrationNames} from '../protectedCandidateMigrationInventory';

test('only the complete frozen legacy inventory receives the existing bootstrap classification',()=>{
 const root=mkdtempSync(join(tmpdir(),'sabalan-legacy-source-proof-'));
 const source=join(process.cwd(),'backend','prisma','migrations');
 const baseline=JSON.parse(readFileSync(join(process.cwd(),'backend','src','services','protectedBootstrapBaseline.json'),'utf8'));
 const names=[...baseline.migrations.map((item:{name:string})=>item.name),'20261014120000_hr_vehicle_assignment_plans','20261014140000_online_deployment_control'];
 for(const name of names){mkdirSync(join(root,name));copyFileSync(join(source,name,'migration.sql'),join(root,name,'migration.sql'));}
 assert.equal(compileProtectedBootstrapSource(root).length,425);
 assert.equal(candidateNeedsPreflight([],names),true);
 assert.equal(exactCandidateMigrationNames.every(name=>names.includes(name)),false);
 // A candidate-only extra file cannot be silently treated as the legacy plan.
 const extra='20261019010000_customer_semantic_barrier';mkdirSync(join(root,extra));copyFileSync(join(source,extra,'migration.sql'),join(root,extra,'migration.sql'));
 assert.throws(()=>compileProtectedBootstrapSource(root),/PROTECTED_BOOTSTRAP_SOURCE_UNSUPPORTED/);
 // Root is deliberately retained as test-owned evidence.
});
