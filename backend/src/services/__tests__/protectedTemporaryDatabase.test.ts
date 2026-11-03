import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runProtectedTemporaryDatabase, type ChildRunner, type Result } from './protectedTemporaryDatabase';

const settled = <T>(value: T): Result<T> => ({ state: 'SUCCESS', value });
function fixture() {
  const calls: string[] = [];
  const runner: ChildRunner = {
    create: async () => { calls.push('create'); return settled(undefined); },
    identity: async () => { calls.push('identity'); return settled('123:456'); },
    setup: async () => { calls.push('setup'); return settled('SUCCESS'); },
    census: async () => { calls.push('census'); return settled({ sessions: 0, prepared: 0 }); },
    drop: async () => { calls.push('drop'); return settled(undefined); },
  };
  return { runner, calls };
}
test('settled success and definite setup failure share the cleanup path', async () => {
  for (const result of ['SUCCESS', 'FAILURE'] as const) {
    const {runner,calls} = fixture(); runner.setup = async () => settled(result);
    const outcome = await runProtectedTemporaryDatabase(runner);
    assert.match(outcome.name, /^sabalanerp_protected_[a-f0-9]{32}$/);
    assert.equal(outcome.state, 'CLEANED'); assert.equal(outcome.setup, result);
    assert.equal(calls.filter(call => call === 'drop').length, 1);
  }
});
test('unknown create or setup timeout preserves database', async () => {
  for (const stage of ['create', 'setup'] as const) {
    const {runner,calls} = fixture();
    if (stage === 'create') runner.create = async () => ({state:'UNKNOWN'});
    else runner.setup = async () => ({state:'UNKNOWN'});
    assert.equal((await runProtectedTemporaryDatabase(runner)).state, 'UNKNOWN');
    assert.equal(calls.includes('drop'), false);
  }
});
test('live sessions, prepared transaction or changed identity prevents drop', async () => {
  for (const kind of ['session','prepared','identity'] as const) {
    const {runner,calls} = fixture();
    if (kind === 'identity') { let n=0; runner.identity=async()=>settled(++n===1?'123:456':'123:457'); }
    else runner.census=async()=>settled({sessions:kind==='session'?1:0,prepared:kind==='prepared'?1:0});
    assert.equal((await runProtectedTemporaryDatabase(runner)).state,'UNKNOWN');
    assert.equal(calls.includes('drop'),false);
  }
});
test('unknown or thrown drop is never retried', async () => {
  for (const throws of [false,true]) {
    const {runner,calls} = fixture(); runner.drop=async()=>{calls.push('drop');if(throws)throw new Error('timeout');return {state:'UNKNOWN'};};
    assert.equal((await runProtectedTemporaryDatabase(runner)).state,'UNKNOWN');
    assert.equal(calls.filter(call=>call==='drop').length,1);
  }
});
test('second identity mismatch or unknown prevents drop and preserves setup result', async () => {
  for (const mode of ['mismatch','unknown'] as const) {
    const {runner,calls}=fixture(); let count=0;
    runner.identity=async()=>{count++;return count===3?(mode==='unknown'?{state:'UNKNOWN'}:settled('123:999')):settled('123:456');};
    const outcome=await runProtectedTemporaryDatabase(runner);
    assert.equal(outcome.state,'UNKNOWN');assert.equal(outcome.setup,'SUCCESS');assert.equal(calls.includes('drop'),false);
  }
});
test('exceptions in create, setup, census and identity remain unknown without drop', async () => {
  for(const stage of ['create','setup','census','identity'] as const){
    const {runner,calls}=fixture();runner[stage]=async()=>{throw new Error('unproven');};
    const outcome=await runProtectedTemporaryDatabase(runner);
    assert.equal(outcome.state,'UNKNOWN');assert.equal(calls.includes('drop'),false);
    if(stage==='census')assert.equal(outcome.setup,'SUCCESS');
  }
});
test('definite failed DROP is never CLEANED or retried', async () => {
  const {runner,calls}=fixture();runner.drop=async()=>{calls.push('drop');return {state:'FAILURE'};};
  const outcome=await runProtectedTemporaryDatabase(runner);
  assert.equal(outcome.state,'UNKNOWN');assert.equal(outcome.setup,'SUCCESS');assert.equal(calls.filter(c=>c==='drop').length,1);
});
test('definite setup failure uses the same safe cleanup path', async () => {
  const {runner,calls}=fixture();runner.setup=async()=>({state:'FAILURE'});
  const outcome=await runProtectedTemporaryDatabase(runner);
  assert.equal(outcome.state,'CLEANED');assert.equal(outcome.setup,'FAILURE');
  assert.equal(calls.filter(c=>c==='drop').length,1);
});
test('exercise completes before census and cleanup, with original database identity', async () => {
  const {runner,calls}=fixture();
  const result=await runProtectedTemporaryDatabase(runner,async (name,identity)=>{
    assert.match(name,/^sabalanerp_protected_[a-f0-9]{32}$/);assert.equal(identity,'123:456');
    calls.push('exercise');return settled(undefined);
  });
  assert.equal(result.state,'CLEANED');
  assert.ok(calls.indexOf('exercise')>calls.indexOf('setup'));
  assert.ok(calls.indexOf('exercise')<calls.indexOf('census'));
  assert.ok(calls.indexOf('census')<calls.indexOf('drop'));
});
test('failed, uncertain or throwing exercise retains database', async () => {
  for(const state of ['FAILURE','UNKNOWN','THROW'] as const){
    const {runner,calls}=fixture();
    const result=await runProtectedTemporaryDatabase(runner,async()=>{
      if(state==='THROW')throw new Error('uncertain');
      return {state};
    });
    assert.equal(result.state,'UNKNOWN');assert.equal(calls.includes('drop'),false);
  }
});
test('pre-recorded UUID name is used unchanged and invalid names never reach CREATE',async()=>{
 const valid=fixture(),name='sabalanerp_protected_'+'a'.repeat(32);
 assert.equal((await runProtectedTemporaryDatabase(valid.runner,undefined,name)).name,name);
 const invalid=fixture();assert.equal((await runProtectedTemporaryDatabase(invalid.runner,undefined,'postgres')).state,'UNKNOWN');
 assert.equal(invalid.calls.includes('create'),false);
});
