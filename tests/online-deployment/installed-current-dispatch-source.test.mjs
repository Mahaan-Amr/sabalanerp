import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{transformSync}=require('../../backend/node_modules/esbuild');
const source=fs.readFileSync(new URL('./installed-current-dispatch-native.fixture.ts',import.meta.url),'utf8');
const {qualifyInstalledCurrentDispatch}=await import('data:text/javascript;base64,'+Buffer.from(transformSync(source,{loader:'ts',format:'esm',target:'node20'}).code).toString('base64'));
test('current-production qualifier refuses a different cutover before HTTP or business mutation',async()=>{
 let http=0,mutations=0;
 const readonly=(value)=>({findUniqueOrThrow:async()=>value,update:async()=>{mutations++;throw Error('MUTATION_FORBIDDEN');}});
 const db={dispatchCutoverControl:readonly({phase:'CANONICAL_LIVE',legacyWritesEnabled:false,cutoverAt:new Date()}),shipmentStatementCutover:readonly({enabled:false,cutoverAt:null}),shipmentStatementOperationsControl:readonly({paused:true})};
 await assert.rejects(qualifyInstalledCurrentDispatch({db,json:async()=>{http++;throw Error('HTTP_FORBIDDEN');},base:'http://127.0.0.1',headers:{},prerequisites:{format:'sabalan-dispatch-native-prerequisites/v1',fixturePreparationOnly:true}}));
 assert.equal(http,0);assert.equal(mutations,0);
});
test('unattributed fixture prerequisites are rejected before touching database or HTTP',async()=>{
 const forbidden=new Proxy({},{get(){throw Error('DATABASE_MUST_NOT_BE_ACCESSED');}});
 await assert.rejects(qualifyInstalledCurrentDispatch({db:forbidden,json:async()=>{throw Error('HTTP_FORBIDDEN');},base:'http://127.0.0.1',headers:{},prerequisites:{format:'caller-json',fixturePreparationOnly:true}}),{name:'AssertionError'});
});
