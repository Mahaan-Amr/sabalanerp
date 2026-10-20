import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const code=require('esbuild').buildSync({entryPoints:[fileURLToPath(new URL('../design-system-e2e/support/sds-database-scope.ts',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
const module={exports:{}};new Function('module','exports','require',code)(module,module.exports,require);
const {sdsDatabaseScope}=module.exports;
const local='postgresql://postgres:local@127.0.0.1:55432/sabalanerp';
const database='qa_application_native_'+'a'.repeat(32),username='native-app-12345678-1234-1234-1234-123456789abc';
const native=local.replace('/sabalanerp','/'+database);
test('canonical local catalog default remains available with a bounded temporary client',()=>{
 const scope=sdsDatabaseScope(local,{});assert.equal(scope.adminUsername,'admin');
 assert.equal(scope.url.searchParams.get('connection_limit'),'2');assert.equal(scope.url.searchParams.get('pool_timeout'),'10');
});
test('native catalog fixture accepts only exact explicitly enrolled local isolated database and actor',()=>{
 const environment={SABALAN_SDS_NATIVE_DATABASE_NAME:database,DESIGN_SYSTEM_E2E_ADMIN_USERNAME:username,
  SABALAN_SDS_NATIVE_DATABASE_OID:'1234',SABALAN_SDS_NATIVE_SYSTEM_IDENTIFIER:'9876543210'};
 assert.equal(sdsDatabaseScope(native,environment).adminUsername,username);
 assert.equal(sdsDatabaseScope(native.replace('127.0.0.1:55432','postgres:5432'),environment).expectedIdentity.oid,'1234');
 for(const [url,env]of [[native,{}],[native,{...environment,SABALAN_SDS_NATIVE_DATABASE_NAME:database.replace(/a/g,'b')}],
  [local,environment],[native.replace('127.0.0.1','production.example'),environment],
  [native.replace('55432','5432'),environment],[native,{...environment,DESIGN_SYSTEM_E2E_ADMIN_USERNAME:'admin'}],
  [native,{...environment,SABALAN_SDS_NATIVE_DATABASE_OID:undefined}]])
  assert.throws(()=>sdsDatabaseScope(url,env));
});
