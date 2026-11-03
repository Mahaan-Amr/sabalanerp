import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {readOriginalPrivatePreflightFrame} from '../../scripts/lib/original-private-preflight-input.mjs';
const expected={rootOperation:'a'.repeat(32),sequence:1,challenge:'b'.repeat(64)};
const value=()=>({format:'sabalan-native-c3-private-preflight-input/v1',...expected,credential:'fixture-private-only'});
test('private frame consumes only its anonymous message and preserves SAME stream for later master input',async()=>{
 const input=new PassThrough();try{
  const pending=readOriginalPrivatePreflightFrame({input,expected}),raw=JSON.stringify(value())+'\n';input.write(raw.slice(0,17));input.write(raw.slice(17));
  assert.equal(await pending,'fixture-private-only');assert.equal(input.destroyed,false);
  const iterator=input.iterator({destroyOnReturn:false});input.write('later-master-command\n');assert.equal((await iterator.next()).value.toString(),'later-master-command\n');await iterator.return();assert.equal(input.destroyed,false);
 }finally{input.destroy();}
});
test('wrong nonce, replayed sequence, interleaved command and EOF refuse',async()=>{
 for(const frame of [{...value(),challenge:'c'.repeat(64)},{...value(),sequence:0},JSON.stringify(value())+'\nother-command\n',null]){
  const input=new PassThrough();try{const pending=readOriginalPrivatePreflightFrame({input,expected});if(frame===null)input.end();else input.write(typeof frame==='string'?frame:JSON.stringify(frame)+'\n');await assert.rejects(pending);}
  finally{input.destroy();}
 }
});
