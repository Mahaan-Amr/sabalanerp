import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {readProtectedMigrationSources} from '../protectedMigrationHistory';
import {exactCandidateMigrationNames} from '../protectedCandidateMigrationInventory';
import {checkCandidateSourceCoverage} from '../protectedCandidateSourceCoverage';

test('pinned fourteen cover declared DDL and fixed dynamic trigger targets',()=>{
 const files=readProtectedMigrationSources(path.resolve(process.cwd(),'backend/prisma/migrations'));
 const result=checkCandidateSourceCoverage(files);assert.equal(result.state,'SCOPED_MATCH');
 const missing=new Map(files);missing.delete(exactCandidateMigrationNames[1]);assert.equal(checkCandidateSourceCoverage(missing).state,'UNKNOWN');
 const changed=new Map(files);changed.set(exactCandidateMigrationNames[1],Buffer.from('DO $$ BEGIN NULL; END $$;'));
 assert.equal(checkCandidateSourceCoverage(changed).state,'UNKNOWN');
});
