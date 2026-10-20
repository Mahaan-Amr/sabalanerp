'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{AsyncLocalStorage}=require('node:async_hooks');
const {wrapPrismaConstructor}=require('../../deploy/scripts/inquiry-legacy-owned-prisma.cjs');
test('existing Prisma query and full transaction cannot mint work after source admission ends',async()=>{
 const storage=new AsyncLocalStorage();let queries=0,transactions=0,created=0;
 const owner={assertActive(){assert.equal(storage.getStore()?.active,true,'NO_ACTIVE_SOURCE');},async run(body){this.assertActive();return body();}};
 class Client{constructor(){created++;} $extends(extension){this.query=args=>extension.query.$allOperations({args,query:async value=>{queries++;return value;}});return this;}async $transaction(body){transactions++;return body(this);}async $disconnect(){}}
 const clients=new Set(),Owned=wrapPrismaConstructor(Client,owner,clients);assert.throws(()=>new Owned(),/NO_ACTIVE_SOURCE/);let client;
 const admission={active:true};await storage.run(admission,async()=>{client=new Owned();assert.equal(await client.query('original'), 'original');assert.equal(await client.$transaction(async db=>db.query('transaction')),'transaction');});
 admission.active=false;await storage.run(admission,async()=>{assert.throws(()=>client.query('late'),/NO_ACTIVE_SOURCE/);assert.throws(()=>client.$transaction(async()=>{}),/NO_ACTIVE_SOURCE/);});
 assert.equal(created,1);assert.equal(clients.size,1);assert.equal(queries,2);assert.equal(transactions,1);
});
