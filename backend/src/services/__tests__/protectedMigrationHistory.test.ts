import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateProtectedMigrationHistory} from '../protectedMigrationHistory';

test('full active history rejects duplicate, missing source, unfinished and modified bytes',()=>{
 const bytes=Buffer.from('SELECT 1;'),name='20260101000000_test',files=new Map([[name,bytes]]);
 const row={name,checksum:createHash('sha256').update(bytes).digest('hex'),finished:new Date('2026-01-01T00:00:00Z'),rolledBack:null};
 assert.deepEqual([...validateProtectedMigrationHistory([row],files)],[name]);
 assert.throws(()=>validateProtectedMigrationHistory([row,row],files),/HISTORY_REQUIRES_INSPECTION/);
 assert.throws(()=>validateProtectedMigrationHistory([row],new Map()),/HISTORY_REQUIRES_INSPECTION/);
 assert.throws(()=>validateProtectedMigrationHistory([{...row,finished:null}],files),/HISTORY_REQUIRES_INSPECTION/);
 assert.throws(()=>validateProtectedMigrationHistory([row],new Map([[name,Buffer.from('SELECT 2;')]])),/HISTORY_REQUIRES_INSPECTION/);
 assert.deepEqual([...validateProtectedMigrationHistory([{...row,finished:null,rolledBack:new Date()},row],files)],[name]);
});
