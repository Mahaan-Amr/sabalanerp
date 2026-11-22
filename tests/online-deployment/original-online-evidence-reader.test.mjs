import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {originalOnlineEvidenceReader} from '../../scripts/lib/original-online-evidence-reader.mjs';

test('Windows original issuer compiles the actual canonical reader without a generated host pack or database graph',()=>{
 const reader=originalOnlineEvidenceReader();
 assert.ok(Object.keys(reader.sourceHashes).includes('backend/src/services/onlineReleaseEvidence.ts'));
 assert.ok(Object.keys(reader.sourceHashes).every(file=>file.startsWith('backend/src/services/')));
 assert.ok(!Object.keys(reader.sourceHashes).some(file=>file.endsWith('/prisma.ts')||file.endsWith('/application.ts')));
 const absent=path.resolve(os.tmpdir(),'original-reader-absent-'+randomBytes(16).toString('hex'));
 assert.equal(fs.existsSync(absent),false);
 assert.throws(()=>reader.readOnlineReleaseEvidence(absent,{manifestSha256:'a'.repeat(64),acceptanceSha256:'b'.repeat(64)}));
 assert.equal(fs.existsSync(absent),false);
 assert.throws(()=>reader.verifyOnlineQualificationOrigin(Buffer.from('{}'),Buffer.from('not a key'),{}));
 reader.revalidate();
});
