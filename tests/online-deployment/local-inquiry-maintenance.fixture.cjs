const assert=require('node:assert/strict');
const {once}=require('node:events');
const test=require('node:test');
const {serve,health,conservation}=require('./local-inquiry-preservation-carrier.cjs');

test('local original carrier returns maintenance for every application method and closes real HTTP readers',async()=>{
  const identity=conservation(__dirname,process.env.INQUIRY_CONSERVATION_ORIGINAL);
  const server=serve({port:0,host:'127.0.0.1',identity,observe:()=>{
    assert.equal(conservation(__dirname,process.env.INQUIRY_CONSERVATION_ORIGINAL),identity);
  }});
  await once(server,'listening');const port=server.address().port;
  try{
    await health(identity,port);
    for(const [method,url]of [['GET','/'],['GET','/api/auth/session'],['POST','/api/auth/login'],['POST','/api/products']]){
      const response=await fetch('http://127.0.0.1:'+port+url,{method});assert.equal(response.status,503);
      assert.match(await response.text(),/بررسی محلی/);
    }
    await assert.rejects(health('0'.repeat(64),port),/CARRIER_NOT_READY/);
  }finally{const closed=once(server,'close');server.close();server.closeAllConnections();await closed;}
  assert.equal(server.listening,false);
});

test('managed online environment cannot start the maintenance carrier',()=>{
  const prior=process.env.BACKEND_RUNTIME_ROLE;process.env.BACKEND_RUNTIME_ROLE='serving';
  try{assert.throws(()=>serve({identity:'a'.repeat(64)}),/LOCAL_CARRIER_ONLINE_REFUSED/);}
  finally{if(prior===undefined)delete process.env.BACKEND_RUNTIME_ROLE;else process.env.BACKEND_RUNTIME_ROLE=prior;}
});

test('failed conservation starts no listener',()=>{
  assert.throws(()=>serve({identity:'a'.repeat(64),observe:()=>{throw Error('CONSERVATION_FAILED');}}),/CONSERVATION_FAILED/);
});
