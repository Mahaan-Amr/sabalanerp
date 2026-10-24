import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {describeOriginalMasterFailure,writeOriginalMasterFailureDiagnostic} from '../../scripts/lib/original-master-failure-diagnostic.mjs';
const root=path.resolve(import.meta.dirname,'../..'),source=path.join(root,'scripts/run-original-online-qualification-master.mjs');
test('failure diagnostic emits only bounded known locations and message digest',()=>{
 const secret='postgresql://secret-user:secret-password@example.invalid/db?token=TOP_SECRET';
 const e=new Error(secret);e.name='AssertionError';e.code='ERR_ASSERTION';e.actual=secret;e.expected=secret;
 e.stack='AssertionError: '+secret+'\n    at collect ('+pathToFileURL(path.join(root,'scripts/lib/application-native-readonly-transport-artifacts.mjs'))+':24:12)\n    at remote (/private/'+secret+':42:1)\n    at url (https://secret.invalid/'+secret+':4:2)';
 let raw='';writeOriginalMasterFailureDiagnostic(e,3,{write:x=>{raw+=x;}});const v=JSON.parse(raw);
 assert.equal(v.messageSha256,createHash('sha256').update(secret).digest('hex'));assert.equal(v.code,'ERR_ASSERTION');assert.equal(v.sequence,3);
 assert.deepEqual(v.frames,[{file:'scripts/lib/application-native-readonly-transport-artifacts.mjs',line:24,column:12}]);
 for(const value of ['secret-user','secret-password','TOP_SECRET','actual','expected','postgresql://'])assert.ok(!raw.includes(value));
});
test('untrusted names, codes and non-existing source paths never escape; frames bounded',()=>{
 const e={name:'SECRET_NAME',code:'SECRET_CODE',message:'private',stack:'Error\n'+Array(40).fill('    at f ('+pathToFileURL(source)+':12:3)').join('\n')};
 const v=describeOriginalMasterFailure(e);assert.equal(v.name,'Error');assert.equal(v.code,'UNKNOWN');assert.equal(v.frames.length,8);
 e.stack='Error\n    at f ('+pathToFileURL(path.join(root,'scripts/SECRET_TOKEN.mjs'))+':12:3)';assert.deepEqual(describeOriginalMasterFailure(e).frames,[]);
});
test('failed diagnostic sink cannot release the original hold or throw new authority',()=>{
 assert.doesNotThrow(()=>writeOriginalMasterFailureDiagnostic(new Error('private'),3,{write(){throw Error('closed');}}));
 const text=fs.readFileSync(source,'utf8').replace(/\r\n/g,'\n');
 assert.ok(text.includes("held=true;writeOriginalMasterFailureDiagnostic(error,sequence);state('ORIGINAL_MASTER_REQUEST_FAILED_RETAINED');"));
 assert.ok(text.includes("negative&&activeCommand==='RUN_LOCAL'"));
 assert.ok(text.includes('await new Promise(()=>{void keeper;void local;void independent;void protectedInstall;void protectedRequest;void retainedBrowser;});'));
});
