'use strict';
const assert=require('node:assert/strict'),http=require('node:http');
const {once}=require('node:events');
const {AsyncLocalStorage}=require('node:async_hooks');
const test=require('node:test');
const {createOwnedLegacyInquiryHttp}=require('../../deploy/scripts/inquiry-legacy-owned-http.cjs');
function owner(){const storage=new AsyncLocalStorage();let roots=0;return{get roots(){return roots;},assertActive(){assert.equal(storage.getStore(),true);},async run(body){if(storage.getStore())return body();roots++;try{return await storage.run(true,body);}finally{roots--;}},async stopAndDrain(){assert.equal(roots,0);}};}
test('actual disconnected HTTP retains original work through deferred handler completion',async()=>{
 const work=owner();let entered,release;const started=new Promise(r=>entered=r),barrier=new Promise(r=>release=r);
 const app=await createOwnedLegacyInquiryHttp({owner:work,prepare:async()=>{},handle:async(_req,res)=>{entered();await barrier;res.end('done');},close:async()=>{}});
 await app.listen('127.0.0.1',0);const client=http.get({host:'127.0.0.1',port:app.address().port});client.on('error',()=>{});await started;client.destroy();
 let closed=false;const closure=app.close().then(()=>closed=true);await new Promise(r=>setTimeout(r,30));assert.equal(closed,false);assert.equal(work.roots,1);release();await closure;assert.equal(work.roots,0);
});
