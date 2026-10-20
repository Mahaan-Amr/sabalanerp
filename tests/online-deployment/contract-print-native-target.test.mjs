import assert from 'node:assert/strict';
import test from 'node:test';
import {networkInterfaces} from 'node:os';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),esbuild=require('../../backend/node_modules/esbuild');
const built=await esbuild.build({entryPoints:[new URL('./contract-print-native.fixture.ts',import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/,'')],
  bundle:true,platform:'node',format:'esm',packages:'external',write:false});
const {assertNativeContractPrintBase,qualifyNativeContractPrint}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].contents).toString('base64'));

test('Contract print uses only the enrolled actual private interface and a clean unprivileged HTTP target',()=>{
  const prior=process.env.APPLICATION_NATIVE_BIND_HOST;
  try{
    const own=Object.values(networkInterfaces()).flat().find(v=>v&&!v.internal&&v.family==='IPv4'
      &&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(v.address))?.address;
    assert.ok(own,'This positive diagnostic requires an actual private host interface');
    process.env.APPLICATION_NATIVE_BIND_HOST=own;const base=`http://${own}:3197/`;
    assert.equal(assertNativeContractPrintBase(base).hostname,own);
    for(const target of ['http://127.0.0.1:3197/','http://8.8.8.8:3197/',`https://${own}:3197/`,
      `http://user:secret@${own}:3197/`,base+'?session=secret',base+'#bad',base+'wrong',`http://${own}:80/`]){
      assert.throws(()=>assertNativeContractPrintBase(target));
    }
    process.env.APPLICATION_NATIVE_BIND_HOST='10.254.254.254';
    if(own!=='10.254.254.254')assert.throws(()=>assertNativeContractPrintBase('http://10.254.254.254:3197/'));
    delete process.env.APPLICATION_NATIVE_BIND_HOST;assert.throws(()=>assertNativeContractPrintBase(base));
  }finally{if(prior===undefined)delete process.env.APPLICATION_NATIVE_BIND_HOST;else process.env.APPLICATION_NATIVE_BIND_HOST=prior;}
});

test('invalid print target is refused before SQL or authenticated HTTP work',async()=>{
  let reachedSql=false;const prior=process.env.APPLICATION_NATIVE_BIND_HOST;
  try{process.env.APPLICATION_NATIVE_BIND_HOST='127.0.0.1';
    await assert.rejects(qualifyNativeContractPrint({baseUrl:'http://127.0.0.1:3197/',sessionToken:'private-not-used',reporterId:'none',
      db:{$queryRaw(){reachedSql=true;throw Error('must not reach SQL');}}}));assert.equal(reachedSql,false);
  }finally{if(prior===undefined)delete process.env.APPLICATION_NATIVE_BIND_HOST;else process.env.APPLICATION_NATIVE_BIND_HOST=prior;}
});
