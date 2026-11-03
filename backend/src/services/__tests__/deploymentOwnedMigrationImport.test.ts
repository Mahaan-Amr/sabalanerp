import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {test} from 'node:test';

const source=join(process.cwd(),'backend','src','scripts','deployment-owned-migrations.ts');
const loader=pathToFileURL(require.resolve('tsx')).href;
const environment={...process.env};
delete environment.DEPLOYMENT_ID;delete environment.DEPLOYMENT_RELEASE_ID;delete environment.DEPLOYMENT_LEASE_TOKEN;delete environment.DATABASE_URL;

test('importing the CLI exposes pure handoff without dispatch or database setup',()=>{
 const code=`import(${JSON.stringify(pathToFileURL(source).href)}).then(m=>{if(typeof (m.validateProtectedFinancialDeploymentHandoff??m.default?.validateProtectedFinancialDeploymentHandoff)!=='function')process.exit(9);console.log('IMPORT_ONLY');})`;
 const child=spawnSync(process.execPath,['--import',loader,'-e',code],{cwd:process.cwd(),env:environment,encoding:'utf8',timeout:10000});
 assert.equal(child.status,0,child.stderr);assert.equal(child.stdout.trim(),'IMPORT_ONLY');assert.equal(child.stderr,'');
});

test('direct CLI dispatch rejects missing owner before opening the database',()=>{
 const child=spawnSync(process.execPath,['--import',loader,source],{cwd:process.cwd(),env:environment,encoding:'utf8',timeout:10000});
 assert.equal(child.status,1);assert.equal(child.stdout,'');
 const error=JSON.parse(child.stderr.trim());assert.equal(error.code,'PROTECTED_MIGRATION_OWNER_REQUIRED');
});
