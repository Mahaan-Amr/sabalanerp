import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {originalOnlineEvidenceReader,adaptOriginalFinancialPublicTrust} from '../../scripts/lib/original-online-evidence-reader.mjs';

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

test('fixed Windows public adapter refuses foreign source or changed emitted Linux custody block',()=>{
 assert.throws(()=>adaptOriginalFinancialPublicTrust('arbitrary program','a'.repeat(64)));
 assert.throws(()=>adaptOriginalFinancialPublicTrust('function assertProtectedFinancialQualificationSource(){const file=0;}', '4d899cb46945e64da60d28832bf111d46e62426ee4d5add6d017e51e6fe80744'));
 const reader=originalOnlineEvidenceReader();assert.equal(reader.platformAdapter.sourceSha256,'4d899cb46945e64da60d28832bf111d46e62426ee4d5add6d017e51e6fe80744');
 assert.equal(reader.platformAdapter.applied,process.platform==='win32');assert.match(reader.platformAdapter.fixedPublicKeySha256,/^[a-f0-9]{64}$/);
});
