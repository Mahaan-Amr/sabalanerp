import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const source=fileURLToPath(new URL('../../frontend/src/features/support/supportOriginOwnership.ts',import.meta.url));
const code=require('esbuild').buildSync({entryPoints:[source],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
const module={exports:{}};new Function('module','exports','require',code)(module,module.exports,require);
const {ownedSupportOrigin,readOwnedSupportOrigin,supportOriginKey}=module.exports;
test('origin handoff requires exact original owner and session, including on another-user bootstrap',()=>{
 const owner={userId:'owner_a',sessionId:'session_a'},origin={route:'/dashboard/contracts',pageTitle:'صفحهٔ اصلی'};
 const raw=ownedSupportOrigin(owner,origin);
 assert.deepEqual(readOwnedSupportOrigin(raw,owner),origin);
 assert.notEqual(supportOriginKey(owner),supportOriginKey({userId:'owner_b',sessionId:'session_b'}));
 assert.throws(()=>readOwnedSupportOrigin(raw,{userId:'owner_b',sessionId:'session_b'}));
 assert.throws(()=>readOwnedSupportOrigin(raw,{userId:'owner_a',sessionId:'session_new'}));
 assert.throws(()=>readOwnedSupportOrigin(JSON.stringify(origin),owner));
 assert.throws(()=>readOwnedSupportOrigin(JSON.stringify({...JSON.parse(raw),token:'unattributed'}),owner));
});
