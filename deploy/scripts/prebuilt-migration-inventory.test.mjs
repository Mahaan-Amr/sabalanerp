import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {test} from 'node:test';
import {readPrebuiltMigrationInventory} from './prebuilt-migration-inventory.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
test('inventory reads immutable migration blobs, not worktree names or contents',()=>{
 const value=readPrebuiltMigrationInventory(root,'e73830dffb15f29652748d6807d4d93ce82ab321');
 assert.equal(value.releaseAdmission,false);
 assert.equal(value.entries.length,453);
 assert.equal(value.entries.find(item=>item.name==='20261102120000_accounting_financial_approval_receipts')?.sha256,'d8ee324f20554891f7b276725326f07ac22658cf8180af0d70baf95f9e54f378');
 assert.match(value.sha256,/^[a-f0-9]{64}$/);
});
test('rejects an invalid object identity without trying a mutable ref',()=>{
 assert.throws(()=>readPrebuiltMigrationInventory(root,'main'));
});
