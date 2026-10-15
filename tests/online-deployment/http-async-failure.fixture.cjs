const assert=require('node:assert/strict');
const test=require('node:test');
const express=require('express');
const {PrismaClient}=require('@prisma/client');
const {HttpRequestLifecycle}=require('./httpRequestLifecycle.js');
const url=new URL(process.env.HTTP_FAILURE_TEST_DATABASE_URL);
assert.equal(url.hostname,'postgres');assert.equal(url.pathname,'/sabalanerp');assert.equal(url.searchParams.get('connection_limit'),'1');
const database=new PrismaClient({datasources:{db:{url:url.toString()}}});

test('expired read-only Prisma authorization transactions return an error while business and recovery HTTP keep serving',{timeout:15000},async()=>{
  const lifecycle=new HttpRequestLifecycle();const app=express();
  const observed=[];
  app.use(lifecycle.middleware);
  const expiredAuthorization=async(_req,_res,next)=>{
    await database.$transaction(async tx=>{
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await new Promise(resolve=>setTimeout(resolve,200));
      await tx.$queryRawUnsafe('SELECT 1');
    },{timeout:75,maxWait:1000});next();
  };
  for(const prefix of ['/business','/api/system-recovery']){
    const router=express.Router();
    router.use(expiredAuthorization);
    router.get('/expired',(_req,res)=>res.json({unexpected:true}));app.use(prefix,router);
  }
  app.get('/api/ready',expiredAuthorization,(_req,res)=>res.json({unexpected:true}));
  app.get('/still-serving',async(_req,res)=>{await database.$queryRawUnsafe('SELECT 1');res.json({alive:true});});
  app.use((error,_req,res,_next)=>{observed.push(error.code);res.status(500).json({code:error.code});});
  lifecycle.install(app);
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    for(const route of ['/business/expired','/api/system-recovery/expired','/api/ready']){
      const result=await fetch(base+route,{signal:AbortSignal.timeout(3000)});
      assert.equal(result.status,500);assert.equal((await result.json()).code,'P2028');
      assert.deepEqual(await(await fetch(base+'/still-serving')).json(),{alive:true});
    }
    assert.deepEqual(observed,['P2028','P2028','P2028']);await lifecycle.waitForDrain(1000);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test.after(async()=>{await database.$disconnect();});
