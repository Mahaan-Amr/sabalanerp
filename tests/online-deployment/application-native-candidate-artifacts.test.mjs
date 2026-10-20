import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {candidateReplacementReceiptArgument,validateNativeCandidateReplacementReceipt} from '../../scripts/lib/application-native-candidate-artifacts.mjs';
test('actual candidate replacement receipt must be explicit; no future or historical uniform fallback',()=>{
 assert.throws(()=>candidateReplacementReceiptArgument([]),/EXPLICIT_ACTUAL/);
 assert.throws(()=>candidateReplacementReceiptArgument(['--candidate-replacement-receipt','D:/future-receipt.json']));
 const name='reports/qa/application-native-candidate-'+'a'.repeat(32)+'.json';assert.equal(candidateReplacementReceiptArgument(['--candidate-replacement-receipt',name]),name);
 const historical=JSON.parse(fs.readFileSync(new URL('../../reports/qa/application-native-role-slots-aeca1063d2275dde6b8fbda710d1de34.json',import.meta.url)));
 assert.throws(()=>validateNativeCandidateReplacementReceipt(historical));
 assert.throws(()=>validateNativeCandidateReplacementReceipt({format:'sabalan-application-native-candidate/v1',pass:false}));
});
